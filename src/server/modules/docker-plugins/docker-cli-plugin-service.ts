import { access, lstat, mkdir, realpath, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
  DockerCliPluginId,
  DockerCliPluginSnapshot,
  DockerCliPluginSummary,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { CommandError, type CommandRunner, runCommand } from "../../infrastructure/process.ts";
import type { OperationProgress } from "../operations/index.ts";

interface ResolvedCommand {
  executable: string;
  output: string;
}

export interface DockerCliPluginController {
  checkUpdates(progress?: OperationProgress): Promise<void>;
  getSnapshot(): Promise<DockerCliPluginSnapshot>;
  install(id: DockerCliPluginId, progress?: OperationProgress): Promise<void>;
  update(id: DockerCliPluginId, progress?: OperationProgress): Promise<void>;
}

const tools = [
  {
    id: "docker",
    formula: "docker",
    label: "Docker CLI",
    description: "Docker Engine을 제어하는 기본 명령 도구입니다.",
    management: "startup",
  },
  {
    id: "compose",
    formula: "docker-compose",
    label: "Docker Compose",
    description: "여러 컨테이너로 구성된 애플리케이션을 정의하고 실행합니다.",
    management: "startup",
  },
  {
    id: "buildx",
    formula: "docker-buildx",
    label: "Docker Buildx",
    description: "BuildKit 기반의 확장 빌드와 다중 플랫폼 빌드를 제공합니다.",
    management: "extensions",
  },
  {
    id: "lima",
    formula: "lima",
    label: "Lima",
    description: "macOS에서 단일 overseer VM과 Docker Engine을 실행합니다.",
    management: "startup",
  },
] as const;

interface FormulaUpdate {
  latestVersion: string;
  outdated: boolean;
}

async function canonicalPath(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function executablePath(executable: string): Promise<string | undefined> {
  const paths = executable.includes("/")
    ? [resolve(executable)]
    : (process.env.PATH ?? "").split(delimiter).map((directory) => resolve(directory, executable));
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Only report an executable path that exists.
    }
  }
  return undefined;
}

function within(path: string, directory: string | undefined): boolean {
  return Boolean(directory && path.startsWith(`${directory}${sep}`));
}

function comparableVersion(value: string): string {
  return value.replace(/^v/, "").replace(/_\d+$/, "");
}

function parseUpdates(output: string): Map<DockerCliPluginId, FormulaUpdate> {
  try {
    const value = JSON.parse(output) as {
      formulae?: Array<{ name?: string; versions?: { stable?: string }; outdated?: boolean }>;
    };
    const result = new Map<DockerCliPluginId, FormulaUpdate>();
    for (const tool of tools) {
      const formula = value.formulae?.find((item) => item.name === tool.formula);
      if (typeof formula?.versions?.stable !== "string" || typeof formula.outdated !== "boolean") {
        throw new Error("missing formula");
      }
      result.set(tool.id, { latestVersion: formula.versions.stable, outdated: formula.outdated });
    }
    return result;
  } catch {
    throw new ExpectedError(
      "docker_plugin_update_check_invalid",
      "Homebrew의 CLI 도구 버전 정보를 해석하지 못했습니다.",
      503,
    );
  }
}

