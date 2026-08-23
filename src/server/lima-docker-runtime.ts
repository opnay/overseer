import { stripVTControlCharacters } from "node:util";
import type {
  ComposeProjectAction,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ComposeServiceSummary,
  ContainerSummary,
  CreateNamedResourceInput,
  DashboardSnapshot,
  ImageSummary,
  NetworkSummary,
  PullImageInput,
  RunContainerInput,
  RuntimeSnapshot,
  VolumeSummary,
} from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";
import { CommandError, parseJsonLines, runCommand } from "./process.ts";

export interface RuntimeController {
  composeProjectAction(name: string, action: ComposeProjectAction): Promise<void>;
  containerAction(id: string, action: "restart" | "start" | "stop"): Promise<void>;
  createNetwork(input: CreateNamedResourceInput): Promise<void>;
  createVolume(input: CreateNamedResourceInput): Promise<void>;
  getContainerLogs(id: string): Promise<string>;
  getComposeProject(name: string): Promise<ComposeProjectDetail>;
  getComposeProjectLogs(name: string): Promise<string>;
  getComposeProjects(): Promise<ComposeProjectSummary[]>;
  getDashboard(): Promise<DashboardSnapshot>;
  pullImage(input: PullImageInput): Promise<void>;
  removeContainer(id: string): Promise<void>;
  removeImage(id: string): Promise<void>;
  removeNetwork(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  runContainer(input: RunContainerInput): Promise<void>;
  startRuntime(): Promise<RuntimeSnapshot>;
  stopRuntime(): Promise<RuntimeSnapshot>;
}

interface LimaInstance {
  directory: string;
  status: string;
}

interface DockerContainerRow {
  ID: string;
  Image: string;
  Labels: string;
  Names: string;
  Ports: string;
  State: string;
  Status: string;
}

interface DockerComposeProjectRow {
  ConfigFiles: string;
  Name: string;
  Status: string;
}

interface DockerComposeServiceRow {
  Health: string;
  ID: string;
  Image: string;
  Name: string;
  Ports: string;
  Service: string;
  State: string;
  Status: string;
}

interface DockerImageRow {
  CreatedSince: string;
  ID: string;
  Repository: string;
  Size: string;
  Tag: string;
}

interface DockerVolumeRow {
  Driver: string;
  Labels: string;
  Name: string;
  Scope: string;
}

interface DockerNetworkRow {
  CreatedAt: string;
  Driver: string;
  ID: string;
  IPv4: string;
  IPv6: string;
  Internal: string;
  Labels: string;
  Name: string;
  Scope: string;
}

const LIMA_INSTANCE = process.env.OVERSEER_LIMA_INSTANCE ?? "overseer";
const LIMA_ROW_FORMAT = "{{.Name}}\t{{.Status}}\t{{.Dir}}";
const CONTAINER_ROW_FORMAT = "{{json .}}";
const IMAGE_ROW_FORMAT = "{{json .}}";
const VOLUME_ROW_FORMAT = "{{json .}}";
const NETWORK_ROW_FORMAT = "{{json .}}";
const BUILT_IN_NETWORKS = new Set(["bridge", "host", "none"]);

function composeProjectRows(stdout: string): DockerComposeProjectRow[] {
  try {
    const value = JSON.parse(stdout || "[]") as unknown;
    if (Array.isArray(value)) return value as DockerComposeProjectRow[];
  } catch {
    // Fall through to the stable local error below.
  }
  throw new ExpectedError(
    "invalid_compose_output",
    "Docker Compose 프로젝트 목록을 해석하지 못했습니다.",
    503,
  );
}

function dockerLabel(labels: string, name: string): string | undefined {
  const prefix = `${name}=`;
  const value = labels.split(",").find((label) => label.startsWith(prefix));
  return value?.slice(prefix.length) || undefined;
}

export class LimaDockerRuntime implements RuntimeController {
  private transition?: Promise<RuntimeSnapshot>;

