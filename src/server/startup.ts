import { lstat, mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
  StartupInstallTarget,
  StartupPrerequisite,
  StartupSnapshot,
} from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";
import type { CommandRunner } from "./lima-docker-runtime.ts";
import type { OperationProgress } from "./operations.ts";
import { CommandError, runCommand } from "./process.ts";

const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
const DOCKER_INSTALL_COMMAND = "brew install docker";
const COMPOSE_INSTALL_COMMAND = "brew install docker-compose";
const LIMA_INSTALL_COMMAND = "brew install lima";

interface ResolvedCommand {
  executable: string;
  output: string;
}

export interface StartupPrerequisiteController {
  getSnapshot(): Promise<StartupSnapshot>;
  install(target: StartupInstallTarget, progress?: OperationProgress): Promise<void>;
}

function candidates(name: "brew" | "docker" | "limactl"): string[] {
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

function version(output: string, prefix: RegExp): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line?.replace(prefix, "").trim() || undefined;
}

function capturedVersion(output: string, pattern: RegExp): string | undefined {
  return output.match(pattern)?.[1];
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class StartupPrerequisiteService implements StartupPrerequisiteController {
  private readonly command: CommandRunner;
  private readonly homeDirectory: string;

  constructor(command: CommandRunner = runCommand, homeDirectory = homedir()) {
    this.command = command;
    this.homeDirectory = homeDirectory;
  }

  async getSnapshot(): Promise<StartupSnapshot> {
    const [homebrew, docker, lima] = await Promise.all([
      this.probe(candidates("brew"), ["--version"]),
      this.probe(candidates("docker"), ["--version"]),
      this.probe(candidates("limactl"), ["--version"]),
    ]);
    const compose = docker
      ? await this.probe([docker.executable], ["compose", "version"])
      : undefined;
    const homebrewInstalled = Boolean(homebrew);
    const dockerVersion = docker
      ? capturedVersion(docker.output, /Docker version\s+([^,\s]+)/)
      : undefined;
    const composeVersion = compose
      ? capturedVersion(compose.output, /Docker Compose version\s+([^\s]+)/)
      : undefined;
    const prerequisites: StartupPrerequisite[] = [
      {
        automaticInstall: false,
        automaticInstallUnavailableReason:
          "Homebrew는 관리자 인증이 필요하므로 Terminal에서 설치해야 합니다.",
        description: "Docker CLI와 Lima를 설치하는 macOS 패키지 관리자입니다.",
        id: "homebrew",
        installCommand: HOMEBREW_INSTALL_COMMAND,
        installed: homebrewInstalled,
        label: "Homebrew",
        required: true,
        ...(homebrew
          ? { version: version(homebrew.output, /^Homebrew\s+/) }
          : { missingReason: "Homebrew 실행 파일을 찾을 수 없습니다." }),
      },
      {
        automaticInstall: homebrewInstalled,
        ...(homebrewInstalled
          ? {}
          : { automaticInstallUnavailableReason: "Homebrew를 먼저 설치해야 합니다." }),
        description: "Overseer가 Lima의 Docker Engine을 제어할 때 사용하는 명령 도구입니다.",
        id: "docker",
        installCommand: DOCKER_INSTALL_COMMAND,
        installed: Boolean(docker),
        label: "Docker CLI",
        required: true,
        ...(docker
          ? { version: dockerVersion }
          : { missingReason: "Docker CLI를 찾을 수 없습니다." }),
      },
      {
        automaticInstall: homebrewInstalled && Boolean(docker),
        ...(homebrewInstalled && docker
          ? {}
          : {
              automaticInstallUnavailableReason: homebrewInstalled
                ? "Docker CLI를 먼저 설치해야 합니다."
                : "Homebrew를 먼저 설치해야 합니다.",
            }),
        description: "Compose 프로젝트를 사용하려는 경우에만 추가로 설치합니다.",
        id: "compose",
        installCommand: COMPOSE_INSTALL_COMMAND,
        installed: Boolean(compose),
        label: "Docker Compose",
        required: false,
        ...(compose
          ? { version: composeVersion }
          : { missingReason: "Docker Compose 플러그인을 찾을 수 없습니다." }),
      },
      {
        automaticInstall: homebrewInstalled,
        ...(homebrewInstalled
          ? {}
          : { automaticInstallUnavailableReason: "Homebrew를 먼저 설치해야 합니다." }),
        description: "macOS에서 단일 overseer VM과 Docker Engine을 실행합니다.",
        id: "lima",
        installCommand: LIMA_INSTALL_COMMAND,
        installed: Boolean(lima),
        label: "Lima",
        required: true,
        ...(lima
          ? { version: version(lima.output, /^limactl version\s+/) }
          : { missingReason: "Lima 실행 파일을 찾을 수 없습니다." }),
      },
    ];
    return {
      prerequisites,
      ready: prerequisites.filter(({ required }) => required).every(({ installed }) => installed),
    };
  }

  async install(target: StartupInstallTarget, progress?: OperationProgress): Promise<void> {
    if (target === "homebrew") {
      throw new ExpectedError(
        "homebrew_manual_install_required",
        "Homebrew는 Terminal에서 공식 설치 명령을 실행하십시오.",
        409,
      );
    }
    const homebrew = await this.probe(candidates("brew"), ["--version"]);
    if (!homebrew) {
      throw new ExpectedError(
        "homebrew_required",
        "Homebrew를 먼저 설치한 뒤 다시 시도하십시오.",
        409,
      );
    }

    const label =
      target === "docker-with-compose"
        ? "Docker CLI와 Compose"
        : target === "docker"
          ? "Docker CLI"
          : target === "compose"
            ? "Docker Compose"
            : "Lima";
    try {
      progress?.step(`${label} 설치 중`);
      await this.command(
        homebrew.executable,
        [
          "install",
          ...(target === "docker-with-compose"
            ? ["docker", "docker-compose"]
            : target === "compose"
              ? ["docker-compose"]
              : [target]),
        ],
        { onOutput: progress?.output, timeoutMs: 20 * 60_000 },
      );
      if (target === "docker" || target === "docker-with-compose") {
        await this.requireDockerCli();
      }
      if (target === "compose" || target === "docker-with-compose") {
        await this.ensureDockerComposeReady(homebrew.executable, progress);
      }
      if (target === "lima" && !(await this.probe(candidates("limactl"), ["--version"]))) {
        throw new ExpectedError(
          "prerequisite_verification_failed",
          "Lima 설치 후 실행 파일을 찾을 수 없습니다.",
          503,
        );
      }
      progress?.step(`${label} 설치 확인 완료`);
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      const detail =
        error instanceof CommandError
          ? stripVTControlCharacters(error.stderr)
              .split(/\r?\n|\r/)
              .map((line) => line.trim())
              .filter(Boolean)
              .at(-1)
          : undefined;
      throw new ExpectedError(
        "prerequisite_install_failed",
        `${label} 설치에 실패했습니다.${detail ? ` ${detail.slice(0, 1_000)}` : ""}`,
        503,
      );
    }
  }

  private async requireDockerCli(): Promise<ResolvedCommand> {
    const docker = await this.probe(candidates("docker"), ["--version"]);
    if (!docker) {
      throw new ExpectedError(
        "prerequisite_verification_failed",
        "Docker CLI 설치 후 실행 파일을 찾을 수 없습니다.",
        503,
      );
    }
    return docker;
  }

  private async ensureDockerComposeReady(
    homebrewExecutable: string,
    progress?: OperationProgress,
  ): Promise<void> {
    const docker = await this.requireDockerCli();
    if (await this.probe([docker.executable], ["compose", "version"])) return;

    progress?.step("Docker Compose 플러그인 연결 중");
    const prefix = (
      await this.command(homebrewExecutable, ["--prefix"], { timeoutMs: 5_000 })
    ).stdout.trim();
    const source = join(prefix, "lib", "docker", "cli-plugins", "docker-compose");
    const directory = join(this.homeDirectory, ".docker", "cli-plugins");
    const target = join(directory, "docker-compose");
    await lstat(source);
    await mkdir(directory, { mode: 0o700, recursive: true });
    try {
      await lstat(target);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await symlink(source, target);
      progress?.output("Docker Compose 플러그인을 사용자 경로에 연결했습니다.\n");
    }
    if (!(await this.probe([docker.executable], ["compose", "version"]))) {
      throw new ExpectedError(
        "prerequisite_verification_failed",
        "Docker Compose 플러그인 설치 후 docker compose 명령을 실행할 수 없습니다.",
        503,
      );
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
        // Try the next stable executable location.
      }
    }
    return undefined;
  }
}
