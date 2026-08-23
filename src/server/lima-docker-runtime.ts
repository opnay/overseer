import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type {
  ComposeProjectAction,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ComposeServiceSummary,
  ContainerDetail,
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerSpecInput,
  ContainerSummary,
  ContainerVolumeMount,
  CreateNamedResourceInput,
  DashboardSnapshot,
  ImageSummary,
  NetworkSummary,
  PullImageInput,
  RunContainerInput,
  RuntimeSnapshot,
  UpdateContainerInput,
  VolumeSummary,
} from "../shared/contracts.ts";
import { containerSpecNeedsReplacement } from "../shared/container-spec.ts";
import { ExpectedError } from "./errors.ts";
import type { OperationProgress } from "./operations.ts";
import { CommandError, parseJsonLines, runCommand } from "./process.ts";

export interface RuntimeController {
  composeProjectAction(
    name: string,
    action: ComposeProjectAction,
    progress?: OperationProgress,
  ): Promise<void>;
  containerAction(
    id: string,
    action: "restart" | "start" | "stop",
    progress?: OperationProgress,
  ): Promise<void>;
  createNetwork(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void>;
  createVolume(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void>;
  getContainer(id: string): Promise<ContainerDetail>;
  getContainerLogs(id: string): Promise<string>;
  getContainers(): Promise<ContainerSummary[]>;
  getComposeProject(name: string): Promise<ComposeProjectDetail>;
  getComposeProjectLogs(name: string): Promise<string>;
  getComposeProjects(): Promise<ComposeProjectSummary[]>;
  getDashboard(): Promise<DashboardSnapshot>;
  getImages(): Promise<ImageSummary[]>;
  getNetworks(): Promise<NetworkSummary[]>;
  getVolumes(): Promise<VolumeSummary[]>;
  pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void>;
  removeContainer(id: string, progress?: OperationProgress): Promise<void>;
  removeImage(id: string, progress?: OperationProgress): Promise<void>;
  removeNetwork(name: string, progress?: OperationProgress): Promise<void>;
  removeVolume(name: string, progress?: OperationProgress): Promise<void>;
  runContainer(input: RunContainerInput, progress?: OperationProgress): Promise<void>;
  startRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
  stopRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
  updateContainer(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void>;
}

export type CommandRunner = typeof runCommand;

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

interface DockerInspectPortBinding {
  HostIp: string;
  HostPort: string;
}

interface DockerInspectMount {
  Destination: string;
  Name?: string;
  RW: boolean;
  Type: string;
}

interface DockerInspectContainer {
  Config: {
    Cmd?: string[] | null;
    Env?: string[] | null;
    Hostname: string;
    Image: string;
    Labels?: Record<string, string> | null;
  };
  HostConfig: {
    CapAdd?: string[] | null;
    CapDrop?: string[] | null;
    Devices?: unknown[] | null;
    Memory: number;
    NanoCpus: number;
    NetworkMode: string;
    PortBindings?: Record<string, DockerInspectPortBinding[] | null> | null;
    Privileged?: boolean;
    RestartPolicy: { MaximumRetryCount: number; Name: string };
    SecurityOpt?: string[] | null;
  };
  Id: string;
  Mounts?: DockerInspectMount[];
  Name: string;
  NetworkSettings: { Networks?: Record<string, unknown> | null };
  State: { Running: boolean };
}

const LIMA_INSTANCE = process.env.OVERSEER_LIMA_INSTANCE ?? "overseer";
const LIMA_ROW_FORMAT = "{{.Name}}\t{{.Status}}\t{{.Dir}}";
const CONTAINER_ROW_FORMAT = "{{json .}}";
const IMAGE_ROW_FORMAT = "{{json .}}";
const VOLUME_ROW_FORMAT = "{{json .}}";
const NETWORK_ROW_FORMAT = "{{json .}}";
const BUILT_IN_NETWORKS = new Set(["bridge", "host", "none"]);
const MANAGED_LABEL = "com.opnay.overseer.managed";
const SPEC_VERSION_LABEL = "com.opnay.overseer.spec-version";
const RESERVED_LABEL_PREFIXES = ["com.opnay.overseer.", "com.docker.compose."];

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

function sortedKeyValues(value: Record<string, string> | null | undefined): ContainerKeyValue[] {
  return Object.entries(value ?? {})
    .filter(([key]) => !RESERVED_LABEL_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => ({ key, value: item }));
}

function environmentValues(value: string[] | null | undefined): ContainerKeyValue[] {
  return (value ?? [])
    .map((item) => {
      const separator = item.indexOf("=");
      return separator < 0
        ? { key: item, value: "" }
        : { key: item.slice(0, separator), value: item.slice(separator + 1) };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function restartMode(value: string): ContainerSpecInput["restartPolicy"]["mode"] {
  return value === "always" || value === "on-failure" || value === "unless-stopped" ? value : "no";
}

function configHash(spec: ContainerSpecInput): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function restartArgument(policy: ContainerSpecInput["restartPolicy"]): string {
  return policy.mode === "on-failure" && policy.maximumRetryCount !== undefined
    ? `${policy.mode}:${policy.maximumRetryCount}`
    : policy.mode;
}

export class LimaDockerRuntime implements RuntimeController {
  private readonly command: CommandRunner;
  private transition?: Promise<RuntimeSnapshot>;

  constructor(command: CommandRunner = runCommand) {
    this.command = command;
  }

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
      this.getContainers(),
      this.getImages(),
      this.getVolumes(),
      this.getNetworks(),
    ]);
    return { composeProjects, containers, images, networks, runtime, volumes };
  }

  startRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot> {
    if (this.transition) return this.transition;
    this.transition = this.startRuntimeOnce(progress).finally(() => {
      this.transition = undefined;
    });
    return this.transition;
  }

  async stopRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot> {
    if (this.transition)
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    const instance = await this.getInstance();
    if (!instance) return this.missingSnapshot();
    if (instance.status.toLowerCase() === "stopped") return this.stoppedSnapshot();
    progress?.step("Lima 런타임 중지 중");
    await this.command("limactl", ["stop", LIMA_INSTANCE], {
      onOutput: progress?.output,
      timeoutMs: 120_000,
    });
    return this.stoppedSnapshot();
  }

  async runContainer(input: RunContainerInput, progress?: OperationProgress): Promise<void> {
    let id: string | undefined;
    try {
      progress?.step("컨테이너 생성 중");
      id = await this.createContainer(input, progress);
      progress?.step("컨테이너 시작 중");
      await this.docker(["container", "start", id], 120_000, progress);
    } catch (error) {
      if (id) await this.safeRemoveContainer(id, progress);
      throw error;
    }
  }

  async updateContainer(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const current = await this.getContainer(id);
    if (current.configHash !== input.expectedConfigHash) {
      throw new ExpectedError(
        "container_changed",
        "컨테이너 설정이 변경되었습니다. 다시 불러온 뒤 수정하십시오.",
        409,
      );
    }
    const replace = containerSpecNeedsReplacement(current.spec, input.spec);
    if (replace) {
      if (current.replacementBlockers.length > 0) {
        throw new ExpectedError(
          "container_not_recreatable",
          `이 컨테이너는 안전하게 다시 만들 수 없습니다: ${current.replacementBlockers.join(" ")}`,
          409,
        );
      }
      await this.replaceContainer(current, input.spec, progress);
      return;
    }
    await this.updateContainerNative(current, input.spec, progress);
  }

  async getContainer(id: string): Promise<ContainerDetail> {
    const result = await this.docker(["container", "inspect", id]);
    let inspected: DockerInspectContainer;
    try {
      const value = JSON.parse(result.stdout) as DockerInspectContainer[];
      const first = value[0];
      if (!first) throw new Error("empty inspect output");
      inspected = first;
    } catch {
      throw new ExpectedError(
        "invalid_container_output",
        "Docker 컨테이너 설정을 해석하지 못했습니다.",
        503,
      );
    }

    const blockers: string[] = [];
    const labels = inspected.Config.Labels ?? {};
    if (labels[MANAGED_LABEL] !== "true" || labels[SPEC_VERSION_LABEL] !== "1") {
      blockers.push("Overseer에서 만든 컨테이너가 아닙니다.");
    }
    if (Object.keys(labels).some((key) => key.startsWith("com.docker.compose.")))
      blockers.push("Compose에서 관리하는 컨테이너입니다.");
    if (inspected.HostConfig.Privileged) blockers.push("privileged 설정이 있습니다.");
    if ((inspected.HostConfig.CapAdd?.length ?? 0) > 0)
      blockers.push("추가 capability가 있습니다.");
    if ((inspected.HostConfig.CapDrop?.length ?? 0) > 0)
      blockers.push("제거 capability가 있습니다.");
    if ((inspected.HostConfig.Devices?.length ?? 0) > 0) blockers.push("device 연결이 있습니다.");
    if ((inspected.HostConfig.SecurityOpt?.length ?? 0) > 0) blockers.push("보안 옵션이 있습니다.");
    if (inspected.HostConfig.NetworkMode === "host") blockers.push("host 네트워크를 사용합니다.");

    const volumes: ContainerVolumeMount[] = [];
    for (const mount of inspected.Mounts ?? []) {
      if (mount.Type !== "volume" || !mount.Name) {
        blockers.push("named volume 이외의 마운트가 있습니다.");
        continue;
      }
      volumes.push({ containerPath: mount.Destination, readOnly: !mount.RW, volume: mount.Name });
    }

    const ports: ContainerPortMapping[] = [];
    for (const [key, bindings] of Object.entries(inspected.HostConfig.PortBindings ?? {})) {
      const [portText, protocolText] = key.split("/");
      const containerPort = Number(portText);
      const protocol = protocolText === "udp" ? "udp" : "tcp";
      if ((bindings?.length ?? 0) > 1) blockers.push(`${key}에 복수 호스트 바인딩이 있습니다.`);
      const binding = bindings?.[0];
      if (binding?.HostIp && binding.HostIp !== "127.0.0.1")
        blockers.push(`${key}가 127.0.0.1 외부에 공개되어 있습니다.`);
      if (Number.isInteger(containerPort) && binding) {
        const hostPort = Number(binding.HostPort);
        ports.push({
          containerPort,
          ...(Number.isInteger(hostPort) && hostPort > 0 ? { hostPort } : {}),
          protocol,
        });
      }
    }

    const idPrefix = inspected.Id.slice(0, 12);
    const hostname =
      inspected.Config.Hostname && inspected.Config.Hostname !== idPrefix
        ? inspected.Config.Hostname
        : undefined;
    const restartPolicy = {
      ...(inspected.HostConfig.RestartPolicy.Name === "on-failure"
        ? { maximumRetryCount: inspected.HostConfig.RestartPolicy.MaximumRetryCount }
        : {}),
      mode: restartMode(inspected.HostConfig.RestartPolicy.Name),
    };
    const spec: ContainerSpecInput = {
      command: [...(inspected.Config.Cmd ?? [])],
      environment: environmentValues(inspected.Config.Env),
      ...(hostname ? { hostname } : {}),
      image: inspected.Config.Image,
      labels: sortedKeyValues(labels),
      name: inspected.Name.replace(/^\//, ""),
      networks: Object.keys(inspected.NetworkSettings.Networks ?? {}).sort(),
      ports: ports.sort((left, right) => left.containerPort - right.containerPort),
      pullPolicy: "missing",
      resources: {
        ...(inspected.HostConfig.NanoCpus > 0
          ? { cpus: inspected.HostConfig.NanoCpus / 1_000_000_000 }
          : {}),
        ...(inspected.HostConfig.Memory > 0
          ? { memoryMiB: Math.round(inspected.HostConfig.Memory / 1_048_576) }
          : {}),
      },
      restartPolicy,
      volumes: volumes.sort((left, right) => left.containerPath.localeCompare(right.containerPath)),
    };
    return {
      configHash: configHash(spec),
      id: inspected.Id,
      replacementBlockers: [...new Set(blockers)],
      running: inspected.State.Running,
      spec,
    };
  }

  async containerAction(
    id: string,
    action: "restart" | "start" | "stop",
    progress?: OperationProgress,
  ): Promise<void> {
    progress?.step(
      `컨테이너 ${action === "start" ? "시작" : action === "stop" ? "중지" : "재시작"} 중`,
    );
    await this.docker([action, id], 120_000, progress);
  }

  async removeContainer(id: string, progress?: OperationProgress): Promise<void> {
    progress?.step("컨테이너 삭제 중");
    await this.docker(["container", "rm", id], 120_000, progress);
  }

  async getContainerLogs(id: string): Promise<string> {
    const result = await this.docker(["logs", "--tail", "300", "--timestamps", id]);
    return stripVTControlCharacters(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).trim();
  }

  async getContainers(): Promise<ContainerSummary[]> {
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

  async composeProjectAction(
    name: string,
    action: ComposeProjectAction,
    progress?: OperationProgress,
  ): Promise<void> {
    const project = await this.requireComposeProject(name);
    progress?.step(`Compose ${action} 실행 중`);
    const command = action === "up" ? ["up", "--detach"] : [action];
    await this.compose(project, command, action === "up" ? 10 * 60_000 : 120_000, progress);
  }

  async pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 받는 중");
    await this.docker(["image", "pull", input.image], 10 * 60_000, progress);
  }

  async removeImage(id: string, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 삭제 중");
    await this.docker(["image", "rm", id], 120_000, progress);
  }

  async getImages(): Promise<ImageSummary[]> {
    const result = await this.docker(["image", "ls", "--format", IMAGE_ROW_FORMAT]);
    return parseJsonLines<DockerImageRow>(result.stdout).map((row) => ({
      createdSince: row.CreatedSince,
      id: row.ID,
      repository: row.Repository,
      size: row.Size,
      tag: row.Tag,
    }));
  }

  async createVolume(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void> {
    progress?.step("볼륨 만드는 중");
    await this.docker(["volume", "create", input.name], undefined, progress);
  }

  async removeVolume(name: string, progress?: OperationProgress): Promise<void> {
    progress?.step("볼륨 삭제 중");
    await this.docker(["volume", "rm", name], undefined, progress);
  }

  async getVolumes(): Promise<VolumeSummary[]> {
    const result = await this.docker(["volume", "ls", "--format", VOLUME_ROW_FORMAT]);
    return parseJsonLines<DockerVolumeRow>(result.stdout).map((row) => ({
      driver: row.Driver,
      labels: row.Labels,
      name: row.Name,
      scope: row.Scope,
    }));
  }

  async createNetwork(
    input: CreateNamedResourceInput,
    progress?: OperationProgress,
  ): Promise<void> {
    progress?.step("네트워크 만드는 중");
    await this.docker(["network", "create", input.name], undefined, progress);
  }

  async removeNetwork(name: string, progress?: OperationProgress): Promise<void> {
    if (BUILT_IN_NETWORKS.has(name)) {
      throw new ExpectedError(
        "built_in_network",
        "기본 Docker 네트워크는 삭제할 수 없습니다.",
        409,
      );
    }
    progress?.step("네트워크 삭제 중");
    await this.docker(["network", "rm", name], undefined, progress);
  }

  async getNetworks(): Promise<NetworkSummary[]> {
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

  private createArguments(spec: ContainerSpecInput): string[] {
    const args = ["container", "create", "--pull", spec.pullPolicy];
    if (spec.name) args.push("--name", spec.name);
    if (spec.hostname) args.push("--hostname", spec.hostname);
    args.push("--label", `${MANAGED_LABEL}=true`, "--label", `${SPEC_VERSION_LABEL}=1`);
    for (const { key, value } of spec.labels) args.push("--label", `${key}=${value}`);
    for (const { key, value } of spec.environment) args.push("--env", `${key}=${value}`);
    for (const port of spec.ports) {
      args.push(
        "--publish",
        `127.0.0.1:${port.hostPort ?? ""}:${port.containerPort}/${port.protocol}`,
      );
    }
    for (const mount of spec.volumes) {
      args.push(
        "--mount",
        `type=volume,source=${mount.volume},target=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`,
      );
    }
    const firstNetwork = spec.networks[0];
    if (firstNetwork) args.push("--network", firstNetwork);
    args.push("--restart", restartArgument(spec.restartPolicy));
    if (spec.resources.cpus !== undefined) args.push("--cpus", String(spec.resources.cpus));
    if (spec.resources.memoryMiB !== undefined)
      args.push("--memory", `${spec.resources.memoryMiB}m`);
    args.push(spec.image, ...spec.command);
    return args;
  }

  private async createContainer(
    spec: ContainerSpecInput,
    progress?: OperationProgress,
  ): Promise<string> {
    const result = await this.docker(this.createArguments(spec), 10 * 60_000, progress);
    const id = result.stdout.trim();
    if (!id)
      throw new ExpectedError("container_id_missing", "새 컨테이너 ID를 받지 못했습니다.", 503);
    for (const network of spec.networks.slice(1)) {
      progress?.step(`${network} 네트워크 연결 중`);
      await this.docker(["network", "connect", network, id], 120_000, progress);
    }
    return id;
  }

  private async updateContainerNative(
    current: ContainerDetail,
    desired: ContainerSpecInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const changedResources =
      JSON.stringify(current.spec.resources) !== JSON.stringify(desired.resources) ||
      JSON.stringify(current.spec.restartPolicy) !== JSON.stringify(desired.restartPolicy);
    const renamed = current.spec.name !== desired.name;
    if (changedResources) {
      progress?.step("리소스와 재시작 정책 수정 중");
      await this.docker(
        ["container", "update", ...this.updateArguments(desired), current.id],
        120_000,
        progress,
      );
    }
    if (!renamed || !desired.name) return;
    try {
      progress?.step("컨테이너 이름 변경 중");
      await this.docker(["container", "rename", current.id, desired.name], 120_000, progress);
    } catch (error) {
      if (changedResources) {
        try {
          await this.docker(
            ["container", "update", ...this.updateArguments(current.spec), current.id],
            120_000,
            progress,
          );
        } catch {
          throw new ExpectedError(
            "container_rollback_failed",
            "이름 변경에 실패했고 리소스 설정도 원상 복구하지 못했습니다.",
            503,
          );
        }
      }
      throw error;
    }
  }

  private updateArguments(spec: ContainerSpecInput): string[] {
    return [
      "--restart",
      restartArgument(spec.restartPolicy),
      "--cpus",
      String(spec.resources.cpus ?? 0),
      "--memory",
      spec.resources.memoryMiB === undefined ? "0" : `${spec.resources.memoryMiB}m`,
    ];
  }

  private async replaceContainer(
    current: ContainerDetail,
    desired: ContainerSpecInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const oldName = current.spec.name;
    if (!oldName || !desired.name)
      throw new ExpectedError(
        "container_name_required",
        "교체하려면 컨테이너 이름이 필요합니다.",
        409,
      );
    const backupName = `${oldName.slice(0, 90)}-overseer-backup-${current.id.slice(0, 8)}`;
    let replacementId: string | undefined;
    let renamed = false;
    try {
      if (current.running) {
        progress?.step("기존 컨테이너 중지 중");
        await this.docker(["container", "stop", current.id], 120_000, progress);
      }
      progress?.step("기존 컨테이너 보존 중");
      await this.docker(["container", "rename", current.id, backupName], 120_000, progress);
      renamed = true;
      progress?.step("새 컨테이너 생성 중");
      replacementId = await this.createContainer(desired, progress);
      if (current.running) {
        progress?.step("새 컨테이너 시작 중");
        await this.docker(["container", "start", replacementId], 120_000, progress);
      }
      progress?.step("이전 컨테이너 정리 중");
      await this.docker(["container", "rm", current.id], 120_000, progress);
    } catch (error) {
      progress?.step("기존 컨테이너 복구 중");
      try {
        if (replacementId) await this.safeRemoveContainer(replacementId, progress);
        if (renamed)
          await this.docker(["container", "rename", current.id, oldName], 120_000, progress);
        if (current.running)
          await this.docker(["container", "start", current.id], 120_000, progress);
      } catch {
        throw new ExpectedError(
          "container_rollback_failed",
          "컨테이너 교체에 실패했고 기존 컨테이너도 자동 복구하지 못했습니다.",
          503,
        );
      }
      throw error;
    }
  }

  private async safeRemoveContainer(id: string, progress?: OperationProgress): Promise<void> {
    try {
      await this.docker(["container", "rm", "--force", id], 120_000, progress);
    } catch {
      // Preserve the original operation failure.
    }
  }

  private async startRuntimeOnce(progress?: OperationProgress): Promise<RuntimeSnapshot> {
    const instance = await this.getInstance();
    progress?.step(instance ? "Lima 런타임 시작 중" : "Lima 환경 만드는 중");
    if (!instance) {
      await this.command(
        "limactl",
        ["start", `--name=${LIMA_INSTANCE}`, "template:docker", "--tty=false", "--progress"],
        {
          onOutput: progress?.output,
          timeoutMs: 20 * 60_000,
        },
      );
    } else if (instance.status.toLowerCase() !== "running") {
      await this.command("limactl", ["start", LIMA_INSTANCE, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
    }
    progress?.step("Docker 준비 확인 중");
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
      if (error instanceof CommandError && error.message.includes("ENOENT")) {
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
      result = await this.command("limactl", ["list", LIMA_INSTANCE, "--format", LIMA_ROW_FORMAT]);
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
    if (!project)
      throw new ExpectedError(
        "compose_project_not_found",
        "Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    return project;
  }

  private compose(
    project: ComposeProjectSummary,
    args: readonly string[],
    timeoutMs?: number,
    progress?: OperationProgress,
  ) {
    return this.docker(
      [
        "compose",
        "--project-name",
        project.name,
        ...project.configFiles.flatMap((file) => ["--file", file]),
        ...args,
      ],
      timeoutMs,
      progress,
    );
  }

  private async docker(args: readonly string[], timeoutMs?: number, progress?: OperationProgress) {
    const instance = await this.getInstance();
    if (!instance || instance.status.toLowerCase() !== "running") {
      throw new ExpectedError("runtime_unavailable", "Lima 런타임이 실행 중이 아닙니다.", 503);
    }
    const host = `unix://${instance.directory}/sock/docker.sock`;
    try {
      return await this.command("docker", ["--host", host, ...args], {
        onOutput: progress?.output,
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof CommandError)
        throw new ExpectedError("docker_command_failed", this.dockerMessage(error), 503);
      throw error;
    }
  }

  private dockerMessage(error: CommandError): string {
    const detail = error.stderr.trim();
    if (detail.includes("No such container")) return "컨테이너를 찾을 수 없습니다.";
    if (detail.includes("is already in use by container")) return "이미 사용 중인 이름입니다.";
    if (detail.includes("No such image")) return "이미지를 찾을 수 없습니다.";
    if (detail.includes("No such volume")) return "볼륨을 찾을 수 없습니다.";
    if (
      detail.includes("No such network") ||
      (detail.includes("network ") && detail.includes(" not found"))
    ) {
      return "네트워크를 찾을 수 없습니다.";
    }
    if (detail.includes("port is already allocated")) return "이미 사용 중인 호스트 포트입니다.";
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