  async getDashboard(): Promise<DashboardSnapshot> {
    const runtime = await this.getRuntimeSnapshot();
    if (runtime.phase !== "running") {
      return {
        composeProjects: [],
        containers: [],
        images: [],
        networks: [],
        runtime,
        volumes: [],
      };
    }

    const [composeProjects, containers, images, volumes, networks] = await Promise.all([
      this.getComposeProjects(),
      this.listContainers(),
      this.listImages(),
      this.listVolumes(),
      this.listNetworks(),
    ]);
    return { composeProjects, containers, images, networks, runtime, volumes };
  }

  startRuntime(): Promise<RuntimeSnapshot> {
    if (this.transition) return this.transition;

    this.transition = this.startRuntimeOnce().finally(() => {
      this.transition = undefined;
    });
    return this.transition;
  }

  async stopRuntime(): Promise<RuntimeSnapshot> {
    if (this.transition) {
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    }

    const instance = await this.getInstance();
    if (!instance) return this.missingSnapshot();
    if (instance.status.toLowerCase() === "stopped") return this.stoppedSnapshot();

    await runCommand("limactl", ["stop", LIMA_INSTANCE], { timeoutMs: 120_000 });
    return this.stoppedSnapshot();
  }

  async runContainer(input: RunContainerInput): Promise<void> {
    const args = ["run", "--detach"];
    if (input.name) args.push("--name", input.name);
    if (input.containerPort) {
      args.push("--publish", `127.0.0.1::${input.containerPort}`);
    }
    args.push(input.image);
    await this.docker(args, 10 * 60_000);
  }

  async containerAction(id: string, action: "restart" | "start" | "stop"): Promise<void> {
    await this.docker([action, id], 120_000);
  }

  async removeContainer(id: string): Promise<void> {
    await this.docker(["container", "rm", id]);
  }

  async getContainerLogs(id: string): Promise<string> {
    const result = await this.docker(["logs", "--tail", "300", "--timestamps", id]);
    return stripVTControlCharacters(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).trim();
  }

  async getComposeProjects(): Promise<ComposeProjectSummary[]> {
    const result = await this.docker(["compose", "ls", "--all", "--format", "json"]);
    return composeProjectRows(result.stdout).flatMap((row) => {
      const name = row.Name?.trim();
      const status = row.Status?.trim();
      const configFiles = row.ConfigFiles?.split(",")
        .map((file) => file.trim())
        .filter(Boolean);
      return name && status && configFiles.length > 0 ? [{ configFiles, name, status }] : [];
    });
  }

  async getComposeProject(name: string): Promise<ComposeProjectDetail> {
    const project = await this.requireComposeProject(name);
    const result = await this.compose(project, ["ps", "--all", "--format", "json"]);
    const services = parseJsonLines<DockerComposeServiceRow>(result.stdout).map(
      (row): ComposeServiceSummary => ({
        health: row.Health,
        id: row.ID,
        image: row.Image,
        name: row.Name,
        ports: row.Ports,
        service: row.Service,
        state: row.State,
        status: row.Status,
      }),
    );
    return { ...project, services };
  }

  async getComposeProjectLogs(name: string): Promise<string> {
    const project = await this.requireComposeProject(name);
    const result = await this.compose(project, [
      "logs",
      "--tail",
      "300",
      "--timestamps",
      "--no-color",
    ]);
    return stripVTControlCharacters(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).trim();
  }

  async composeProjectAction(name: string, action: ComposeProjectAction): Promise<void> {
    const project = await this.requireComposeProject(name);
    const command = action === "up" ? ["up", "--detach"] : [action];
    await this.compose(project, command, action === "up" ? 10 * 60_000 : 120_000);
  }

  async pullImage(input: PullImageInput): Promise<void> {
    await this.docker(["image", "pull", input.image], 10 * 60_000);
  }

  async removeImage(id: string): Promise<void> {
    await this.docker(["image", "rm", id], 120_000);
  }

