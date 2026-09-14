import { lstat, mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { DockerCliPluginId, DockerCliPluginSnapshot } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { CommandError, type CommandRunner, runCommand } from "../../infrastructure/process.ts";
import type { OperationProgress } from "../operations/index.ts";

interface ResolvedCommand {
  executable: string;
  output: string;
}

export interface DockerCliPluginController {
  getSnapshot(): Promise<DockerCliPluginSnapshot>;
  install(id: DockerCliPluginId, progress?: OperationProgress): Promise<void>;
}

function executableCandidates(name: "brew" | "docker"): string[] {
  const override = name === "brew" ? process.env.HOMEBREW_BREW_FILE : process.env.DOCKER_CLI;
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

export class DockerCliPluginService implements DockerCliPluginController {
  private readonly command: CommandRunner;
  private readonly homeDirectory: string;

  constructor(command: CommandRunner = runCommand, homeDirectory = homedir()) {
    this.command = command;
    this.homeDirectory = homeDirectory;
  }

  async getSnapshot(): Promise<DockerCliPluginSnapshot> {
    const [homebrew, docker] = await Promise.all([
      this.probe(executableCandidates("brew"), ["--version"]),
      this.probe(executableCandidates("docker"), ["--version"]),
    ]);
    const [buildx, compose] = docker
      ? await Promise.all([
          this.probe([docker.executable], ["buildx", "version"]),
          this.probe([docker.executable], ["compose", "version"]),
        ])
      : [undefined, undefined];
    const installAvailable = Boolean(homebrew && docker);
    const unavailableReason = !homebrew
      ? "Homebrew를 먼저 설치해야 합니다."
      : !docker
        ? "Docker CLI를 먼저 설치해야 합니다."
        : undefined;

    return {
      plugins: [
        {
          description: "BuildKit 기반의 확장 빌드와 다중 플랫폼 빌드를 제공합니다.",
          id: "buildx",
          installAvailable: !buildx && installAvailable,
          ...(!buildx && unavailableReason ? { installUnavailableReason: unavailableReason } : {}),
          installed: Boolean(buildx),
          label: "Docker Buildx",
          management: "extensions",
          source: "homebrew",
          ...(buildx ? { version: buildxVersion(buildx.output) } : {}),
        },
        {
          description: "여러 컨테이너로 구성된 애플리케이션을 정의하고 실행합니다.",
          id: "compose",
          installAvailable: false,
          installUnavailableReason: "Docker Compose는 시작 준비에서 관리합니다.",
          installed: Boolean(compose),
          label: "Docker Compose",
          management: "startup",
          source: "homebrew",
          ...(compose ? { version: composeVersion(compose.output) } : {}),
        },
      ],
    };
  }

  async install(id: DockerCliPluginId, progress?: OperationProgress): Promise<void> {
    if (id !== "buildx") {
      throw new ExpectedError(
        "docker_plugin_install_unsupported",
        "Docker Compose는 시작 준비에서 설치하십시오.",
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
