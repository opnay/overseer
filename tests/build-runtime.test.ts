import { describe, expect, it, vi } from "vitest";
import { LimaDockerRuntime } from "../src/server/infrastructure/lima/lima-docker-runtime.ts";
import type { CommandRunner } from "../src/server/infrastructure/process.ts";
import { MemoryRuntimeInstanceStore } from "../src/server/modules/instances/index.ts";

describe("build history runtime scope", () => {
  it("pins an in-flight read to the selected engine socket without selecting a global builder", async () => {
    const store = new MemoryRuntimeInstanceStore();
    store.setActiveInstanceName("first");
    const command = vi.fn<CommandRunner>(async (executable) => {
      if (executable === "limactl") {
        store.setActiveInstanceName("second");
        return { stdout: "first\tRunning\t/tmp/first\n", stderr: "" };
      }
      return {
        stdout:
          '{"ref":"default/default/build123","name":"web","status":"Completed","created_at":"2026-11-11T00:00:00Z","completed_at":"2026-11-11T00:00:01Z"}',
        stderr: "",
      };
    });
    const runtime = new LimaDockerRuntime(command, undefined, undefined, undefined, store);
    const result = await runtime.getBuildHistory({ page: 1, pageSize: 20 }, "first");
    expect(result.instance).toBe("first");
    expect(result.records[0]?.id).toBe("build123");
    const dockerCalls = command.mock.calls.filter(([executable]) => executable === "docker");
    expect(dockerCalls).toHaveLength(1);
    expect(dockerCalls[0]?.[1]).toEqual([
      "--host",
      "unix:///tmp/first/sock/docker.sock",
      "buildx",
      "--builder",
      "default",
      "history",
      "ls",
      "--format",
      "json",
    ]);
  });

  it("rejects a detail link for another engine before executing any command", async () => {
    const store = new MemoryRuntimeInstanceStore();
    store.setActiveInstanceName("second");
    const command = vi.fn<CommandRunner>();
    const runtime = new LimaDockerRuntime(command, undefined, undefined, undefined, store);
    await expect(runtime.getBuild("build123", "first")).rejects.toMatchObject({
      code: "build_instance_changed",
      status: 409,
    });
    expect(command).not.toHaveBeenCalled();
  });
});