  async createVolume(input: CreateNamedResourceInput): Promise<void> {
    await this.docker(["volume", "create", input.name]);
  }

  async removeVolume(name: string): Promise<void> {
    await this.docker(["volume", "rm", name]);
  }

  async createNetwork(input: CreateNamedResourceInput): Promise<void> {
    await this.docker(["network", "create", input.name]);
  }

  async removeNetwork(name: string): Promise<void> {
    if (BUILT_IN_NETWORKS.has(name)) {
      throw new ExpectedError(
        "built_in_network",
        "기본 Docker 네트워크는 삭제할 수 없습니다.",
        409,
      );
    }
    await this.docker(["network", "rm", name]);
  }

  private async startRuntimeOnce(): Promise<RuntimeSnapshot> {
    const instance = await this.getInstance();
    if (!instance) {
      await runCommand(
        "limactl",
        ["start", `--name=${LIMA_INSTANCE}`, "template:docker", "--tty=false", "--progress"],
        { timeoutMs: 20 * 60_000 },
      );
    } else if (instance.status.toLowerCase() !== "running") {
      await runCommand("limactl", ["start", LIMA_INSTANCE, "--tty=false", "--progress"], {
        timeoutMs: 10 * 60_000,
      });
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const runtime = await this.getRuntimeSnapshot();
      if (runtime.phase === "running") return runtime;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new ExpectedError(
      "docker_not_ready",
      "Lima는 실행 중이지만 Docker가 준비되지 않았습니다. 잠시 후 다시 시도하십시오.",
      503,
    );
  }

  private async getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    let instance: LimaInstance | undefined;
    try {
      instance = await this.getInstance();
    } catch (error) {
      if (error instanceof CommandError && error.message.includes("executable file not found")) {
        return {
          instance: LIMA_INSTANCE,
          message: "Lima 실행 파일을 찾을 수 없습니다.",
          phase: "error",
        };
      }
      throw error;
    }

    if (!instance) return this.missingSnapshot();
    if (instance.status.toLowerCase() !== "running") return this.stoppedSnapshot();

    try {
      const result = await this.docker(["version", "--format", "{{.Server.Version}}"]);
      return {
        dockerVersion: result.stdout.trim(),
        instance: LIMA_INSTANCE,
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      };
    } catch {
      return {
        instance: LIMA_INSTANCE,
        message: "Lima는 실행 중이며 Docker socket을 준비하고 있습니다.",
        phase: "starting",
      };
    }
  }

  private async getInstance(): Promise<LimaInstance | undefined> {
    let result;
    try {
      result = await runCommand("limactl", ["list", LIMA_INSTANCE, "--format", LIMA_ROW_FORMAT]);
    } catch (error) {
      if (
        error instanceof CommandError &&
        (error.stderr.includes("No instance matching") ||
          error.stderr.includes("unmatched instances"))
      ) {
        return undefined;
      }
      throw error;
    }
    const row = result.stdout.trim();
    if (!row) return undefined;

    const [name, status, directory] = row.split("\t");
    if (name !== LIMA_INSTANCE || !status || !directory) return undefined;
    return { directory, status };
  }

