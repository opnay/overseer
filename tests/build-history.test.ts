import { describe, expect, it, vi } from "vitest";
import { ExpectedError } from "../src/server/core/errors.ts";
import { DockerBuildService } from "../src/server/modules/builds/index.ts";
import type { DockerCommand } from "../src/server/modules/docker/index.ts";
import { CommandError } from "../src/server/infrastructure/process.ts";
import type { BuildListQuery } from "../src/shared/builds.ts";

const query: BuildListQuery = { page: 1, pageSize: 20 };

function makeListRow(
  id: string,
  name: string,
  status: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    ref: `default/default/${id}`,
    name,
    status,
    created_at: createdAt,
    completed_at: createdAt,
    total_steps: 5,
    completed_steps: 5,
    cached_steps: 2,
  };
}

function makeInspect(status = "completed"): Record<string, unknown> {
  return {
    Ref: "default/default/build-123",
    Name: "gateway",
    Status: status,
    StartedAt: "2026-11-10T10:00:00Z",
    CompletedAt: "2026-11-10T10:00:09Z",
    Duration: 9_350_000_000,
    NumTotalSteps: 32,
    NumCompletedSteps: 32,
    NumCachedSteps: 19,
    Context: ".",
    Dockerfile: "Dockerfile",
    Target: "release",
    Platform: "linux/arm64",
    VCSRepository: "https://example.test/gateway.git",
    VCSRevision: "0123456789abcdef",
    Materials: [
      {
        URI: "https://example.test/base-image",
        Digests: { sha256: "abcdef012345" },
      },
    ],
    Attachments: [
      {
        Digest: "sha256:fedcba987654",
        Type: "application/vnd.example.provenance",
        Platform: "linux/arm64",
      },
    ],
    Error: { Message: "" },
    Config: { BuildArgs: { PRIVATE_TOKEN: "do not expose" } },
  };
}

function serviceWith(respond: DockerCommand = async () => ({ stdout: "", stderr: "" })) {
  const docker = vi.fn(respond);
  return { service: new DockerBuildService(docker), docker };
}

describe("DockerBuildService.list", () => {
  it("parses Buildx JSONL, filters, sorts newest first, and paginates", async () => {
    const rows = [
      makeListRow("build-old", "Gateway API", "Completed", "2026-11-10T09:00:00Z"),
      makeListRow("build-new", "gateway api optimized", "Completed", "2026-11-10T11:00:00Z"),
      makeListRow("build-error", "Gateway API", "Error", "2026-11-10T10:00:00Z"),
      makeListRow("build-running", "Gateway API", "Running", "2026-11-10T12:00:00Z"),
    ];
    const { service, docker } = serviceWith(async () => ({
      stdout: rows.map((row) => JSON.stringify(row)).join("\n"),
      stderr: "",
    }));

    const result = await service.list({
      name: "GATEWAY API",
      status: "succeeded",
      page: 2,
      pageSize: 1,
    });

    expect(result).toEqual({
      records: [
        {
          id: "build-old",
          name: "Gateway API",
          status: "succeeded",
          startedAt: "2026-11-10T09:00:00Z",
          completedAt: "2026-11-10T09:00:00Z",
          totalSteps: 5,
          completedSteps: 5,
          cachedSteps: 2,
        },
      ],
      count: 2,
      page: 2,
      pageSize: 1,
    });
    expect(docker).toHaveBeenCalledWith(
      ["buildx", "--builder", "default", "history", "ls", "--format", "json"],
      15_000,
    );
  });

  it("accepts the official PascalCase array shape and maps unknown statuses", async () => {
    const { service } = serviceWith(async () => ({
      stdout: JSON.stringify([
        {
          ID: "build-abc",
          Name: "sample",
          Status: "Paused",
          CreatedAt: "2026-11-10T10:00:00Z",
          CompletedAt: "",
          TotalSteps: 3,
          CompletedSteps: 1,
          CachedSteps: 0,
        },
      ]),
      stderr: "",
    }));

    await expect(service.list(query)).resolves.toMatchObject({
      records: [
        {
          id: "build-abc",
          name: "sample",
          status: "unknown",
          startedAt: "2026-11-10T10:00:00Z",
          completedAt: undefined,
          totalSteps: 3,
          completedSteps: 1,
          cachedSteps: 0,
        },
      ],
      count: 1,
    });
  });

  it("keeps a valid empty response distinct from malformed history", async () => {
    const empty = serviceWith(async () => ({ stdout: "\n", stderr: "" })).service;
    await expect(empty.list(query)).resolves.toMatchObject({ records: [], count: 0 });

    const malformed = serviceWith(async () => ({ stdout: "{bad json}", stderr: "" })).service;
    await expect(malformed.list(query)).rejects.toMatchObject({
      code: "build_history_unavailable",
      status: 503,
    });

    const invalidRow = serviceWith(async () => ({
      stdout: '{"name":"missing ref"}',
      stderr: "",
    })).service;
    await expect(invalidRow.list(query)).rejects.toMatchObject({
      code: "build_history_unavailable",
      status: 503,
    });
  });

  it("reports unsupported Buildx history without disguising it as an empty list", async () => {
    const unsupported = new CommandError(
      "docker buildx history ls",
      new Error("exit code 1"),
      'unknown command "history" for "docker buildx"',
    );
    const { service } = serviceWith(async () => {
      throw unsupported;
    });

    await expect(service.list(query)).rejects.toMatchObject({
      code: "buildx_unavailable",
      status: 503,
      message: expect.stringContaining("Buildx"),
    });
  });
});

