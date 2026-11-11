import { describe, expect, it, vi } from "vitest";
import { DockerBuildService } from "../src/server/modules/builds/index.ts";
import type { DockerCommand } from "../src/server/modules/docker/index.ts";

const inspectionTime = "2026-11-11T10:00:00.000Z";

function inspectRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    Ref: `default/default/${id}`,
    Name: "service",
    Status: "completed",
    StartedAt: inspectionTime,
    CompletedAt: "2026-11-11T10:00:02.000Z",
    Context: ".",
    Dockerfile: "Dockerfile",
    Target: "release",
    Platform: ["linux/amd64", "linux/arm64"],
    VCSRepository: "https://example.test/service.git",
    Config: { BuildArgs: { SECRET_TOKEN: "do not expose" } },
    ...overrides,
  };
}

function listRow(id: string, createdAt: string, name = "service") {
  return {
    ref: `default/default/${id}`,
    name,
    status: "completed",
    created_at: createdAt,
    completed_at: createdAt,
  };
}

describe("DockerBuildService.steps", () => {
  it("merges repeated vertices and decodes split UTF-8 logs from stderr", async () => {
    const utf8 = Buffer.from("안녕", "utf8");
    const events = [
      {
        vertexes: [
          {
            digest: "sha256:first",
            name: "FROM alpine",
            started: "2026-11-11T10:00:00.000Z",
            cached: true,
          },
          {
            digest: "sha256:failed",
            name: "RUN fail",
            started: "2026-11-11T10:00:05.000Z",
            completed: "2026-11-11T10:00:04.000Z",
            error: "command failed",
          },
          {
            digest: "sha256:pending",
            name: "COPY files",
            started: "invalid timestamp",
            completed: "also invalid",
          },
        ],
        logs: [{ vertex: "sha256:first", data: utf8.subarray(0, 1).toString("base64") }],
      },
      {
        vertexes: [
          {
            digest: "sha256:first",
            completed: "2026-11-11T10:00:02.500Z",
          },
        ],
        logs: [{ vertex: "sha256:first", data: utf8.subarray(1).toString("base64") }],
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const docker = vi.fn<DockerCommand>(async (args) =>
      args.includes("inspect")
        ? { stdout: JSON.stringify(inspectRecord("build-1")), stderr: "" }
        : { stdout: "", stderr: events },
    );
    const service = new DockerBuildService(docker);

    const steps = await service.steps("build-1");

    expect(steps).toEqual([
      {
        id: "sha256:first",
        name: "FROM alpine",
        status: "succeeded",
        cached: true,
        startedAt: "2026-11-11T10:00:00.000Z",
        completedAt: "2026-11-11T10:00:02.500Z",
        durationMs: 2_500,
        error: undefined,
        log: "안녕",
        logTruncated: false,
      },
      {
        id: "sha256:failed",
        name: "RUN fail",
        status: "failed",
        cached: false,
        startedAt: "2026-11-11T10:00:05.000Z",
        completedAt: "2026-11-11T10:00:04.000Z",
        durationMs: undefined,
        error: "command failed",
        log: "",
        logTruncated: false,
      },
      {
        id: "sha256:pending",
        name: "COPY files",
        status: "pending",
        cached: false,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        error: undefined,
        log: "",
        logTruncated: false,
      },
    ]);
    expect(docker).toHaveBeenNthCalledWith(
      2,
      ["buildx", "--builder", "default", "history", "logs", "--progress", "rawjson", "build-1"],
      15_000,
    );
    expect(JSON.stringify(steps)).not.toContain("SECRET_TOKEN");
  });

  it("accepts an empty log body and rejects malformed JSON", async () => {
    const emptyDocker = vi.fn<DockerCommand>(async (args) =>
      args.includes("inspect")
        ? { stdout: JSON.stringify(inspectRecord("build-empty")), stderr: "" }
        : { stdout: "", stderr: "" },
    );
    await expect(new DockerBuildService(emptyDocker).steps("build-empty")).resolves.toEqual([]);

    const malformedDocker = vi.fn<DockerCommand>(async (args) =>
      args.includes("inspect")
        ? { stdout: JSON.stringify(inspectRecord("build-malformed")), stderr: "" }
        : { stdout: "", stderr: '{"vertexes": [' },
    );
    await expect(
      new DockerBuildService(malformedDocker).steps("build-malformed"),
    ).rejects.toMatchObject({ code: "build_history_unavailable", status: 503 });
  });

  it("caps each step log and rejects a running build before reading logs", async () => {
    const event = JSON.stringify({
      vertexes: [{ digest: "sha256:large", name: "RUN output" }],
      logs: [{ vertex: "sha256:large", data: Buffer.from("x".repeat(250_001)).toString("base64") }],
    });
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (args.includes("inspect")) {
        return { stdout: JSON.stringify(inspectRecord("build-large")), stderr: "" };
      }
      return { stdout: "", stderr: event };
    });
    const steps = await new DockerBuildService(docker).steps("build-large");
    expect(steps[0]?.log).toHaveLength(250_000);
    expect(steps[0]?.logTruncated).toBe(true);

    const runningDocker = vi.fn<DockerCommand>(async () => ({
      stdout: JSON.stringify(inspectRecord("build-running", { Status: "running" })),
      stderr: "",
    }));
    await expect(
      new DockerBuildService(runningDocker).steps("build-running"),
    ).rejects.toMatchObject({
      code: "build_running",
      status: 409,
    });
    expect(runningDocker).toHaveBeenCalledTimes(1);
  });
});

