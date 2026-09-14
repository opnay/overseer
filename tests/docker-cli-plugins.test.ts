import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DockerCliPluginService } from "../src/server/modules/docker-plugins/index.ts";
import type { CommandRunner } from "../src/server/infrastructure/process.ts";

describe("DockerCliPluginService", () => {
  it("reports Buildx and Compose from Docker CLI commands", async () => {
    const command = vi.fn<CommandRunner>(async (executable, args) => {
      if (args[0] === "--version") {
        if (executable.includes("brew")) return { stderr: "", stdout: "Homebrew 5.0.0" };
        if (executable.includes("docker")) {
          return { stderr: "", stdout: "Docker version 29.0.0, build test" };
        }
      }
      if (args.join(" ") === "buildx version") {
        return { stderr: "", stdout: "github.com/docker/buildx v0.29.1 test" };
      }
      if (args.join(" ") === "compose version") {
        return { stderr: "", stdout: "Docker Compose version v2.40.0" };
      }
      throw new Error("not found");
    });

    const snapshot = await new DockerCliPluginService(command).getSnapshot();

    expect(snapshot.plugins).toEqual([
      expect.objectContaining({ id: "buildx", installed: true, version: "0.29.1" }),
      expect.objectContaining({ id: "compose", installed: true, version: "2.40.0" }),
    ]);
  });

  it("installs, links, and verifies Buildx", async () => {
    const root = await mkdtemp(join(tmpdir(), "overseer-buildx-test-"));
    const prefix = join(root, "homebrew");
    const home = join(root, "home");
    const source = join(prefix, "lib", "docker", "cli-plugins", "docker-buildx");
    await mkdir(join(prefix, "lib", "docker", "cli-plugins"), { recursive: true });
    await writeFile(source, "buildx");
    let installed = false;
    const command = vi.fn<CommandRunner>(async (executable, args) => {
      if (args[0] === "--version") {
        if (executable.includes("brew")) return { stderr: "", stdout: "Homebrew 5.0.0" };
        if (executable.includes("docker")) {
          return { stderr: "", stdout: "Docker version 29.0.0, build test" };
        }
      }
      if (args.join(" ") === "buildx version") {
        if (!installed) throw new Error("not found");
        return { stderr: "", stdout: "github.com/docker/buildx v0.29.1 test" };
      }
      if (args.join(" ") === "install docker-buildx") {
        installed = true;
        return { stderr: "", stdout: "installed" };
      }
      if (args.join(" ") === "--prefix") return { stderr: "", stdout: `${prefix}\n` };
      throw new Error("unexpected command");
    });

    await new DockerCliPluginService(command, home).install("buildx");

    expect(command).toHaveBeenCalledWith(
      expect.stringContaining("brew"),
      ["install", "docker-buildx"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
    const target = join(home, ".docker", "cli-plugins", "docker-buildx");
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
  });

  it("does not install Compose from the extensions service", async () => {
    await expect(new DockerCliPluginService(vi.fn()).install("compose")).rejects.toMatchObject({
      code: "docker_plugin_install_unsupported",
      status: 409,
    });
  });
});