describe("DockerBuildService.get", () => {
  it("uses only the validated ID and maps allowlisted inspect fields", async () => {
    const { service, docker } = serviceWith(async () => ({
      stdout: JSON.stringify(makeInspect()),
      stderr: "",
    }));

    const build = await service.get("build-123");

    expect(build).toEqual({
      id: "build-123",
      name: "gateway",
      status: "succeeded",
      startedAt: "2026-11-10T10:00:00Z",
      completedAt: "2026-11-10T10:00:09Z",
      durationMs: 9_350,
      totalSteps: 32,
      completedSteps: 32,
      cachedSteps: 19,
      context: ".",
      dockerfile: "Dockerfile",
      target: "release",
      platforms: ["linux/arm64"],
      repository: "https://example.test/gateway.git",
      revision: "0123456789abcdef",
      error: undefined,
      materials: [
        {
          uri: "https://example.test/base-image",
          digest: "sha256:abcdef012345",
        },
      ],
      outputs: [
        {
          type: "application/vnd.example.provenance",
          digest: "sha256:fedcba987654",
          platform: "linux/arm64",
        },
      ],
    });
    expect(JSON.stringify(build)).not.toContain("PRIVATE_TOKEN");
    expect(docker).toHaveBeenCalledWith(
      ["buildx", "--builder", "default", "history", "inspect", "--format", "json", "build-123"],
      15_000,
    );
  });

  it("leaves unknown nanosecond durations undefined", async () => {
    const inspect = { ...makeInspect(), Duration: null };
    const { service } = serviceWith(async () => ({ stdout: JSON.stringify(inspect), stderr: "" }));

    const build = await service.get("build-123");

    expect(build.durationMs).toBeUndefined();
  });

  it("accepts omitted names and Buildx material digest arrays", async () => {
    const inspect = {
      ...makeInspect(),
      Materials: [
        {
          URI: "https://example.test/source",
          Digests: ["sha512:secondary", "sha256:preferred"],
        },
      ],
    };
    delete (inspect as { Name?: string }).Name;
    const { service } = serviceWith(async () => ({ stdout: JSON.stringify(inspect), stderr: "" }));

    const build = await service.get("build-123");

    expect(build.name).toBe("build-123");
    expect(build.materials).toEqual([
      { uri: "https://example.test/source", digest: "sha256:preferred" },
    ]);
  });

  it.each([null, 42, {}])("rejects a non-string inspect name: %s", async (name) => {
    const inspect = { ...makeInspect(), Name: name };
    const { service } = serviceWith(async () => ({ stdout: JSON.stringify(inspect), stderr: "" }));

    await expect(service.get("build-123")).rejects.toMatchObject({
      code: "build_history_unavailable",
      status: 503,
    });
  });

  it("returns stable not-found and invalid-ID errors", async () => {
    const missing = new CommandError(
      "docker buildx history inspect",
      new Error("exit code 1"),
      "no record found",
    );
    const { service, docker } = serviceWith(async () => {
      throw missing;
    });

    await expect(service.get("missing-build")).rejects.toMatchObject({
      code: "build_not_found",
      status: 404,
    });
    await expect(service.get("bad/id")).rejects.toMatchObject({
      code: "invalid_build_id",
      status: 400,
    });
    expect(docker).toHaveBeenCalledTimes(1);
  });

  it("preserves runtime ExpectedError instances", async () => {
    const expected = new ExpectedError("runtime_unavailable", "런타임이 중지되었습니다.", 503);
    const { service } = serviceWith(async () => {
      throw expected;
    });

    await expect(service.get("build-123")).rejects.toBe(expected);
  });
});

describe("DockerBuildService.logs", () => {
  it("reads stderr first, removes terminal controls, and uses the plain progress format", async () => {
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (args.includes("inspect")) return { stdout: JSON.stringify(makeInspect()), stderr: "" };
      return { stdout: "stdout fallback", stderr: "\u001b[31mBuild output\u001b[0m\u0007" };
    });
    const service = new DockerBuildService(docker);

    await expect(service.logs("build-123")).resolves.toEqual({ text: "Build output" });
    expect(docker).toHaveBeenNthCalledWith(
      1,
      ["buildx", "--builder", "default", "history", "inspect", "--format", "json", "build-123"],
      15_000,
    );
    expect(docker).toHaveBeenNthCalledWith(
      2,
      ["buildx", "--builder", "default", "history", "logs", "--progress", "plain", "build-123"],
      15_000,
    );
  });

  it("does not issue a potentially hanging logs command while a build is running", async () => {
    const { service, docker } = serviceWith(async () => ({
      stdout: JSON.stringify(makeInspect("running")),
      stderr: "",
    }));

    await expect(service.logs("build-123")).rejects.toMatchObject({
      code: "build_running",
      status: 409,
    });
    expect(docker).toHaveBeenCalledTimes(1);
  });

  it("uses stdout as a fallback and marks truncated logs", async () => {
    const longLog = `${"a".repeat(249_999)}😀tail`;
    const docker = vi.fn<DockerCommand>(async (args) => {
      if (args.includes("inspect")) return { stdout: JSON.stringify(makeInspect()), stderr: "" };
      return { stdout: longLog, stderr: "" };
    });
    const service = new DockerBuildService(docker);

    const result = await service.logs("build-123");

    expect(result.text.startsWith("a".repeat(249_999))).toBe(true);
    expect(result.text).toContain("[로그 길이 제한으로 나머지 내용이 생략되었습니다.]");
    expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
