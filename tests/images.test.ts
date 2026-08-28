import { describe, expect, it, vi } from "vitest";
import { DockerImageService } from "../src/server/modules/images/index.ts";
import type { DockerCommand } from "../src/server/modules/docker/index.ts";

const imageId = "sha256:3e24e96c89efff0e3a4b0698cbdd36c15ad3022371db57166e5588853002ee5c";
const tags = ["louislam/uptime-kuma:2", "louislam/uptime-kuma:2.5.3", "louislam/uptime-kuma:next"];

function inspectOutput(id = imageId, repositoryTags = tags): string {
  return JSON.stringify([
    {
      Architecture: "arm64",
      Created: "2026-08-27T00:00:00.000Z",
      Id: id,
      Os: "linux",
      RepoTags: repositoryTags,
      Size: 1,
    },
  ]);
}

describe("DockerImageService removal", () => {
  it("removes one tag only after confirming that it still points to the expected image", async () => {
    const docker = vi.fn(async (args: readonly string[]) => ({
      stderr: "",
      stdout: args[1] === "inspect" ? inspectOutput() : "",
    }));
    const service = new DockerImageService(docker as DockerCommand);

    await service.removeTag({ id: imageId.slice(7, 19), reference: tags[1]! });

    expect(docker.mock.calls.map(([args]) => args)).toEqual([
      ["image", "inspect", tags[1]],
      ["image", "rm", tags[1]],
    ]);
  });

  it("rejects a stale tag without deleting its new target", async () => {
    const docker = vi.fn(async () => ({
      stderr: "",
      stdout: inspectOutput(`sha256:${"a".repeat(64)}`),
    }));
    const service = new DockerImageService(docker as DockerCommand);

    await expect(
      service.removeTag({ id: imageId.slice(7, 19), reference: tags[1]! }),
    ).rejects.toThrow("다른 이미지를 가리킵니다");
    expect(docker).toHaveBeenCalledTimes(1);
  });

  it("removes every tag when deleting an unused image ID", async () => {
    const docker = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "image" && args[1] === "inspect") {
        return { stderr: "", stdout: inspectOutput() };
      }
      return { stderr: "", stdout: "" };
    });
    const service = new DockerImageService(docker as DockerCommand);

    await service.remove(imageId.slice(7, 19));

    expect(docker.mock.calls.map(([args]) => args)).toContainEqual(["image", "rm", ...tags]);
  });

  it("blocks image deletion before removing tags when a container uses the image", async () => {
    const docker = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "image" && args[1] === "inspect") {
        return { stderr: "", stdout: inspectOutput() };
      }
      if (args[0] === "ps") {
        return { stderr: "", stdout: '{"ID":"container-id","Names":"uptime-kuma"}\n' };
      }
      return { stderr: "", stdout: "" };
    });
    const service = new DockerImageService(docker as DockerCommand);

    await expect(service.remove(imageId.slice(7, 19))).rejects.toThrow("uptime-kuma");
    expect(docker.mock.calls.some(([args]) => args[0] === "image" && args[1] === "rm")).toBe(false);
  });
});
