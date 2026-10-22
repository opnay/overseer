import { lstat, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerCliPluginService } from "../src/server/modules/docker-plugins/index.ts";
import { CommandError, type CommandRunner } from "../src/server/infrastructure/process.ts";

describe("DockerCliPluginService", () => {
  it("reports Buildx and Compose from Docker CLI commands", async () => {
    const command = vi.fn<CommandRunner>(async (executable, args) => {
      if (args[0] === "--version") {
        if (executable.endsWith("/brew") || executable == "brew")
          return { stderr: "", stdout: "Homebrew 5.0.0" };
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
      expect.objectContaining({ id: "docker", installed: true, version: "29.0.0" }),
      expect.objectContaining({ id: "compose", installed: true, version: "2.40.0" }),
      expect.objectContaining({ id: "buildx", installed: true, version: "0.29.1" }),
      expect.objectContaining({
        id: "lima",
        installed: false,
        management: "startup",
        source: "unknown",
      }),
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
        if (executable.endsWith("/brew") || executable == "brew")
          return { stderr: "", stdout: "Homebrew 5.0.0" };
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

async function toolFixture() {
  const root = await mkdtemp(join(tmpdir(), "overseer-cli-tools-"));
  const definitions = [
    { id: "docker", formula: "docker", binary: "bin/docker", version: "29.0.0", latest: "30.0.0" },
    {
      id: "compose",
      formula: "docker-compose",
      binary: "lib/docker/cli-plugins/docker-compose",
      version: "2.40.0",
      latest: "2.40.0",
    },
    {
      id: "buildx",
      formula: "docker-buildx",
      binary: "lib/docker/cli-plugins/docker-buildx",
      version: "0.29.1",
      latest: "0.30.0",
    },
    {
      id: "lima",
      formula: "lima",
      binary: "bin/limactl",
      version: "1.0.0",
      latest: "1.1.0",
    },
  ];
  const paths = new Map<string, string>();
  for (const tool of definitions) {
    const path = join(root, tool.formula, "current", tool.binary);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "binary", { mode: 0o755 });
    paths.set(tool.id, path);
  }
  const external = join(root, "external-buildx");
  const externalLima = join(root, "limactl-shim");
  await writeFile(external, "external", { mode: 0o755 });
  await writeFile(join(root, "external-limactl"), "limactl", { mode: 0o755 });
  await symlink(join(root, "external-limactl"), externalLima);
  vi.stubEnv("DOCKER_CLI", paths.get("docker")!);
  vi.stubEnv("LIMACTL", paths.get("lima")!);
  const state = {
    external: false,
    offline: false,
    invalid: false,
    brokenUpgrade: false,
    missingMetadata: false,
    dockerInstalled: true,
    limaInstalled: true,
    upgraded: new Set<string>(),
  };
  const command = vi.fn<CommandRunner>(async (executable, args) => {
    const text = args.join(" ");
    if (text === "--version") {
      if (executable.endsWith("/brew") || executable === "brew")
        return { stderr: "", stdout: "Homebrew 5.0.0" };
      if (
        executable === paths.get("lima") ||
        executable === externalLima ||
        executable.endsWith("/limactl")
      ) {
        if (!state.limaInstalled) throw new Error("not found");
        return {
          stderr: "",
          stdout: `limactl version ${state.upgraded.has("lima") ? "1.1.0" : "1.0.0"}`,
        };
      }
      if (executable.includes("docker")) {
        if (!state.dockerInstalled) throw new Error("not found");
        return {
          stderr: "",
          stdout: `Docker version ${state.upgraded.has("docker") ? "30.0.0" : "29.0.0"}, build test`,
        };
      }
    }
    if (text === "compose version") return { stderr: "", stdout: "Docker Compose version v2.40.0" };
    if (text === "buildx version")
      return {
        stderr: "",
        stdout: `github.com/docker/buildx v${state.upgraded.has("docker-buildx") ? "0.30.0" : "0.29.1"} test`,
      };
    if (args[0] === "--prefix") return { stderr: "", stdout: join(root, args[1]!, "current") };
    if (args[0] === "--cellar") return { stderr: "", stdout: join(root, args[1]!) };
    if (args[0] === "info" && args[1] === "--format") {
      const stdout = state.missingMetadata
        ? "null"
        : JSON.stringify(
            definitions
              .filter((tool) => tool.id !== "docker")
              .map((tool) => ({
                Name: tool.id,
                Path: tool.id === "buildx" && state.external ? external : paths.get(tool.id),
              })),
          );
      if (state.offline)
        throw new CommandError(
          text,
          Object.assign(new Error("unavailable"), { code: 1 }),
          "Engine unavailable",
          stdout,
        );
      return { stderr: "", stdout };
    }
    if (args[0] === "info" && args[1] === "--json=v2")
      return {
        stderr: "",
        stdout: state.invalid
          ? '{"formulae":[]}'
          : JSON.stringify({
              formulae: definitions.map((tool) => ({
                name: tool.formula,
                versions: { stable: tool.latest },
                outdated: tool.version !== tool.latest && !state.upgraded.has(tool.formula),
              })),
            }),
      };
    if (text === "update") return { stderr: "", stdout: "updated" };
    if (args[0] === "upgrade") {
      if (!state.brokenUpgrade) state.upgraded.add(args[1]!);
      return { stderr: "", stdout: "upgraded" };
    }
    throw new Error(`unexpected command ${text}`);
  });
  return {
    command,
    state,
    paths,
    externalLima,
    service: new DockerCliPluginService(command, join(root, "home")),
  };
}

describe("CLI tool provenance and updates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports actual paths while the Engine is offline without mutating Homebrew", async () => {
    const { service, state, paths, command } = await toolFixture();
    state.offline = true;
    const snapshot = await service.getSnapshot();
    expect(snapshot.plugins).toEqual([
      expect.objectContaining({
        id: "docker",
        executablePath: paths.get("docker"),
        source: "homebrew",
        automaticUpdate: true,
      }),
      expect.objectContaining({
        id: "compose",
        executablePath: paths.get("compose"),
        source: "homebrew",
        automaticUpdate: true,
      }),
      expect.objectContaining({
        id: "buildx",
        executablePath: paths.get("buildx"),
        source: "homebrew",
        automaticUpdate: true,
      }),
      expect.objectContaining({
        id: "lima",
        executablePath: paths.get("lima"),
        source: "homebrew",
        automaticUpdate: true,
        management: "startup",
        version: "1.0.0",
      }),
    ]);
    expect(
      command.mock.calls.some(([, args]) => ["update", "upgrade", "install"].includes(args[0]!)),
    ).toBe(false);
    expect(snapshot.checkedAt).toBeUndefined();
  });

  it("detects and updates Homebrew-managed Lima independently of Docker", async () => {
    const { service, state, command, paths } = await toolFixture();
    state.dockerInstalled = false;

    const before = await service.getSnapshot();
    expect(before.plugins.find((tool) => tool.id === "lima")).toMatchObject({
      automaticUpdate: true,
      executablePath: paths.get("lima"),
      installed: true,
      management: "startup",
      source: "homebrew",
      version: "1.0.0",
    });
    expect(
      command.mock.calls.some(([, args]) => args[0] === "info" && args[1] === "--format"),
    ).toBe(false);

    await service.checkUpdates();
    expect(
      command.mock.calls.find(([, args]) => args[0] === "info" && args[1] === "--json=v2")?.[1],
    ).toContain("lima");
    await service.update("lima");

    expect(command).toHaveBeenCalledWith(
      expect.stringContaining("brew"),
      ["upgrade", "lima"],
      expect.objectContaining({ timeoutMs: 20 * 60_000 }),
    );
    expect((await service.getSnapshot()).plugins.find((tool) => tool.id === "lima")).toMatchObject({
      version: "1.1.0",
      latestVersion: "1.1.0",
      updateAvailable: false,
    });
  });

  it("does not automatically update a Lima executable supplied by an external shim", async () => {
    const { service, command, externalLima } = await toolFixture();
    vi.stubEnv("LIMACTL", externalLima);
    await service.checkUpdates();

    expect((await service.getSnapshot()).plugins.find((tool) => tool.id === "lima")).toMatchObject({
      automaticUpdate: false,
      installed: true,
      source: "external",
      version: "1.0.0",
    });
    await expect(service.update("lima")).rejects.toMatchObject({
      code: "docker_plugin_update_unavailable",
      status: 409,
    });
    expect(command.mock.calls.some(([, args]) => args[0] === "upgrade" && args[1] === "lima")).toBe(
      false,
    );
  });

  it("reports missing Lima without requiring Docker", async () => {
    const { service, state, command } = await toolFixture();
    state.dockerInstalled = false;
    state.limaInstalled = false;

    const lima = (await service.getSnapshot()).plugins.find((tool) => tool.id === "lima");

    expect(lima).toMatchObject({
      automaticUpdate: false,
      installed: false,
      management: "startup",
      source: "unknown",
    });
    expect(lima?.installUnavailableReason).toContain("시작 준비");
    expect(
      command.mock.calls.some(([, args]) => args[0] === "info" && args[1] === "--format"),
    ).toBe(false);
  });

  it("refuses to upgrade a same-version external plugin even when its Homebrew formula is installed", async () => {
    const { service, state, command } = await toolFixture();
    await service.checkUpdates();
    state.external = true;
    expect(
      (await service.getSnapshot()).plugins.find((tool) => tool.id === "buildx"),
    ).toMatchObject({
      source: "external",
      installed: true,
      automaticUpdate: false,
      version: "0.29.1",
    });
    await expect(service.update("buildx")).rejects.toMatchObject({
      code: "docker_plugin_update_unavailable",
      status: 409,
    });
    expect(command.mock.calls.some(([, args]) => args[0] === "upgrade")).toBe(false);
  });

  it("requires an explicit check and verifies the version actually used after upgrading", async () => {
    const { service, command } = await toolFixture();
    await expect(service.update("buildx")).rejects.toMatchObject({
      code: "docker_plugin_update_check_required",
    });
    await service.checkUpdates();
    await service.update("buildx");
    expect(
      (await service.getSnapshot()).plugins.find((tool) => tool.id === "buildx"),
    ).toMatchObject({ version: "0.30.0", latestVersion: "0.30.0", updateAvailable: false });
    expect(
      command.mock.calls.filter(([, args]) => args[0] === "upgrade").map(([, args]) => args),
    ).toEqual([["upgrade", "docker-buildx"]]);
  });

  it("fails verification when a successful upgrade command leaves the active version unchanged", async () => {
    const { service, state } = await toolFixture();
    await service.checkUpdates();
    state.brokenUpgrade = true;
    await expect(service.update("buildx")).rejects.toMatchObject({
      code: "docker_plugin_update_verification_failed",
      status: 503,
    });
  });

  it("keeps the last successful check when new formula metadata is incomplete", async () => {
    const { service, state } = await toolFixture();
    await service.checkUpdates();
    const before = await service.getSnapshot();
    state.invalid = true;
    await expect(service.checkUpdates()).rejects.toMatchObject({
      code: "docker_plugin_update_check_invalid",
    });
    expect((await service.getSnapshot()).checkedAt).toBe(before.checkedAt);
    expect(
      (await service.getSnapshot()).plugins.find((tool) => tool.id === "buildx")?.latestVersion,
    ).toBe("0.30.0");
  });

  it("keeps installed tools visible but disables updates when the execution path is unknown", async () => {
    const { service, state, command } = await toolFixture();
    await service.checkUpdates();
    state.missingMetadata = true;
    const snapshot = await service.getSnapshot();
    expect(snapshot.inspectionWarning).toBeTruthy();
    expect(snapshot.plugins.find((tool) => tool.id === "buildx")).toMatchObject({
      installed: true,
      source: "unknown",
      automaticUpdate: false,
    });
    await expect(service.update("buildx")).rejects.toMatchObject({
      code: "docker_plugin_update_unavailable",
    });
    expect(command.mock.calls.some(([, args]) => args[0] === "upgrade")).toBe(false);
  });
});