  private async requireComposeProject(name: string): Promise<ComposeProjectSummary> {
    const project = (await this.getComposeProjects()).find((candidate) => candidate.name === name);
    if (!project) {
      throw new ExpectedError(
        "compose_project_not_found",
        "Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return project;
  }

  private compose(project: ComposeProjectSummary, args: readonly string[], timeoutMs?: number) {
    return this.docker(
      [
        "compose",
        "--project-name",
        project.name,
        ...project.configFiles.flatMap((file) => ["--file", file]),
        ...args,
      ],
      timeoutMs,
    );
  }

  private async docker(args: readonly string[], timeoutMs?: number) {
    const instance = await this.getInstance();
    if (!instance || instance.status.toLowerCase() !== "running") {
      throw new ExpectedError("runtime_unavailable", "Lima 런타임이 실행 중이 아닙니다.", 503);
    }

    const host = `unix://${instance.directory}/sock/docker.sock`;
    try {
      return await runCommand("docker", ["--host", host, ...args], { timeoutMs });
    } catch (error) {
      if (error instanceof CommandError) {
        throw new ExpectedError("docker_command_failed", this.dockerMessage(error), 503);
      }
      throw error;
    }
  }

  private async listContainers(): Promise<ContainerSummary[]> {
    const result = await this.docker([
      "container",
      "ls",
      "--all",
      "--format",
      CONTAINER_ROW_FORMAT,
    ]);
    return parseJsonLines<DockerContainerRow>(result.stdout).map((row) => {
      const composeProject = dockerLabel(row.Labels, "com.docker.compose.project");
      const composeService = dockerLabel(row.Labels, "com.docker.compose.service");
      return {
        ...(composeProject ? { composeProject } : {}),
        ...(composeService ? { composeService } : {}),
        id: row.ID,
        image: row.Image,
        name: row.Names,
        ports: row.Ports,
        state: row.State,
        status: row.Status,
      };
    });
  }

  private async listImages(): Promise<ImageSummary[]> {
    const result = await this.docker(["image", "ls", "--format", IMAGE_ROW_FORMAT]);
    return parseJsonLines<DockerImageRow>(result.stdout).map((row) => ({
      createdSince: row.CreatedSince,
      id: row.ID,
      repository: row.Repository,
      size: row.Size,
      tag: row.Tag,
    }));
  }

  private async listVolumes(): Promise<VolumeSummary[]> {
    const result = await this.docker(["volume", "ls", "--format", VOLUME_ROW_FORMAT]);
    return parseJsonLines<DockerVolumeRow>(result.stdout).map((row) => ({
      driver: row.Driver,
      labels: row.Labels,
      name: row.Name,
      scope: row.Scope,
    }));
  }

  private async listNetworks(): Promise<NetworkSummary[]> {
    const result = await this.docker(["network", "ls", "--format", NETWORK_ROW_FORMAT]);
    return parseJsonLines<DockerNetworkRow>(result.stdout).map((row) => ({
      builtIn: BUILT_IN_NETWORKS.has(row.Name),
      createdAt: row.CreatedAt,
      driver: row.Driver,
      id: row.ID,
      internal: row.Internal === "true",
      ipv4: row.IPv4 === "true",
      ipv6: row.IPv6 === "true",
      labels: row.Labels,
      name: row.Name,
      scope: row.Scope,
    }));
  }

  private dockerMessage(error: CommandError): string {
    const detail = error.stderr.trim();
    if (detail.includes("No such container")) return "컨테이너를 찾을 수 없습니다.";
    if (detail.includes("is already in use by container")) return "이미 사용 중인 이름입니다.";
    if (detail.includes("No such image")) return "이미지를 찾을 수 없습니다.";
    if (detail.includes("No such volume")) return "볼륨을 찾을 수 없습니다.";
    if (detail.includes("No such network")) return "네트워크를 찾을 수 없습니다.";
    if (detail.includes("is being used by")) return "사용 중인 리소스는 삭제할 수 없습니다.";
    if (detail.includes("active endpoints"))
      return "연결된 컨테이너가 있는 네트워크는 삭제할 수 없습니다.";
    return detail || "Docker 명령을 완료하지 못했습니다.";
  }

  private missingSnapshot(): RuntimeSnapshot {
    return {
      instance: LIMA_INSTANCE,
      message: "전용 Lima 인스턴스가 아직 없습니다.",
      phase: "missing",
    };
  }

  private stoppedSnapshot(): RuntimeSnapshot {
    return {
      instance: LIMA_INSTANCE,
      message: "Lima 인스턴스가 중지되어 있습니다.",
      phase: "stopped",
    };
  }
}
