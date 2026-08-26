import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandError, type CommandRunner } from "../src/server/infrastructure/process.ts";
import { StartupPrerequisiteService } from "../src/server/modules/startup/index.ts";

const temporaryDirectories: string[] = [];

function brewInfo(dockerOutdated: boolean): string {
  return JSON.stringify({
    formulae: [
      {
        name: "docker",
        outdated: dockerOutdated,
        versions: { stable: "30.0.0" },
      },
      {
        name: "docker-compose",
        outdated: false,
        versions: { stable: "5.5.0" },
      },
      {
        name: "lima",
        outdated: false,
        versions: { stable: "2.2.0" },
      },
    ],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("StartupPrerequisiteService", () => {
  it("keeps Compose optional after Docker CLI is available", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew") return { stderr: "", stdout: "Homebrew 5.0.0\n" };
      if (name === "docker" && args[0] === "--version") {
        return { stderr: "", stdout: "Docker version 29.7.2, build abc\n" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    await expect(service.getSnapshot()).resolves.toMatchObject({
      prerequisites: [
        { automaticInstall: false, id: "homebrew", installed: true, required: true },
        {
          automaticInstall: true,
          id: "docker",
          installed: true,
          required: true,
        },
        {
          automaticInstall: true,
          id: "compose",
          installed: false,
          missingReason: "Docker Compose 플러그인을 찾을 수 없습니다.",
          required: false,
        },
        { automaticInstall: true, id: "lima", installed: false, required: true },
      ],
      ready: false,
    });
  });

  it("installs Docker formulae and links the Compose plugin when discovery needs it", async () => {
    const root = await mkdtemp(join(tmpdir(), "overseer-startup-"));
    temporaryDirectories.push(root);
    const prefix = join(root, "homebrew");
    const home = join(root, "home");
    const composeSource = join(prefix, "lib", "docker", "cli-plugins", "docker-compose");
    const composeTarget = join(home, ".docker", "cli-plugins", "docker-compose");
    await mkdir(join(prefix, "lib", "docker", "cli-plugins"), { recursive: true });
    await writeFile(composeSource, "compose");
    let dockerInstalled = false;
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 5.0.0\n" };
      }
      if (name === "brew" && args[0] === "install") {
        dockerInstalled = true;
        return { stderr: "", stdout: "installed\n" };
      }
      if (name === "brew" && args[0] === "--prefix") {
        return { stderr: "", stdout: `${prefix}\n` };
      }
      if (name === "docker" && args[0] === "--version" && dockerInstalled) {
        return { stderr: "", stdout: "Docker version 29.7.2, build abc\n" };
      }
      if (name === "docker" && args[0] === "compose" && dockerInstalled) {
        try {
          await lstat(composeTarget);
          return { stderr: "", stdout: "Docker Compose version 5.5.0\n" };
        } catch {
          throw new Error("plugin missing");
        }
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command, home);
    const progress = { output: vi.fn(), step: vi.fn() };

    await service.install("docker-with-compose", progress);

    expect(command).toHaveBeenCalledWith(
      expect.stringMatching(/brew$/),
      ["install", "docker", "docker-compose"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
    expect((await lstat(composeTarget)).isSymbolicLink()).toBe(true);
    expect(progress.output).toHaveBeenCalledWith(
      "Docker Compose 플러그인을 사용자 경로에 연결했습니다.\n",
    );
    expect(progress.step).toHaveBeenLastCalledWith("Docker CLI와 Compose 설치 확인 완료");
    await expect(service.getSnapshot()).resolves.toMatchObject({
      prerequisites: expect.arrayContaining([
        expect.objectContaining({
          id: "docker",
          installed: true,
          version: "29.7.2",
        }),
        expect.objectContaining({
          id: "compose",
          installed: true,
          version: "5.5.0",
        }),
      ]),
    });
  });

  it("installs Docker CLI without Compose when selected", async () => {
    let dockerInstalled = false;
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 5.0.0\n" };
      }
      if (name === "brew" && args[0] === "install") {
        dockerInstalled = true;
        return { stderr: "", stdout: "installed\n" };
      }
      if (name === "docker" && args[0] === "--version" && dockerInstalled) {
        return { stderr: "", stdout: "Docker version 29.7.2, build abc\n" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    await service.install("docker");

    expect(command).toHaveBeenCalledWith(
      expect.stringMatching(/brew$/),
      ["install", "docker"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
    expect(vi.mocked(command).mock.calls.some(([, args]) => args.includes("docker-compose"))).toBe(
      false,
    );
  });

  it("installs Lima through Homebrew and verifies limactl", async () => {
    let limaInstalled = false;
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 5.0.0\n" };
      }
      if (name === "brew" && args[0] === "install") {
        limaInstalled = true;
        return { stderr: "", stdout: "installed\n" };
      }
      if (name === "limactl" && limaInstalled) {
        return { stderr: "", stdout: "limactl version 2.2.0\n" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    await service.install("lima");

    expect(command).toHaveBeenCalledWith(
      expect.stringMatching(/brew$/),
      ["install", "lima"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
  });

  it("keeps Homebrew installation manual", async () => {
    const command: CommandRunner = vi.fn(async () => {
      throw new Error("unused");
    });
    const service = new StartupPrerequisiteService(command);

    await expect(service.install("homebrew")).rejects.toMatchObject({
      code: "homebrew_manual_install_required",
    });
    expect(command).not.toHaveBeenCalled();
  });

  it("checks Homebrew versions and upgrades only an available formula", async () => {
    let dockerVersion = "29.7.2";
    let dockerOutdated = true;
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 6.0.18\n" };
      }
      if (name === "brew" && args[0] === "list") {
        return {
          stderr: "",
          stdout: `docker ${dockerVersion}\ndocker-compose 5.5.0\nlima 2.2.0\n`,
        };
      }
      if (name === "brew" && args[0] === "update") {
        return { stderr: "", stdout: "Already up-to-date.\n" };
      }
      if (name === "brew" && args[0] === "info") {
        return { stderr: "", stdout: brewInfo(dockerOutdated) };
      }
      if (name === "brew" && args[0] === "upgrade" && args[1] === "docker") {
        dockerVersion = "30.0.0";
        dockerOutdated = false;
        return { stderr: "", stdout: "docker upgraded\n" };
      }
      if (name === "docker" && args[0] === "--version") {
        return { stderr: "", stdout: `Docker version ${dockerVersion}, build abc\n` };
      }
      if (name === "docker" && args[0] === "compose") {
        return { stderr: "", stdout: "Docker Compose version 5.5.0\n" };
      }
      if (name === "limactl") {
        return { stderr: "", stdout: "limactl version 2.2.0\n" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);
    const progress = { output: vi.fn(), step: vi.fn() };

    await expect(service.update("docker")).rejects.toMatchObject({
      code: "tool_update_check_required",
    });
    await service.checkUpdates(progress);
    await expect(service.getUpdates()).resolves.toMatchObject({
      checkedAt: expect.any(String),
      items: [
        {
          automaticUpdate: true,
          currentVersion: "29.7.2",
          id: "docker",
          latestVersion: "30.0.0",
          managedByHomebrew: true,
          updateAvailable: true,
        },
        {
          automaticUpdate: true,
          currentVersion: "5.5.0",
          id: "compose",
          latestVersion: "5.5.0",
          updateAvailable: false,
        },
        {
          automaticUpdate: true,
          currentVersion: "2.2.0",
          id: "lima",
          latestVersion: "2.2.0",
          updateAvailable: false,
        },
      ],
    });

    await service.update("docker", progress);

    expect(command).toHaveBeenCalledWith(
      expect.stringMatching(/brew$/),
      ["upgrade", "docker"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
    const updated = await service.getUpdates();
    expect(updated.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentVersion: "30.0.0",
          id: "docker",
          updateAvailable: false,
        }),
      ]),
    );
  });

  it("does not automatically update a tool outside Homebrew", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      const name = basename(executable);
      if (name === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 6.0.18\n" };
      }
      if (name === "brew" && args[0] === "list") {
        return { stderr: "", stdout: "docker 29.7.2\ndocker-compose 5.5.0\n" };
      }
      if (name === "docker" && args[0] === "--version") {
        return { stderr: "", stdout: "Docker version 29.7.2, build abc\n" };
      }
      if (name === "docker" && args[0] === "compose") {
        return { stderr: "", stdout: "Docker Compose version 5.5.0\n" };
      }
      if (name === "limactl") {
        return { stderr: "", stdout: "limactl version 2.2.0\n" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    const updates = await service.getUpdates();

    expect(updates.items.find(({ id }) => id === "lima")).toMatchObject({
      automaticUpdate: false,
      automaticUpdateUnavailableReason: "Homebrew로 설치된 도구만 자동 업데이트할 수 있습니다.",
      managedByHomebrew: false,
    });
  });

  it("rejects an invalid Homebrew update response", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (basename(executable) === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 6.0.18\n" };
      }
      if (basename(executable) === "brew" && args[0] === "update") {
        return { stderr: "", stdout: "Already up-to-date.\n" };
      }
      if (basename(executable) === "brew" && args[0] === "info") {
        return { stderr: "", stdout: "not-json" };
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    await expect(service.checkUpdates()).rejects.toMatchObject({
      code: "tool_update_check_invalid",
    });
  });

  it("preserves the package manager failure detail", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (basename(executable) === "brew" && args[0] === "--version") {
        return { stderr: "", stdout: "Homebrew 5.0.0\n" };
      }
      if (basename(executable) === "brew" && args[0] === "install") {
        throw new CommandError(
          "brew install lima",
          Object.assign(new Error("failed"), { code: 1 }),
          "download failed\n",
        );
      }
      throw new Error("missing");
    });
    const service = new StartupPrerequisiteService(command);

    await expect(service.install("lima")).rejects.toMatchObject({
      code: "prerequisite_install_failed",
      message: "Lima 설치에 실패했습니다. download failed",
    });
  });
});
