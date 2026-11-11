import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/server/infrastructure/process.ts";
import { DockerBuildService } from "../src/server/modules/builds/index.ts";
import type { DockerCommand } from "../src/server/modules/docker/index.ts";

function serviceWithLargeOutput() {
  const docker = vi.fn<DockerCommand>(async (args) => {
    if (args.includes("inspect")) {
      return {
        stdout: JSON.stringify({
          Name: "large",
          Status: "completed",
          StartedAt: "2026-11-11T00:00:00Z",
        }),
        stderr: "",
      };
    }
    return runCommand(
      process.execPath,
      ["-e", "process.stderr.write('x'.repeat(11 * 1024 * 1024))"],
      { timeoutMs: 5000 },
    );
  });
  return new DockerBuildService(docker);
}

describe("large build output through the real command runner", () => {
  it("retains a bounded plain-log prefix and explicitly marks truncation", async () => {
    const result = await serviceWithLargeOutput().logs("large-build");
    expect(result.text.startsWith("x".repeat(250_000))).toBe(true);
    expect(result.text).toContain("[로그 길이 제한으로 나머지 내용이 생략되었습니다.]");
    expect(result.text.length).toBeLessThan(251_000);
  });

  it("does not parse a partial rawjson event and directs the user to plain logs", async () => {
    await expect(serviceWithLargeOutput().steps("large-build")).rejects.toMatchObject({
      code: "build_steps_too_large",
      status: 413,
      message: expect.stringContaining("로그 탭"),
    });
  });
});