function executableCandidates(name: "brew" | "docker" | "limactl"): string[] {
  const override =
    name === "brew"
      ? process.env.HOMEBREW_BREW_FILE
      : name === "docker"
        ? process.env.DOCKER_CLI
        : process.env.LIMACTL;
  return [
    ...(override ? [override] : []),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/home/linuxbrew/.linuxbrew/bin/${name}`,
    name,
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function failureDetail(error: unknown): string | undefined {
  if (!(error instanceof CommandError)) return undefined;
  return stripVTControlCharacters(error.stderr)
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 1_000);
}

function buildxVersion(output: string): string | undefined {
  return output.match(/\bv?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/)?.[1];
}

function composeVersion(output: string): string | undefined {
  return output.match(/Docker Compose version\s+v?([^\s]+)/)?.[1];
}

function limaVersion(output: string): string | undefined {
  return output.match(/limactl version\s+v?([^\s]+)/)?.[1];
}

export class DockerCliPluginService implements DockerCliPluginController {
  private readonly command: CommandRunner;
  private readonly homeDirectory: string;
  private checkedAt?: string;
  private updates = new Map<DockerCliPluginId, FormulaUpdate>();

  constructor(command: CommandRunner = runCommand, homeDirectory = homedir()) {
    this.command = command;
    this.homeDirectory = homeDirectory;
  }

  async getSnapshot(): Promise<DockerCliPluginSnapshot> {
    const [homebrew, docker, lima] = await Promise.all([
      this.probe(executableCandidates("brew"), ["--version"]),
      this.probe(executableCandidates("docker"), ["--version"]),
      this.probe(executableCandidates("limactl"), ["--version"]),
    ]);
    const [buildx, compose, paths, installations] = await Promise.all([
      docker ? this.probe([docker.executable], ["buildx", "version"]) : undefined,
      docker ? this.probe([docker.executable], ["compose", "version"]) : undefined,
      docker ? this.pluginPaths(docker.executable) : new Map<string, string>(),
      Promise.all(
        tools.map(async (tool) => {
          if (!homebrew) return {};
          const [current, cellar] = await Promise.all([
            this.homebrewPath(homebrew.executable, "--prefix", tool.formula),
            this.homebrewPath(homebrew.executable, "--cellar", tool.formula),
          ]);
          return { current, cellar };
        }),
      ),
    ]);
    const [dockerPath, limaPath] = await Promise.all([
      docker ? executablePath(docker.executable) : undefined,
      lima ? executablePath(lima.executable) : undefined,
    ]);
    const versions = {
      docker: docker ? docker.output.match(/Docker version\s+([^,\s]+)/)?.[1] : undefined,
      compose: compose ? composeVersion(compose.output) : undefined,
      buildx: buildx ? buildxVersion(buildx.output) : undefined,
      lima: lima ? limaVersion(lima.output) : undefined,
    };
    const commands = { docker, compose, buildx, lima };
    const plugins = await Promise.all(
      tools.map(async (tool, index): Promise<DockerCliPluginSummary> => {
        const installed = Boolean(commands[tool.id]);
        const path =
          tool.id === "docker" ? dockerPath : tool.id === "lima" ? limaPath : paths.get(tool.id);
        const canonical = await canonicalPath(path);
        const installation = installations[index];
        const managed = Boolean(canonical && within(canonical, installation?.current));
        const source =
          !installed || !canonical
            ? "unknown"
            : managed || within(canonical, installation?.cellar)
              ? "homebrew"
              : !homebrew || installation?.current || installation?.cellar
                ? "external"
                : "unknown";
        const checked = this.updates.get(tool.id);
        const version = versions[tool.id];
        const automaticUpdate = installed && managed && Boolean(version);
        const updateUnavailableReason = !installed
          ? "설치된 도구만 업데이트할 수 있습니다."
          : source === "external"
            ? "외부 설치 도구는 해당 설치 방식으로 업데이트하십시오."
            : !automaticUpdate
              ? "실행 경로가 Homebrew의 현재 관리 경로인지 확인하지 못해 자동 업데이트할 수 없습니다."
              : undefined;
        const installAvailable = tool.id === "buildx" && !installed && Boolean(homebrew && docker);
        return {
          automaticUpdate,
          description: tool.description,
          ...(installed && path ? { executablePath: path } : {}),
          id: tool.id,
          installAvailable,
          ...(!installed
            ? {
                installUnavailableReason:
                  tool.id !== "buildx"
                    ? "시작 준비에서 설치할 수 있습니다."
                    : !homebrew
                      ? "Homebrew를 먼저 설치해야 합니다."
                      : !docker
                        ? "Docker CLI를 먼저 설치해야 합니다."
                        : undefined,
              }
            : {}),
          installed,
          label: tool.label,
          management: tool.management,
          source,
          ...(version ? { version } : {}),
          ...(checked
            ? {
                latestVersion: checked.latestVersion,
                updateAvailable: automaticUpdate && checked.outdated,
              }
            : {}),
          ...(updateUnavailableReason ? { updateUnavailableReason } : {}),
        };
      }),
    );
    return {
      ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}),
      ...(plugins.some((tool) => tool.installed && tool.source === "unknown")
        ? {
            inspectionWarning:
              "일부 도구의 실행 경로 또는 관리 출처를 확인하지 못했습니다. 확인되지 않은 도구는 자동 업데이트하지 않습니다.",
          }
        : {}),
      plugins,
    };
  }

  async checkUpdates(progress?: OperationProgress): Promise<void> {
    const homebrew = await this.requireHomebrew();
    try {
      progress?.step("Homebrew 저장소 갱신 중");
      await this.command(homebrew.executable, ["update"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
      progress?.step("CLI 도구 버전 확인 중");
      await this.refreshUpdates(homebrew.executable);
      progress?.step("CLI 도구 업데이트 확인 완료");
    } catch (error) {
      this.updateFailure(
        error,
        "docker_plugin_update_check_failed",
        "CLI 도구 업데이트 확인에 실패했습니다.",
      );
    }
  }

  async update(id: DockerCliPluginId, progress?: OperationProgress): Promise<void> {
    const tool = tools.find((item) => item.id === id);
    if (!tool)
      throw new ExpectedError("invalid_docker_plugin", "지원하지 않는 CLI 도구입니다.", 400);
    if (!this.checkedAt)
      throw new ExpectedError(
        "docker_plugin_update_check_required",
        "먼저 CLI 도구 업데이트를 확인하십시오.",
        409,
      );
    const current = (await this.getSnapshot()).plugins.find((item) => item.id === id);
    if (!current?.automaticUpdate)
      throw new ExpectedError(
        "docker_plugin_update_unavailable",
        current?.updateUnavailableReason ?? "이 도구는 자동 업데이트할 수 없습니다.",
        409,
      );
    if (!current.updateAvailable)
      throw new ExpectedError(
        "docker_plugin_update_not_available",
        `${tool.label}는 업데이트할 항목이 없습니다.`,
        409,
      );
    const homebrew = await this.requireHomebrew();
    try {
      progress?.step(`${tool.label} 업데이트 중`);
      await this.command(homebrew.executable, ["upgrade", tool.formula], {
        onOutput: progress?.output,
        timeoutMs: 20 * 60_000,
      });
      await this.refreshUpdates(homebrew.executable);
      const verified = (await this.getSnapshot()).plugins.find((item) => item.id === id);
      if (
        !verified?.automaticUpdate ||
        !verified.version ||
        !verified.latestVersion ||
        comparableVersion(verified.version) !== comparableVersion(verified.latestVersion) ||
        verified.updateAvailable
      ) {
        throw new ExpectedError(
          "docker_plugin_update_verification_failed",
          `${tool.label} 업데이트 후 실제 실행 버전을 확인하지 못했습니다.`,
          503,
        );
      }
      progress?.step(`${tool.label} 업데이트 확인 완료`);
    } catch (error) {
      this.updateFailure(
        error,
        "docker_plugin_update_failed",
        `${tool.label} 업데이트에 실패했습니다.`,
      );
    }
  }

  async install(id: DockerCliPluginId, progress?: OperationProgress): Promise<void> {
    if (id !== "buildx") {
      throw new ExpectedError(
        "docker_plugin_install_unsupported",
        "Docker CLI와 Compose는 시작 준비에서 설치하십시오.",
        409,
      );
    }
    const [homebrew, docker] = await Promise.all([
      this.probe(executableCandidates("brew"), ["--version"]),
      this.probe(executableCandidates("docker"), ["--version"]),
    ]);
    if (!homebrew) {
      throw new ExpectedError("homebrew_required", "Homebrew를 먼저 설치해야 합니다.", 409);
    }
    if (!docker) {
      throw new ExpectedError("docker_cli_required", "Docker CLI를 먼저 설치해야 합니다.", 409);
    }
    if (await this.probe([docker.executable], ["buildx", "version"])) {
      throw new ExpectedError(
        "docker_plugin_installed",
        "Docker Buildx가 이미 설치되어 있습니다.",
        409,
      );
    }

    try {
      progress?.step("Docker Buildx 설치 중");
      await this.command(homebrew.executable, ["install", "docker-buildx"], {
        onOutput: progress?.output,
        timeoutMs: 20 * 60_000,
      });
      progress?.step("Docker Buildx 플러그인 연결 중");
      await this.ensurePluginLink(homebrew.executable, "docker-buildx");
      if (!(await this.probe([docker.executable], ["buildx", "version"]))) {
        throw new ExpectedError(
          "docker_plugin_verification_failed",
          "설치 후 docker buildx 명령을 실행할 수 없습니다.",
          503,
        );
      }
      progress?.step("Docker Buildx 설치 확인 완료");
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      const detail = failureDetail(error);
      throw new ExpectedError(
        "docker_plugin_install_failed",
        `Docker Buildx 설치에 실패했습니다.${detail ? ` ${detail}` : ""}`,
        503,
      );
    }
  }

  private async refreshUpdates(homebrew: string): Promise<void> {
    const response = await this.command(
      homebrew,
      ["info", "--json=v2", ...tools.map((tool) => tool.formula)],
      { timeoutMs: 2 * 60_000 },
    );
    this.updates = parseUpdates(response.stdout);
    this.checkedAt = new Date().toISOString();
  }

  private updateFailure(error: unknown, code: string, message: string): never {
    if (error instanceof ExpectedError) throw error;
    const detail = failureDetail(error);
    throw new ExpectedError(code, `${message}${detail ? ` ${detail}` : ""}`, 503);
  }

  private async requireHomebrew(): Promise<ResolvedCommand> {
    const homebrew = await this.probe(executableCandidates("brew"), ["--version"]);
    if (!homebrew)
      throw new ExpectedError("homebrew_required", "Homebrew를 먼저 설치해야 합니다.", 409);
    return homebrew;
  }

  private async homebrewPath(
    executable: string,
    flag: string,
    formula: string,
  ): Promise<string | undefined> {
    try {
      const response = await this.command(executable, [flag, formula], { timeoutMs: 5_000 });
      return await canonicalPath(response.stdout.trim());
    } catch {
      return undefined;
    }
  }

  private async pluginPaths(docker: string): Promise<Map<string, string>> {
    let output: string;
    try {
      output = (
        await this.command(docker, ["info", "--format", "{{json .ClientInfo.Plugins}}"], {
          timeoutMs: 5_000,
        })
      ).stdout;
    } catch (error) {
      // Docker still prints client plugin information when the Engine is unavailable.
      output = error instanceof CommandError ? error.stdout : "";
    }
    try {
      const metadata: unknown = JSON.parse(output);
      if (!Array.isArray(metadata)) return new Map();
      return new Map(
        metadata
          .filter(
            (item) =>
              item &&
              typeof item.Name === "string" &&
              typeof item.Path === "string" &&
              isAbsolute(item.Path) &&
              !item.Err &&
              !item.Error,
          )
          .map((item) => [item.Name, item.Path]),
      );
    } catch {
      return new Map();
    }
  }

  private async ensurePluginLink(homebrewExecutable: string, name: string): Promise<void> {
    const prefix = (
      await this.command(homebrewExecutable, ["--prefix"], { timeoutMs: 5_000 })
    ).stdout.trim();
    const source = join(prefix, "lib", "docker", "cli-plugins", name);
    const directory = join(this.homeDirectory, ".docker", "cli-plugins");
    const target = join(directory, name);
    await lstat(source);
    await mkdir(directory, { mode: 0o700, recursive: true });
    try {
      await lstat(target);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await symlink(source, target);
    }
  }

  private async probe(
    executables: readonly string[],
    args: readonly string[],
  ): Promise<ResolvedCommand | undefined> {
    for (const executable of executables) {
      try {
        const result = await this.command(executable, args, { timeoutMs: 5_000 });
        return { executable, output: [result.stdout, result.stderr].filter(Boolean).join("\n") };
      } catch {
        // Continue through stable executable locations.
      }
    }
    return undefined;
  }
}