describe("DockerBuildService.related", () => {
  it("matches recorded repository and Dockerfile fields, not a shared name", async () => {
    const ids = [
      "current-build",
      "future-build",
      "same-source-newest",
      "same-name-other-repo",
      "different-context",
      "different-target",
      "different-platform",
      "same-source-older",
    ];
    const times = [
      "2026-11-11T10:00:00Z",
      "2026-11-11T11:00:00Z",
      "2026-11-11T09:50:00Z",
      "2026-11-11T09:40:00Z",
      "2026-11-11T09:30:00Z",
      "2026-11-11T09:20:00Z",
      "2026-11-11T09:10:00Z",
      "2026-11-11T09:00:00Z",
    ];
    const rows = ids.map((id, index) => listRow(id, times[index]!));
    const details: Record<string, Record<string, unknown>> = {
      "current-build": inspectRecord("current-build", {
        Context: undefined,
        Target: undefined,
      }),
      "same-source-newest": inspectRecord("same-source-newest", {
        Context: undefined,
        Target: undefined,
        Platform: ["linux/arm64", "linux/amd64"],
        VCSRevision: "previous-revision",
      }),
      "same-name-other-repo": inspectRecord("same-name-other-repo", {
        Context: undefined,
        Target: undefined,
        VCSRepository: "https://example.test/other.git",
      }),
      "different-context": inspectRecord("different-context", { Context: "." }),
      "different-target": inspectRecord("different-target", { Target: "debug" }),
      "different-platform": inspectRecord("different-platform", { Platform: ["linux/amd64"] }),
      "same-source-older": inspectRecord("same-source-older", {
        Context: undefined,
        Target: undefined,
        Platform: ["linux/arm64", "linux/amd64"],
        VCSRevision: "another-revision",
      }),
    };
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (args.includes("inspect")) {
        const id = args.at(-1)!;
        return { stdout: JSON.stringify(details[id]), stderr: "" };
      }
      return { stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "" };
    });

    const result = await new DockerBuildService(docker).related("current-build");

    expect(result).toEqual({
      records: [
        expect.objectContaining({ id: "same-source-newest" }),
        expect.objectContaining({ id: "same-source-older" }),
      ],
      scannedCount: 6,
      candidateCount: 6,
      failedCount: 0,
      limited: false,
      matchAvailable: true,
    });
  });

  it("limits inspection to 20 with four workers and reports partial failures", async () => {
    const oldIds = Array.from(
      { length: 24 },
      (_, index) => `old-${String(index).padStart(2, "0")}`,
    );
    const rows = [
      ...oldIds.map((id, index) =>
        listRow(id, new Date(Date.parse("2026-11-11T08:00:00Z") + index * 60_000).toISOString()),
      ),
      listRow("current-many", "2026-11-11T10:00:00Z"),
      listRow("future-many", "2026-11-11T11:00:00Z"),
    ];
    const details = Object.fromEntries([
      ["current-many", inspectRecord("current-many")],
      ...oldIds.map((id) => [id, inspectRecord(id)]),
    ]);
    let activeInspections = 0;
    let maxConcurrentInspections = 0;
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (!args.includes("inspect")) {
        return { stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "" };
      }

      const id = args.at(-1)!;
      if (id === "current-many") return { stdout: JSON.stringify(details[id]), stderr: "" };
      activeInspections += 1;
      maxConcurrentInspections = Math.max(maxConcurrentInspections, activeInspections);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeInspections -= 1;
      if (id === "old-22") throw new Error("candidate inspect failed");
      return { stdout: JSON.stringify(details[id]), stderr: "" };
    });

    const result = await new DockerBuildService(docker).related("current-many");
    const inspectedIds = docker.mock.calls
      .filter(([args]) => args.includes("inspect"))
      .map(([args]) => args.at(-1));

    expect(result).toMatchObject({
      records: [
        expect.objectContaining({ id: "old-23" }),
        expect.objectContaining({ id: "old-21" }),
        expect.objectContaining({ id: "old-20" }),
        expect.objectContaining({ id: "old-19" }),
        expect.objectContaining({ id: "old-18" }),
      ],
      scannedCount: 20,
      candidateCount: 24,
      failedCount: 1,
      limited: true,
      matchAvailable: true,
    });
    expect(maxConcurrentInspections).toBe(4);
    expect(inspectedIds).toHaveLength(21);
    expect(inspectedIds).not.toContain("old-03");
  });

  it("marks matching unavailable when repository, context, or Dockerfile source is missing", async () => {
    const rows = [
      listRow("current-no-source", "2026-11-11T10:00:00Z"),
      listRow("older-no-source", "2026-11-11T09:00:00Z"),
    ];
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (args.includes("inspect")) {
        return {
          stdout: JSON.stringify(
            inspectRecord("current-no-source", {
              VCSRepository: undefined,
              Context: undefined,
              Dockerfile: undefined,
            }),
          ),
          stderr: "",
        };
      }
      return { stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "" };
    });

    await expect(new DockerBuildService(docker).related("current-no-source")).resolves.toEqual({
      records: [],
      scannedCount: 0,
      candidateCount: 1,
      failedCount: 0,
      limited: false,
      matchAvailable: false,
    });
    expect(docker.mock.calls.filter(([args]) => args.includes("inspect"))).toHaveLength(1);
  });
});
