import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import type {
  ComposeProjectAction,
  ComposeBuilderProjectDetail,
  ComposeBuilderSpec,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ComposeServiceSummary,
  ContainerDetail,
  ContainerHealth,
  ContainerHealthStatus,
  ContainerInspection,
  ContainerKeyValue,
  ContainerMount,
  ContainerPortMapping,
  ContainerSpecInput,
  ContainerSummary,
  ContainerTerminalAccess,
  ContainerShell,
  ContainerVolumeMount,
  CreateRuntimeInstanceInput,
  CreateNamedResourceInput,
  DashboardSnapshot,
  DockerDaemonConfigurationSnapshot,
  DockerEngineConfiguration,
  DockerEngineConfigurationSnapshot,
  DockerCliIntegrationSnapshot,
  ImageDetail,
  ImageHistoryEntry,
  ImageRepositoryTags,
  ImageSummary,
  MenuBarSnapshot,
  NetworkDetail,
  NetworkSummary,
  PullImageInput,
  RegisterRemoteComposeInput,
  RunContainerInput,
  RuntimeInstancesSnapshot,
  RuntimeInstanceSummary,
  RuntimeSnapshot,
  UpdateDockerDaemonConfigurationInput,
  UpdateDockerDaemonConfigurationSectionInput,
  UpdateContainerInput,
  UpdateComposeBuilderInput,
  VolumeDetail,
  VolumeSummary,
} from "../shared/contracts.ts";
import { containerSpecNeedsReplacement } from "../shared/container-spec.ts";
import { BuilderComposeService, type BuilderComposeRegistry } from "./builder-compose.ts";
import {
  dockerDaemonJson,
  dockerDaemonSnapshot,
  mergeDockerDaemonConfigurationSection,
} from "./docker-daemon-configuration.ts";
import { ExpectedError } from "./errors.ts";
import type { OperationProgress } from "./operations.ts";
import { CommandError, parseJsonLines, runCommand } from "./process.ts";
import { RemoteComposeService, type RemoteComposeRegistry } from "./remote-compose.ts";
import { MemoryRuntimeInstanceStore, type RuntimeInstanceStore } from "./runtime-instance-store.ts";

export interface RuntimeController {
  applyDockerDaemonConfiguration(
    input: UpdateDockerDaemonConfigurationInput,
    progress?: OperationProgress,
  ): Promise<void>;
  applyDockerDaemonConfigurationSection(
    input: UpdateDockerDaemonConfigurationSectionInput,
    progress?: OperationProgress,
  ): Promise<void>;
  applyRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void>;
  checkRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void>;
  connectDockerCli(progress?: OperationProgress): Promise<void>;
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
  createRuntimeInstance(
    input: CreateRuntimeInstanceInput,
    progress?: OperationProgress,
  ): Promise<void>;
  createVolume(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void>;
  getContainer(id: string): Promise<ContainerDetail>;
  getContainerInspection(id: string): Promise<ContainerInspection>;
  getContainerLogs(id: string): Promise<string>;
  getContainerTerminalAccess(id: string): Promise<ContainerTerminalAccess>;
  getContainers(): Promise<ContainerSummary[]>;
  getComposeProject(name: string): Promise<ComposeProjectDetail>;
  getBuilderComposeProject(name: string): Promise<ComposeBuilderProjectDetail>;
  getComposeProjectLogs(name: string): Promise<string>;
  getComposeProjects(): Promise<ComposeProjectSummary[]>;
  getDashboard(): Promise<DashboardSnapshot>;
  getDockerDaemonConfiguration(): Promise<DockerDaemonConfigurationSnapshot>;
  getDockerEngineConfiguration(): Promise<DockerEngineConfigurationSnapshot>;
  getImage(id: string): Promise<ImageDetail>;
  getImageHistory(id: string): Promise<ImageHistoryEntry[]>;
  getImageRepositoryTags(id: string, page: number): Promise<ImageRepositoryTags>;
  getImages(): Promise<ImageSummary[]>;
  getMenuBarSnapshot(): Promise<MenuBarSnapshot>;
  getNetwork(name: string): Promise<NetworkDetail>;
  getNetworks(): Promise<NetworkSummary[]>;
  getRuntimeInstances(): Promise<RuntimeInstancesSnapshot>;
  getVolumes(): Promise<VolumeSummary[]>;
  getVolume(name: string): Promise<VolumeDetail>;
  pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void>;
  prepareRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  registerBuilderCompose(spec: ComposeBuilderSpec, progress?: OperationProgress): Promise<void>;
  registerRemoteCompose(
    input: RegisterRemoteComposeInput,
    progress?: OperationProgress,
  ): Promise<void>;
  removeContainer(id: string, progress?: OperationProgress): Promise<void>;
  removeImage(id: string, progress?: OperationProgress): Promise<void>;
  removeNetwork(name: string, progress?: OperationProgress): Promise<void>;
  removeVolume(name: string, progress?: OperationProgress): Promise<void>;
  removeRemoteCompose(name: string, progress?: OperationProgress): Promise<void>;
  removeBuilderCompose(name: string, progress?: OperationProgress): Promise<void>;
  recreateRuntime(
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<RuntimeSnapshot>;
  restartRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
  runContainer(input: RunContainerInput, progress?: OperationProgress): Promise<void>;
  selectRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  startRuntime(
    progress?: OperationProgress,
    configuration?: DockerEngineConfiguration,
  ): Promise<RuntimeSnapshot>;
  startRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  stopRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
  stopRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  updateContainer(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void>;
  updateBuilderCompose(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<void>;
}

export type CommandRunner = typeof runCommand;

interface LimaInstance {
  directory: string;
  status: string;
}

interface LimaInstanceDetails {
  arch?: string;
  cpus: number;
  config?: {
    mounts?: Array<{
      location?: string;
      mountPoint?: string;
      writable?: boolean;
    }>;
    portForwards?: Array<{
      guestSocket?: string;
      hostSocket?: string;
    }>;
  };
  dir: string;
  disk: number;
  memory: number;
  name: string;
  status: string;
  vmType: string;
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
  CreatedAt: string;
  CreatedSince: string;
  ID: string;
  Repository: string;
  Size: string;
  Tag: string;
}

interface DockerInspectImage {
  Architecture: string;
  Comment?: string;
  Config?: {
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
    Env?: string[] | null;
    ExposedPorts?: Record<string, unknown> | null;
    Labels?: Record<string, string> | null;
    WorkingDir?: string;
  } | null;
  Created: string;
  Id: string;
  Os: string;
  RepoDigests?: string[] | null;
  RepoTags?: string[] | null;
  RootFS?: { Layers?: string[] | null } | null;
  Size: number;
}

interface DockerImageHistoryRow {
  Comment: string;
  CreatedAt: string;
  CreatedBy: string;
  CreatedSince: string;
  ID: string;
  Size: string;
}

interface DockerHubTagResult {
  full_size?: number;
  images?: Array<{ architecture?: string; os?: string; variant?: string | null }>;
  last_updated?: string;
  name?: string;
}

interface DockerVolumeRow {
  Driver: string;
  Labels: string;
  Name: string;
  Scope: string;
}

interface DockerInspectVolume {
  CreatedAt?: string;
  Driver: string;
  Labels?: Record<string, string> | null;
  Mountpoint: string;
  Name: string;
  Options?: Record<string, string> | null;
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

interface DockerInspectNetworkContainer {
  EndpointID?: string;
  IPv4Address?: string;
  IPv6Address?: string;
  MacAddress?: string;
  Name?: string;
}

interface DockerInspectNetwork {
  Attachable?: boolean;
  ConfigOnly?: boolean;
  Containers?: Record<string, DockerInspectNetworkContainer> | null;
  Created: string;
  Driver: string;
  EnableIPv4?: boolean;
  EnableIPv6?: boolean;
  Id: string;
  Ingress?: boolean;
  Internal?: boolean;
  IPAM?: {
    Config?: Array<{
      AuxAddress?: Record<string, string> | null;
      AuxiliaryAddresses?: Record<string, string> | null;
      Gateway?: string;
      IPRange?: string;
      Subnet?: string;
    }> | null;
    Driver?: string;
    Options?: Record<string, string> | null;
  } | null;
  Labels?: Record<string, string> | null;
  Name: string;
  Options?: Record<string, string> | null;
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
  Source: string;
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
  State: {
    Health?: {
      FailingStreak?: number;
      Log?: Array<{
        End?: string;
        ExitCode?: number;
        Output?: string;
        Start?: string;
      }>;
      Status?: string;
    };
    Paused?: boolean;
    Restarting?: boolean;
    Running: boolean;
  };
}

function parseLimaInstanceDetails(value: unknown): LimaInstanceDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid Lima instance data");
  }
  const instance = value as Partial<LimaInstanceDetails>;
  if (
    typeof instance.name !== "string" ||
    typeof instance.status !== "string" ||
    typeof instance.dir !== "string" ||
    typeof instance.vmType !== "string" ||
    typeof instance.cpus !== "number" ||
    typeof instance.memory !== "number" ||
    typeof instance.disk !== "number"
  ) {
    throw new Error("invalid Lima instance data");
  }
  return instance as LimaInstanceDetails;
}

const DEFAULT_LIMA_INSTANCE = "overseer";
const CONFIGURED_LIMA_INSTANCE = process.env.OVERSEER_LIMA_INSTANCE;
const DOCKER_CONTEXT = "overseer";
const DOCKER_CONTEXT_DESCRIPTION = "Overseer Lima Docker Engine";
const LIMA_ROW_FORMAT = "{{.Name}}\t{{.Status}}\t{{.Dir}}";
const DEFAULT_DOCKER_ENGINE_CONFIGURATION: DockerEngineConfiguration = {
  cpus: 4,
  diskGiB: 100,
  memoryGiB: 4,
  provider: "lima",
  vmType: "vz",
};
const GIBIBYTE = 1024 ** 3;
const CONTAINER_ROW_FORMAT = "{{json .}}";
const IMAGE_ROW_FORMAT = "{{json .}}";
const VOLUME_ROW_FORMAT = "{{json .}}";
const NETWORK_ROW_FORMAT = "{{json .}}";
const BUILT_IN_NETWORKS = new Set(["bridge", "host", "none"]);
const MANAGED_LABEL = "com.opnay.overseer.managed";
const SPEC_VERSION_LABEL = "com.opnay.overseer.spec-version";
const RESERVED_LABEL_PREFIXES = ["com.opnay.overseer.", "com.docker.compose."];
const CONTAINER_SHELLS: readonly ContainerShell[] = ["sh", "bash", "ash", "zsh"];
const READ_DOCKER_DAEMON_CONFIGURATION =
  'target="$HOME/.config/docker/daemon.json"; if [ -f "$target" ]; then printf "file\\n"; cat "$target"; else printf "default\\n{}\\n"; fi';
const WRITE_DOCKER_DAEMON_CONFIGURATION =
  'set -eu; target="$HOME/.config/docker/daemon.json"; temp="$target.overseer.tmp"; mkdir -p "$(dirname "$target")"; trap \'rm -f "$temp"\' EXIT; cat > "$temp"; dockerd --validate --config-file="$temp"; mv "$temp" "$target"; trap - EXIT';
const REMOVE_DOCKER_DAEMON_CONFIGURATION =
  'rm -f "$HOME/.config/docker/daemon.json" "$HOME/.config/docker/daemon.json.overseer.tmp"';

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

function imageReferenceUrl(repository: string, tag: string): string {
  if (repository === "<none>") return "—";
  const firstSegment = repository.split("/", 1)[0] ?? repository;
  const hasRegistry =
    firstSegment === "localhost" || firstSegment.includes(".") || firstSegment.includes(":");
  const canonicalRepository = hasRegistry
    ? repository
    : repository.includes("/")
      ? `docker.io/${repository}`
      : `docker.io/library/${repository}`;
  return tag === "<none>" ? canonicalRepository : `${canonicalRepository}:${tag}`;
}

function imageLabels(value: Record<string, string> | null | undefined): ContainerKeyValue[] {
  return Object.entries(value ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => ({ key, value: item }));
}

function parseImageInspectOutput(stdout: string): DockerInspectImage[] {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || value.length === 0) throw new Error("empty inspect output");
    return value as DockerInspectImage[];
  } catch {
    throw new ExpectedError(
      "invalid_image_output",
      "Docker 이미지 설정을 해석하지 못했습니다.",
      503,
    );
  }
}

function parseVolumeInspectOutput(stdout: string): DockerInspectVolume {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    const inspected = value[0] as Partial<DockerInspectVolume>;
    if (
      typeof inspected.Name !== "string" ||
      typeof inspected.Driver !== "string" ||
      typeof inspected.Mountpoint !== "string" ||
      typeof inspected.Scope !== "string"
    ) {
      throw new Error("invalid volume inspect output");
    }
    return inspected as DockerInspectVolume;
  } catch {
    throw new ExpectedError(
      "invalid_volume_output",
      "Docker 볼륨 원본 정보를 해석하지 못했습니다.",
      503,
    );
  }
}

function parseNetworkInspectOutput(stdout: string): DockerInspectNetwork {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    const inspected = value[0] as Partial<DockerInspectNetwork>;
    if (
      typeof inspected.Name !== "string" ||
      typeof inspected.Id !== "string" ||
      typeof inspected.Created !== "string" ||
      typeof inspected.Driver !== "string" ||
      typeof inspected.Scope !== "string"
    ) {
      throw new Error("invalid network inspect output");
    }
    return inspected as DockerInspectNetwork;
  } catch {
    throw new ExpectedError(
      "invalid_network_output",
      "Docker 네트워크 원본 정보를 해석하지 못했습니다.",
      503,
    );
  }
}

function dockerHubRepository(repositoryTags: string[]): string | undefined {
  for (const repositoryTag of repositoryTags) {
    const reference = repositoryTag.split("@", 1)[0] ?? "";
    const lastSlash = reference.lastIndexOf("/");
    const lastColon = reference.lastIndexOf(":");
    const repository = lastColon > lastSlash ? reference.slice(0, lastColon) : reference;
    const segments = repository.split("/").filter(Boolean);
    const first = segments[0];
    if (!first) continue;
    const hasRegistry = first === "localhost" || first.includes(".") || first.includes(":");
    if (hasRegistry) {
      if (first !== "docker.io" && first !== "index.docker.io") continue;
      segments.shift();
    }
    if (segments.length === 1) return `library/${segments[0]}`;
    if (segments.length === 2) return segments.join("/");
  }
  return undefined;
}

function restartMode(value: string): ContainerSpecInput["restartPolicy"]["mode"] {
  return value === "always" || value === "on-failure" || value === "unless-stopped" ? value : "no";
}

function parseContainerInspectOutput(stdout: string): DockerInspectContainer {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    return value[0] as DockerInspectContainer;
  } catch {
    throw new ExpectedError(
      "invalid_container_output",
      "Docker 컨테이너 설정을 해석하지 못했습니다.",
      503,
    );
  }
}

function containerHealthStatus(value: string | undefined): ContainerHealthStatus {
  return value === "healthy" || value === "unhealthy" ? value : "starting";
}

function healthOutput(value: string | undefined): string {
  const output = stripVTControlCharacters(value ?? "").trimEnd();
  const limit = 8_000;
  return output.length > limit ? `${output.slice(0, limit)}\n… 출력이 잘렸습니다.` : output;
}

function containerHealth(inspected: DockerInspectContainer): ContainerHealth | undefined {
  const health = inspected.State.Health;
  if (!health) return undefined;
  return {
    failingStreak:
      typeof health.FailingStreak === "number" && Number.isSafeInteger(health.FailingStreak)
        ? Math.max(0, health.FailingStreak)
        : 0,
    history: (health.Log ?? [])
      .slice(-50)
      .reverse()
      .map((entry) => ({
        endedAt: entry.End ?? "",
        exitCode:
          typeof entry.ExitCode === "number" && Number.isSafeInteger(entry.ExitCode)
            ? entry.ExitCode
            : -1,
        output: healthOutput(entry.Output),
        startedAt: entry.Start ?? "",
      })),
    status: containerHealthStatus(health.Status),
  };
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
  private readonly builderCompose: BuilderComposeRegistry;
  private readonly command: CommandRunner;
  private readonly fetcher: typeof fetch;
  private readonly instanceStore: RuntimeInstanceStore;
  private readonly remoteCompose: RemoteComposeRegistry;
  private daemonTransition?: Promise<void>;
  private transition?: Promise<RuntimeSnapshot>;

  constructor(
    command: CommandRunner = runCommand,
    remoteCompose?: RemoteComposeRegistry,
    builderCompose?: BuilderComposeRegistry,
    fetcher: typeof fetch = fetch,
    instanceStore: RuntimeInstanceStore = new MemoryRuntimeInstanceStore(),
  ) {
    this.command = command;
    this.fetcher = fetcher;
    this.instanceStore = instanceStore;
    this.remoteCompose = remoteCompose ?? new RemoteComposeService(command);
    this.builderCompose = builderCompose ?? new BuilderComposeService(command);
  }

  private get instanceName(): string {
    return (
      CONFIGURED_LIMA_INSTANCE ??
      this.instanceStore.getActiveInstanceName() ??
      DEFAULT_LIMA_INSTANCE
    );
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
    const dockerComposeAvailable = await this.isHostDockerComposeAvailable();
    const [composeProjects, containers, images, volumes, networks] = await Promise.all([
      dockerComposeAvailable ? this.getComposeProjects() : Promise.resolve([]),
      this.getContainers(),
      this.getImages(),
      this.getVolumes(),
      this.getNetworks(),
    ]);
    return {
      capabilities: { dockerCompose: dockerComposeAvailable },
      composeProjects,
      containers,
      images,
      networks,
      runtime,
      volumes,
    };
  }

  async getMenuBarSnapshot(): Promise<MenuBarSnapshot> {
    const runtime = await this.getRuntimeSnapshot();
    if (runtime.phase !== "running") return { composeProjects: [], containers: [], runtime };
    const [composeProjects, containers] = await Promise.all([
      this.isHostDockerComposeAvailable().then((available) =>
        available ? this.getComposeProjects() : [],
      ),
      this.getContainers(),
    ]);
    return { composeProjects, containers, runtime };
  }

  private async isHostDockerComposeAvailable(): Promise<boolean> {
    try {
      await this.command("docker", ["compose", "version"], { timeoutMs: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async getDockerEngineConfiguration(): Promise<DockerEngineConfigurationSnapshot> {
    const [instance, qemuAvailable] = await Promise.all([
      this.getInstanceDetails(),
      this.isQemuAvailable(),
    ]);
    let configuration = { ...DEFAULT_DOCKER_ENGINE_CONFIGURATION };
    let source: DockerEngineConfigurationSnapshot["source"] = "default";
    if (instance) {
      try {
        configuration = this.configurationFromInstance(instance);
        source = "instance";
      } catch {
        // Keep settings reachable so another compatible instance can be selected.
      }
    }
    return {
      configuration,
      dockerCli: await this.getDockerCliIntegration(instance),
      providers: [{ available: true, label: "Lima VM", value: "lima" }],
      source,
      vmTypes: [
        { available: true, label: "Apple Virtualization (VZ)", value: "vz" },
        {
          available: qemuAvailable,
          label: "QEMU",
          ...(qemuAvailable
            ? {}
            : { unavailableReason: "QEMU가 설치되지 않았습니다. brew install qemu" }),
          value: "qemu",
        },
      ],
    };
  }

  async getRuntimeInstances(): Promise<RuntimeInstancesSnapshot> {
    const instances = await this.listInstanceDetails();
    const summaries = await Promise.all(
      instances.map((instance) => this.runtimeInstanceSummary(instance)),
    );
    return {
      activeInstanceName: this.instanceName,
      instances: summaries.sort(
        (left, right) =>
          Number(right.active) - Number(left.active) || left.name.localeCompare(right.name),
      ),
      selectionLocked: Boolean(CONFIGURED_LIMA_INSTANCE),
    };
  }

  async createRuntimeInstance(
    input: CreateRuntimeInstanceInput,
    progress?: OperationProgress,
  ): Promise<void> {
    this.requireRuntimeIdle();
    if (CONFIGURED_LIMA_INSTANCE && input.name !== CONFIGURED_LIMA_INSTANCE) {
      throw new ExpectedError(
        "runtime_instance_selection_locked",
        `OVERSEER_LIMA_INSTANCE=${CONFIGURED_LIMA_INSTANCE} 설정으로 인스턴스 선택이 고정되어 있습니다.`,
        409,
      );
    }
    if (await this.getInstance(input.name)) {
      throw new ExpectedError(
        "runtime_instance_exists",
        "같은 이름의 Lima 인스턴스가 이미 있습니다.",
        409,
      );
    }
    await this.requireAvailableVmType(input.configuration);
    progress?.step("Lima 인스턴스 만드는 중");
    await this.startNewInstance(input.name, input.configuration, progress);
    this.instanceStore.markManaged(input.name);
    if (!CONFIGURED_LIMA_INSTANCE) this.instanceStore.setActiveInstanceName(input.name);
    await this.waitForDockerReady(progress, input.name);
    const instance = await this.requireInstanceDetails(input.name);
    await this.configureDockerContext(instance, progress);
  }

  async selectRuntimeInstance(name: string, progress?: OperationProgress): Promise<void> {
    this.requireRuntimeIdle();
    this.requireSelectableInstance(name);
    const instance = await this.requireInstanceDetails(name);
    if (!this.dockerSocketConfigured(instance)) {
      throw new ExpectedError(
        "runtime_instance_incompatible",
        "Docker socket을 호스트로 전달하는 Lima 인스턴스만 사용할 수 있습니다.",
        409,
      );
    }
    if (!this.homeMountWritable(instance)) {
      throw new ExpectedError(
        "runtime_instance_not_prepared",
        "먼저 Overseer 사용 준비를 실행해 macOS 홈 공유를 쓰기 가능하게 설정하십시오.",
        409,
      );
    }
    await this.configureDockerContext(instance, progress);
    if (!CONFIGURED_LIMA_INSTANCE) this.instanceStore.setActiveInstanceName(name);
  }

  async prepareRuntimeInstance(name: string, progress?: OperationProgress): Promise<void> {
    this.requireRuntimeIdle();
    this.requireSelectableInstance(name);
    let instance = await this.requireInstanceDetails(name);
    if (!this.dockerSocketConfigured(instance)) {
      throw new ExpectedError(
        "runtime_instance_incompatible",
        "Docker template으로 생성되어 socket forwarding이 구성된 Lima 인스턴스만 준비할 수 있습니다.",
        409,
      );
    }
    if (this.homeMountWritable(instance)) {
      if (name === this.instanceName) {
        await this.configureDockerContext(instance, progress);
      }
      return;
    }
    const wasRunning = instance.status.toLowerCase() === "running";
    if (wasRunning) {
      progress?.step("Lima 인스턴스 중지 중");
      await this.command("limactl", ["stop", name], {
        onOutput: progress?.output,
        timeoutMs: 120_000,
      });
    }
    if (!this.homeMountWritable(instance)) {
      progress?.step("macOS 홈 공유를 쓰기 가능하게 설정 중");
      await this.command("limactl", ["edit", name, "--mount-writable", "--tty=false"], {
        onOutput: progress?.output,
        timeoutMs: 120_000,
      });
    }
    if (wasRunning) {
      progress?.step("Lima 인스턴스 시작 중");
      await this.command("limactl", ["start", name, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
      await this.waitForDockerReady(progress, name);
    }
    instance = await this.requireInstanceDetails(name);
    if (!this.homeMountWritable(instance)) {
      throw new ExpectedError(
        "host_mount_not_writable",
        "Lima의 macOS 홈 공유를 쓰기 가능하게 설정하지 못했습니다.",
        503,
      );
    }
    if (name === this.instanceName) await this.configureDockerContext(instance, progress);
  }

  async startRuntimeInstance(name: string, progress?: OperationProgress): Promise<void> {
    this.requireRuntimeIdle();
    const instance = await this.requireInstanceDetails(name);
    if (!this.dockerSocketConfigured(instance)) {
      throw new ExpectedError(
        "runtime_instance_incompatible",
        "Docker 호환 Lima 인스턴스만 시작할 수 있습니다.",
        409,
      );
    }
    if (instance.status.toLowerCase() !== "running") {
      progress?.step("Lima 인스턴스 시작 중");
      await this.command("limactl", ["start", name, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
    }
    await this.waitForDockerReady(progress, name);
    if (name === this.instanceName) {
      await this.configureDockerContext(await this.requireInstanceDetails(name), progress);
    }
  }

  async stopRuntimeInstance(name: string, progress?: OperationProgress): Promise<void> {
    this.requireRuntimeIdle();
    const instance = await this.requireInstanceDetails(name);
    if (instance.status.toLowerCase() !== "running") return;
    progress?.step("Lima 인스턴스 중지 중");
    await this.command("limactl", ["stop", name], {
      onOutput: progress?.output,
      timeoutMs: 120_000,
    });
  }

  async getDockerDaemonConfiguration(): Promise<DockerDaemonConfigurationSnapshot> {
    const instance = await this.getInstance();
    if (!instance) {
      return dockerDaemonSnapshot(
        "{}",
        false,
        false,
        "Docker Engine을 만든 뒤 설정을 변경할 수 있습니다.",
      );
    }
    if (instance.status.toLowerCase() !== "running") {
      return dockerDaemonSnapshot(
        "{}",
        false,
        false,
        "Docker Engine을 시작한 뒤 설정을 변경할 수 있습니다.",
      );
    }
    const current = await this.readDockerDaemonConfiguration();
    return dockerDaemonSnapshot(
      current.source,
      current.exists,
      true,
      "저장하면 Docker Engine만 다시 시작하며 Lima VM은 유지됩니다.",
    );
  }

  applyDockerDaemonConfiguration(
    input: UpdateDockerDaemonConfigurationInput,
    progress?: OperationProgress,
  ): Promise<void> {
    if (this.transition || this.daemonTransition) {
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    }
    const applying = this.applyDockerDaemonConfigurationOnce(input, progress);
    this.daemonTransition = applying.finally(() => {
      this.daemonTransition = undefined;
    });
    return this.daemonTransition;
  }

  applyDockerDaemonConfigurationSection(
    input: UpdateDockerDaemonConfigurationSectionInput,
    progress?: OperationProgress,
  ): Promise<void> {
    if (this.transition || this.daemonTransition) {
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    }
    const applying = this.applyDockerDaemonConfigurationSectionOnce(input, progress);
    this.daemonTransition = applying.finally(() => {
      this.daemonTransition = undefined;
    });
    return this.daemonTransition;
  }

  async connectDockerCli(progress?: OperationProgress): Promise<void> {
    let instance = await this.getInstanceDetails();
    if (!instance) {
      throw new ExpectedError(
        "runtime_missing",
        "Docker CLI를 연결하려면 Docker Engine을 먼저 만드십시오.",
        409,
      );
    }
    if (!this.homeMountWritable(instance)) {
      if (instance.status.toLowerCase() === "running") {
        progress?.step("Lima 런타임 중지 중");
        await this.command("limactl", ["stop", this.instanceName], {
          onOutput: progress?.output,
          timeoutMs: 120_000,
        });
      }
      progress?.step("macOS 홈 공유를 쓰기 가능하게 설정 중");
      await this.command(
        "limactl",
        ["edit", this.instanceName, "--mount-writable", "--tty=false"],
        {
          onOutput: progress?.output,
          timeoutMs: 120_000,
        },
      );
      progress?.step("Lima 런타임 시작 중");
      await this.command("limactl", ["start", this.instanceName, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
      await this.waitForDockerReady(progress);
      instance = await this.getInstanceDetails();
      if (!instance || !this.homeMountWritable(instance)) {
        throw new ExpectedError(
          "host_mount_not_writable",
          "Lima의 macOS 홈 공유를 쓰기 가능하게 설정하지 못했습니다.",
          503,
        );
      }
    }
    await this.configureDockerContext(instance, progress);
  }

  startRuntime(
    progress?: OperationProgress,
    configuration?: DockerEngineConfiguration,
  ): Promise<RuntimeSnapshot> {
    if (this.transition) return this.transition;
    this.transition = this.startRuntimeOnce(progress, configuration).finally(() => {
      this.transition = undefined;
    });
    return this.transition;
  }

  recreateRuntime(
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<RuntimeSnapshot> {
    if (this.transition)
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    this.transition = this.recreateRuntimeOnce(configuration, progress).finally(() => {
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
    await this.command("limactl", ["stop", this.instanceName], {
      onOutput: progress?.output,
      timeoutMs: 120_000,
    });
    return this.stoppedSnapshot();
  }

  async restartRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot> {
    if (this.transition)
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    if (!(await this.getInstance())) {
      throw new ExpectedError(
        "runtime_missing",
        "재시작할 Docker Engine 인스턴스가 없습니다.",
        409,
      );
    }
    await this.stopRuntime(progress);
    return this.startRuntime(progress);
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
    const inspected = await this.inspectContainer(id);

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

    const mounts: ContainerMount[] = [];
    const volumes: ContainerVolumeMount[] = [];
    for (const mount of inspected.Mounts ?? []) {
      const common = { containerPath: mount.Destination, readOnly: !mount.RW };
      if (mount.Type === "volume" && mount.Name) {
        mounts.push({ ...common, type: "volume", volume: mount.Name });
        volumes.push({ ...common, volume: mount.Name });
      } else if (mount.Type === "bind") {
        mounts.push({ ...common, hostPath: mount.Source, type: "bind" });
      } else {
        mounts.push({
          ...common,
          dockerType: mount.Type,
          ...(mount.Source ? { source: mount.Source } : {}),
          type: "other",
        });
      }
      if (mount.Type !== "volume" || !mount.Name)
        blockers.push("named volume 이외의 마운트가 있습니다.");
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
      mounts: mounts.sort((left, right) => left.containerPath.localeCompare(right.containerPath)),
      replacementBlockers: [...new Set(blockers)],
      running: inspected.State.Running,
      spec,
    };
  }

  async getContainerInspection(id: string): Promise<ContainerInspection> {
    const inspected = await this.inspectContainer(id);
    const health = containerHealth(inspected);
    return {
      ...(health ? { health } : {}),
      json: JSON.stringify(inspected, null, 2),
    };
  }

  async getContainerTerminalAccess(id: string): Promise<ContainerTerminalAccess> {
    let inspected = await this.inspectContainer(id);
    const unavailable = this.containerTerminalUnavailable(inspected);
    if (unavailable) return unavailable;

    for (const shell of CONTAINER_SHELLS) {
      try {
        await this.rawDockerForInstance(
          this.instanceName,
          ["container", "exec", id, shell, "-c", "exit 0"],
          2_000,
        );
        return {
          command: `docker --context ${DOCKER_CONTEXT} exec -it ${inspected.Id.slice(0, 12)} ${shell}`,
          shell,
          status: "ready",
        };
      } catch (error) {
        if (error instanceof CommandError && this.isMissingContainerExecutable(error)) continue;
        inspected = await this.inspectContainer(id);
        const changedState = this.containerTerminalUnavailable(inspected);
        if (changedState) return changedState;
        if (error instanceof CommandError) {
          throw new ExpectedError("docker_command_failed", this.dockerMessage(error), 503);
        }
        throw error;
      }
    }

    inspected = await this.inspectContainer(id);
    return this.containerTerminalUnavailable(inspected) ?? { status: "shell-not-found" };
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
    const [discovered, remoteProjects, builderProjects] = await Promise.all([
      this.getDiscoveredComposeProjects(),
      this.remoteCompose.list(),
      this.builderCompose.list(),
    ]);
    const discoveredByName = new Map(discovered.map((project) => [project.name, project]));
    const remote = remoteProjects.map((project): ComposeProjectSummary => {
      const active = discoveredByName.get(project.name);
      discoveredByName.delete(project.name);
      return {
        configFiles: [project.configFile],
        name: project.name,
        remote: {
          buildContext: project.buildContext,
          ...(project.checkError ? { checkError: project.checkError } : {}),
          checkedAt: project.checkedAt,
          updateAvailable: project.updateAvailable,
          url: project.url,
        },
        status: active?.status ?? (project.buildContext ? "blocked" : "registered"),
      };
    });
    const builder = builderProjects.map((project): ComposeProjectSummary => {
      const active = discoveredByName.get(project.name);
      discoveredByName.delete(project.name);
      return {
        builder: { configHash: project.configHash },
        configFiles: [project.configFile],
        name: project.name,
        status: active?.status ?? "registered",
      };
    });
    return [...remote, ...builder, ...discoveredByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  private async getDiscoveredComposeProjects(): Promise<ComposeProjectSummary[]> {
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
    const [result, configuration] = await Promise.all([
      this.compose(project, ["ps", "--all", "--format", "json"]),
      this.getComposeProjectConfiguration(project),
    ]);
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
    return { ...project, configuration, services };
  }

  private async getComposeProjectConfiguration(
    project: ComposeProjectSummary,
  ): Promise<ComposeProjectDetail["configuration"]> {
    if (project.remote) {
      const remote = await this.remoteCompose.get(project.name);
      if (!remote) {
        throw new ExpectedError(
          "remote_compose_not_found",
          "URL Compose 프로젝트를 찾을 수 없습니다.",
          404,
        );
      }
      return {
        checkedAt: remote.checkedAt,
        ...(remote.checkError ? { checkError: remote.checkError } : {}),
        contentHash: remote.contentHash,
        kind: "remote",
        ...(remote.pendingHash ? { pendingHash: remote.pendingHash } : {}),
        ...(remote.pendingContent ? { pendingYaml: remote.pendingContent } : {}),
        url: remote.url,
        yaml: remote.content,
      };
    }
    if (project.builder) {
      const builder = await this.builderCompose.get(project.name);
      if (!builder) {
        throw new ExpectedError(
          "builder_compose_not_found",
          "폼 Compose 프로젝트를 찾을 수 없습니다.",
          404,
        );
      }
      return {
        configHash: builder.configHash,
        kind: "builder",
        yaml: builder.yaml,
      };
    }
    return { configFiles: project.configFiles, kind: "discovered" };
  }

  async getBuilderComposeProject(name: string): Promise<ComposeBuilderProjectDetail> {
    const project = await this.builderCompose.get(name);
    if (!project) {
      throw new ExpectedError(
        "builder_compose_not_found",
        "폼 Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return { configHash: project.configHash, spec: project.spec, yaml: project.yaml };
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
    if (action === "up" && project.remote?.buildContext) {
      throw new ExpectedError(
        "compose_build_context_unsupported",
        "URL Compose의 build context는 로컬 소스가 없어 실행할 수 없습니다.",
        409,
      );
    }
    progress?.step(`Compose ${action} 실행 중`);
    const command = action === "up" ? ["up", "--detach"] : [action];
    await this.compose(project, command, action === "up" ? 10 * 60_000 : 120_000, progress);
  }

  async registerRemoteCompose(
    input: RegisterRemoteComposeInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const [discovered, builder] = await Promise.all([
      this.getDiscoveredComposeProjects(),
      this.builderCompose.list(),
    ]);
    await this.remoteCompose.register(
      input,
      [...discovered, ...builder].map(({ name }) => name),
      progress,
    );
  }

  async registerBuilderCompose(
    spec: ComposeBuilderSpec,
    progress?: OperationProgress,
  ): Promise<void> {
    const [discovered, remote] = await Promise.all([
      this.getDiscoveredComposeProjects(),
      this.remoteCompose.list(),
    ]);
    await this.builderCompose.register(
      spec,
      [...discovered, ...remote].map(({ name }) => name),
      progress,
    );
  }

  async updateBuilderCompose(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<void> {
    if ((await this.getDiscoveredComposeProjects()).some((project) => project.name === name)) {
      throw new ExpectedError(
        "builder_compose_active",
        "폼 Compose 프로젝트를 먼저 내린 뒤 수정하십시오.",
        409,
      );
    }
    await this.builderCompose.update(name, input, progress);
  }

  async checkRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.remoteCompose.checkUpdate(name, progress);
  }

  async applyRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.remoteCompose.applyUpdate(name, progress);
  }

  async removeRemoteCompose(name: string, progress?: OperationProgress): Promise<void> {
    const discovered = (await this.getDiscoveredComposeProjects()).find(
      (project) => project.name === name,
    );
    if (discovered) {
      throw new ExpectedError(
        "remote_compose_active",
        "URL Compose 프로젝트의 컨테이너와 네트워크를 먼저 내리십시오.",
        409,
      );
    }
    progress?.step("URL Compose 등록 해제 중");
    await this.remoteCompose.remove(name);
  }

  async removeBuilderCompose(name: string, progress?: OperationProgress): Promise<void> {
    if ((await this.getDiscoveredComposeProjects()).some((project) => project.name === name)) {
      throw new ExpectedError(
        "builder_compose_active",
        "폼 Compose 프로젝트의 컨테이너와 네트워크를 먼저 내리십시오.",
        409,
      );
    }
    progress?.step("폼 Compose 등록 해제 중");
    await this.builderCompose.remove(name);
  }

  async pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 받는 중");
    await this.docker(["image", "pull", input.image], 10 * 60_000, progress);
  }

  async removeImage(id: string, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 삭제 중");
    await this.docker(["image", "rm", id], 120_000, progress);
  }

  async getImage(id: string): Promise<ImageDetail> {
    const result = await this.docker(["image", "inspect", id]);
    const inspected = parseImageInspectOutput(result.stdout)[0]!;

    const config = inspected.Config ?? {};
    return {
      architecture: inspected.Architecture,
      command: [...(config.Cmd ?? [])],
      ...(inspected.Comment ? { comment: inspected.Comment } : {}),
      createdAt: inspected.Created,
      entrypoint: [...(config.Entrypoint ?? [])],
      environment: environmentValues(config.Env),
      exposedPorts: Object.keys(config.ExposedPorts ?? {}).sort(),
      id: inspected.Id,
      inspectJson: JSON.stringify(inspected, null, 2),
      labels: imageLabels(config.Labels),
      layers: [...(inspected.RootFS?.Layers ?? [])],
      operatingSystem: inspected.Os,
      repositoryDigests: [...(inspected.RepoDigests ?? [])].sort(),
      repositoryTags: [...(inspected.RepoTags ?? [])].sort(),
      sizeBytes: inspected.Size,
      ...(config.WorkingDir ? { workingDirectory: config.WorkingDir } : {}),
    };
  }

  async getImageHistory(id: string): Promise<ImageHistoryEntry[]> {
    const result = await this.docker([
      "image",
      "history",
      "--no-trunc",
      "--format",
      IMAGE_ROW_FORMAT,
      id,
    ]);
    return parseJsonLines<DockerImageHistoryRow>(result.stdout)
      .slice(0, 500)
      .map((row) => ({
        ...(row.Comment ? { comment: row.Comment.slice(0, 500) } : {}),
        createdAt: row.CreatedAt,
        createdBy: row.CreatedBy.slice(0, 4_000),
        createdSince: row.CreatedSince,
        ...(row.ID && row.ID !== "<missing>" ? { id: row.ID } : {}),
        size: row.Size,
      }));
  }

  async getImageRepositoryTags(id: string, page: number): Promise<ImageRepositoryTags> {
    const detail = await this.getImage(id);
    const repository = dockerHubRepository(detail.repositoryTags);
    if (!repository) {
      throw new ExpectedError(
        "image_tags_unsupported",
        "공개 Docker Hub 저장소의 태그만 조회할 수 있습니다.",
        409,
      );
    }

    const [namespace, name] = repository.split("/");
    if (!namespace || !name) {
      throw new ExpectedError(
        "image_tags_unsupported",
        "Docker Hub 저장소를 확인할 수 없습니다.",
        409,
      );
    }
    const pageSize = 25;
    const url = new URL(
      `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(name)}/tags`,
    );
    url.searchParams.set("ordering", "last_updated");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));

    let value: unknown;
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        throw new ExpectedError(
          "image_tags_unavailable",
          "Docker Hub 태그 목록을 불러오지 못했습니다.",
          503,
        );
      }
      value = await response.json();
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw new ExpectedError(
        "image_tags_unavailable",
        "Docker Hub 태그 목록을 불러오지 못했습니다.",
        503,
      );
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError(
        "invalid_image_tags",
        "Docker Hub 태그 응답을 해석하지 못했습니다.",
        503,
      );
    }
    const source = value as { count?: unknown; results?: unknown };
    if (
      typeof source.count !== "number" ||
      !Number.isSafeInteger(source.count) ||
      source.count < 0 ||
      !Array.isArray(source.results)
    ) {
      throw new ExpectedError(
        "invalid_image_tags",
        "Docker Hub 태그 응답을 해석하지 못했습니다.",
        503,
      );
    }
    const results = (source.results as DockerHubTagResult[]).slice(0, pageSize);
    return {
      count: source.count,
      page,
      pageSize,
      repository,
      tags: results.flatMap((tag) => {
        if (
          typeof tag.name !== "string" ||
          typeof tag.last_updated !== "string" ||
          typeof tag.full_size !== "number" ||
          !Number.isFinite(tag.full_size) ||
          tag.full_size < 0
        ) {
          return [];
        }
        const platforms = (tag.images ?? [])
          .flatMap(({ architecture, os, variant }) =>
            architecture && architecture !== "unknown" && os && os !== "unknown"
              ? [`${os}/${architecture}${variant ? `/${variant}` : ""}`]
              : [],
          )
          .filter((platform, index, values) => values.indexOf(platform) === index)
          .sort();
        return [
          {
            lastUpdated: tag.last_updated,
            name: tag.name,
            platforms,
            sizeBytes: tag.full_size,
          },
        ];
      }),
    };
  }

  async getImages(): Promise<ImageSummary[]> {
    const result = await this.docker(["image", "ls", "--format", IMAGE_ROW_FORMAT]);
    const rows = parseJsonLines<DockerImageRow>(result.stdout);
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map(({ ID }) => ID))];
    const inspectResult = await this.docker(["image", "inspect", ...ids]);
    const platforms = new Map<string, string>();
    for (const image of parseImageInspectOutput(inspectResult.stdout)) {
      const id = image.Id.replace(/^sha256:/, "");
      const platform = `${image.Os}/${image.Architecture}`;
      platforms.set(id, platform);
      platforms.set(id.slice(0, 12), platform);
    }
    return rows.map((row) => ({
      createdAt: row.CreatedAt,
      createdSince: row.CreatedSince,
      id: row.ID,
      platform: platforms.get(row.ID) ?? "—",
      repository: row.Repository,
      size: row.Size,
      tag: row.Tag,
      url: imageReferenceUrl(row.Repository, row.Tag),
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

  async getVolume(name: string): Promise<VolumeDetail> {
    const result = await this.docker(["volume", "inspect", name]);
    const inspected = parseVolumeInspectOutput(result.stdout);
    return {
      ...(inspected.CreatedAt ? { createdAt: inspected.CreatedAt } : {}),
      driver: inspected.Driver,
      inspectJson: JSON.stringify(inspected, null, 2),
      labels: imageLabels(inspected.Labels),
      mountpoint: inspected.Mountpoint,
      name: inspected.Name,
      options: imageLabels(inspected.Options),
      scope: inspected.Scope,
    };
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

  async getNetwork(name: string): Promise<NetworkDetail> {
    const result = await this.docker(["network", "inspect", name]);
    const inspected = parseNetworkInspectOutput(result.stdout);
    return {
      attachable: inspected.Attachable === true,
      builtIn: BUILT_IN_NETWORKS.has(inspected.Name),
      configOnly: inspected.ConfigOnly === true,
      containers: Object.entries(inspected.Containers ?? {})
        .map(([id, container]) => ({
          ...(container.EndpointID ? { endpointId: container.EndpointID } : {}),
          id,
          ...(container.IPv4Address ? { ipv4Address: container.IPv4Address } : {}),
          ...(container.IPv6Address ? { ipv6Address: container.IPv6Address } : {}),
          ...(container.MacAddress ? { macAddress: container.MacAddress } : {}),
          name: container.Name || id.slice(0, 12),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      createdAt: inspected.Created,
      driver: inspected.Driver,
      enableIpv4:
        inspected.EnableIPv4 === true ||
        (inspected.IPAM?.Config ?? []).some(({ Subnet }) => Subnet?.includes(".")),
      enableIpv6:
        inspected.EnableIPv6 === true ||
        (inspected.IPAM?.Config ?? []).some(({ Subnet }) => Subnet?.includes(":")),
      id: inspected.Id,
      ingress: inspected.Ingress === true,
      inspectJson: JSON.stringify(inspected, null, 2),
      internal: inspected.Internal === true,
      ipamConfigurations: (inspected.IPAM?.Config ?? []).map((configuration) => ({
        auxiliaryAddresses: imageLabels(
          configuration.AuxAddress ?? configuration.AuxiliaryAddresses,
        ),
        ...(configuration.Gateway ? { gateway: configuration.Gateway } : {}),
        ...(configuration.IPRange ? { ipRange: configuration.IPRange } : {}),
        ...(configuration.Subnet ? { subnet: configuration.Subnet } : {}),
      })),
      ipamDriver: inspected.IPAM?.Driver ?? "—",
      ipamOptions: imageLabels(inspected.IPAM?.Options),
      labels: imageLabels(inspected.Labels),
      name: inspected.Name,
      options: imageLabels(inspected.Options),
      scope: inspected.Scope,
    };
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

  private async inspectContainer(id: string): Promise<DockerInspectContainer> {
    const result = await this.docker(["container", "inspect", id]);
    return parseContainerInspectOutput(result.stdout);
  }

  private async startRuntimeOnce(
    progress?: OperationProgress,
    configuration?: DockerEngineConfiguration,
  ): Promise<RuntimeSnapshot> {
    const instance = await this.getInstance();
    if (!instance) {
      return this.createRuntime(configuration ?? DEFAULT_DOCKER_ENGINE_CONFIGURATION, progress);
    }
    if (configuration) {
      throw new ExpectedError(
        "runtime_exists",
        "기존 Docker Engine 설정은 재생성으로 변경하십시오.",
        409,
      );
    }
    if (instance.status.toLowerCase() !== "running") {
      progress?.step("Lima 런타임 시작 중");
      await this.command("limactl", ["start", this.instanceName, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
    }
    await this.waitForDockerReady(progress);
    await this.connectDockerCli(progress);
    return this.getRuntimeSnapshot();
  }

  private async applyDockerDaemonConfigurationOnce(
    input: UpdateDockerDaemonConfigurationInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const original = await this.requireRunningDockerDaemonConfiguration();
    await this.replaceDockerDaemonConfiguration(input, original, progress);
  }

  private async applyDockerDaemonConfigurationSectionOnce(
    input: UpdateDockerDaemonConfigurationSectionInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const original = await this.requireRunningDockerDaemonConfiguration();
    const snapshot = dockerDaemonSnapshot(original.source, original.exists, true, "");
    const merged = mergeDockerDaemonConfigurationSection(snapshot, input);
    await this.replaceDockerDaemonConfiguration(merged, original, progress);
  }

  private async requireRunningDockerDaemonConfiguration(): Promise<{
    exists: boolean;
    source: string;
  }> {
    const instance = await this.getInstance();
    if (!instance) {
      throw new ExpectedError(
        "runtime_missing",
        "Docker Engine 설정을 적용하려면 Docker Engine을 먼저 만드십시오.",
        409,
      );
    }
    if (instance.status.toLowerCase() !== "running") {
      throw new ExpectedError(
        "runtime_not_running",
        "Docker Engine 설정을 적용하려면 Docker Engine을 먼저 시작하십시오.",
        409,
      );
    }
    return this.readDockerDaemonConfiguration();
  }

  private async replaceDockerDaemonConfiguration(
    input: UpdateDockerDaemonConfigurationInput,
    original: { exists: boolean; source: string },
    progress?: OperationProgress,
  ): Promise<void> {
    const next = dockerDaemonJson(input);
    progress?.step("daemon.json 검증 중");
    try {
      await this.writeDockerDaemonConfiguration(next, progress);
    } catch (error) {
      progress?.output(error instanceof Error ? error.message : String(error));
      throw new ExpectedError(
        "daemon_configuration_invalid",
        "Docker가 daemon.json 설정을 거부했습니다. 입력값을 확인하십시오.",
        400,
      );
    }

    try {
      await this.restartDockerDaemon(progress);
      await this.waitForDockerReady(progress);
    } catch (error) {
      progress?.output(error instanceof Error ? error.message : String(error));
      progress?.step("이전 daemon.json 복구 중");
      try {
        if (original.exists) {
          await this.writeDockerDaemonConfiguration(original.source, progress);
        } else {
          await this.removeDockerDaemonConfiguration(progress);
        }
        await this.restartDockerDaemon(progress);
        await this.waitForDockerReady(progress);
      } catch (rollbackError) {
        progress?.output(
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        );
        throw new ExpectedError(
          "daemon_configuration_rollback_failed",
          "Docker Engine 설정 적용에 실패했고 이전 설정도 자동 복구하지 못했습니다.",
          503,
        );
      }
      throw new ExpectedError(
        "daemon_configuration_apply_failed",
        "Docker Engine 설정을 적용하지 못해 이전 설정으로 복구했습니다.",
        503,
      );
    }
  }

  private async readDockerDaemonConfiguration(): Promise<{ exists: boolean; source: string }> {
    const result = await this.command("limactl", [
      "shell",
      this.instanceName,
      "sh",
      "-lc",
      READ_DOCKER_DAEMON_CONFIGURATION,
    ]);
    const separator = result.stdout.indexOf("\n");
    const marker = separator >= 0 ? result.stdout.slice(0, separator).trim() : "";
    const source = separator >= 0 ? result.stdout.slice(separator + 1) : "{}\n";
    if (marker !== "file" && marker !== "default") {
      throw new ExpectedError(
        "daemon_configuration_unreadable",
        "VM의 daemon.json 상태를 확인하지 못했습니다.",
        503,
      );
    }
    return { exists: marker === "file", source };
  }

  private async writeDockerDaemonConfiguration(
    source: string,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.command(
      "limactl",
      ["shell", this.instanceName, "sh", "-lc", WRITE_DOCKER_DAEMON_CONFIGURATION],
      {
        input: source,
        onOutput: progress?.output,
        timeoutMs: 30_000,
      },
    );
  }

  private async removeDockerDaemonConfiguration(progress?: OperationProgress): Promise<void> {
    await this.command(
      "limactl",
      ["shell", this.instanceName, "sh", "-lc", REMOVE_DOCKER_DAEMON_CONFIGURATION],
      { onOutput: progress?.output, timeoutMs: 30_000 },
    );
  }

  private async restartDockerDaemon(progress?: OperationProgress): Promise<void> {
    progress?.step("Docker Engine 다시 시작 중");
    await this.command(
      "limactl",
      ["shell", this.instanceName, "systemctl", "--user", "restart", "docker"],
      { onOutput: progress?.output, timeoutMs: 120_000 },
    );
  }

  private async recreateRuntimeOnce(
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<RuntimeSnapshot> {
    await this.requireAvailableVmType(configuration);
    const instance = await this.getInstance();
    if (!instance) {
      throw new ExpectedError(
        "runtime_missing",
        "재생성할 Lima 인스턴스가 없습니다. Docker Engine을 먼저 만드십시오.",
        409,
      );
    }
    if (
      this.instanceName !== DEFAULT_LIMA_INSTANCE &&
      !this.instanceStore.isManaged(this.instanceName)
    ) {
      throw new ExpectedError(
        "runtime_instance_external",
        "외부에서 만든 Lima 인스턴스는 Overseer에서 재생성할 수 없습니다.",
        409,
      );
    }
    if (instance.status.toLowerCase() === "running") {
      progress?.step("Lima 런타임 중지 중");
      await this.command("limactl", ["stop", this.instanceName], {
        onOutput: progress?.output,
        timeoutMs: 120_000,
      });
    }
    progress?.step("Lima 환경 삭제 중");
    await this.command("limactl", ["delete", "--force", this.instanceName], {
      onOutput: progress?.output,
      timeoutMs: 120_000,
    });
    return this.createRuntime(configuration, progress);
  }

  private async createRuntime(
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<RuntimeSnapshot> {
    await this.requireAvailableVmType(configuration);
    progress?.step("Lima 환경 만드는 중");
    await this.startNewInstance(this.instanceName, configuration, progress);
    this.instanceStore.markManaged(this.instanceName);
    if (!CONFIGURED_LIMA_INSTANCE) this.instanceStore.setActiveInstanceName(this.instanceName);
    await this.waitForDockerReady(progress);
    await this.connectDockerCli(progress);
    return this.getRuntimeSnapshot();
  }

  private async waitForDockerReady(
    progress?: OperationProgress,
    instanceName = this.instanceName,
  ): Promise<RuntimeSnapshot> {
    progress?.step("Docker 준비 확인 중");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const runtime = await this.getRuntimeSnapshot(instanceName);
      if (runtime.phase === "running") return runtime;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new ExpectedError(
      "docker_not_ready",
      "Lima는 실행 중이지만 Docker가 준비되지 않았습니다. 잠시 후 다시 시도하십시오.",
      503,
    );
  }

  private async requireAvailableVmType(configuration: DockerEngineConfiguration): Promise<void> {
    if (configuration.vmType === "qemu" && !(await this.isQemuAvailable())) {
      throw new ExpectedError(
        "runtime_driver_unavailable",
        "QEMU를 찾을 수 없습니다. brew install qemu로 설치한 뒤 다시 시도하십시오.",
        409,
      );
    }
  }

  private async isQemuAvailable(): Promise<boolean> {
    const executable =
      process.arch === "arm64"
        ? (process.env.QEMU_SYSTEM_AARCH64 ?? "qemu-system-aarch64")
        : process.arch === "x64"
          ? (process.env.QEMU_SYSTEM_X86_64 ?? "qemu-system-x86_64")
          : undefined;
    if (!executable) return false;
    try {
      await this.command(executable, ["--version"], { timeoutMs: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  private requireRuntimeIdle(): void {
    if (this.transition || this.daemonTransition) {
      throw new ExpectedError("runtime_busy", "다른 런타임 작업이 진행 중입니다.", 409);
    }
  }

  private requireSelectableInstance(name: string): void {
    if (CONFIGURED_LIMA_INSTANCE && name !== CONFIGURED_LIMA_INSTANCE) {
      throw new ExpectedError(
        "runtime_instance_selection_locked",
        `OVERSEER_LIMA_INSTANCE=${CONFIGURED_LIMA_INSTANCE} 설정으로 인스턴스 선택이 고정되어 있습니다.`,
        409,
      );
    }
  }

  private async listInstanceDetails(): Promise<LimaInstanceDetails[]> {
    try {
      const result = await this.command("limactl", ["list", "--json"]);
      return parseJsonLines<unknown>(result.stdout).map(parseLimaInstanceDetails);
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      if (error instanceof CommandError && error.message.includes("ENOENT")) {
        throw new ExpectedError("lima_unavailable", "Lima 실행 파일을 찾을 수 없습니다.", 503);
      }
      throw new ExpectedError(
        "invalid_lima_output",
        "Lima 인스턴스 목록을 해석하지 못했습니다.",
        503,
      );
    }
  }

  private async runtimeInstanceSummary(
    instance: LimaInstanceDetails,
  ): Promise<RuntimeInstanceSummary> {
    let configuration: DockerEngineConfiguration | undefined;
    try {
      configuration = this.configurationFromInstance(instance);
    } catch {
      configuration = undefined;
    }
    const socketConfigured = this.dockerSocketConfigured(instance);
    let dockerVersion: string | undefined;
    if (socketConfigured && instance.status.toLowerCase() === "running") {
      try {
        const result = await this.command(
          "docker",
          [
            "--host",
            `unix://${instance.dir}/sock/docker.sock`,
            "version",
            "--format",
            "{{.Server.Version}}",
          ],
          { timeoutMs: 5_000 },
        );
        dockerVersion = result.stdout.trim() || undefined;
      } catch {
        dockerVersion = undefined;
      }
    }
    const compatible = Boolean(configuration && socketConfigured);
    const homeMountWritable = this.homeMountWritable(instance);
    const prepared = compatible && homeMountWritable;
    const message = !compatible
      ? "Docker socket forwarding을 확인할 수 없습니다."
      : !homeMountWritable
        ? "macOS 홈 공유 준비가 필요합니다."
        : instance.status.toLowerCase() === "running" && !dockerVersion
          ? "Docker Engine을 확인할 수 없습니다."
          : "Overseer에서 사용할 수 있습니다.";
    return {
      active: instance.name === this.instanceName,
      architecture: instance.arch ?? "-",
      compatible,
      ...(configuration ? { configuration } : {}),
      ...(dockerVersion ? { dockerVersion } : {}),
      homeMountWritable,
      managed:
        this.instanceStore.isManaged(instance.name) || instance.name === DEFAULT_LIMA_INSTANCE,
      message,
      name: instance.name,
      prepared,
      status: instance.status,
    };
  }

  private dockerSocketConfigured(instance: LimaInstanceDetails): boolean {
    const expectedHostSocket = `${instance.dir}/sock/docker.sock`;
    return Boolean(
      instance.config?.portForwards?.some(
        ({ guestSocket, hostSocket }) =>
          hostSocket === expectedHostSocket && guestSocket?.endsWith("/docker.sock"),
      ),
    );
  }

  private async requireInstanceDetails(name: string): Promise<LimaInstanceDetails> {
    const instance = await this.getInstanceDetails(name);
    if (!instance) {
      throw new ExpectedError(
        "runtime_instance_not_found",
        "Lima 인스턴스를 찾을 수 없습니다.",
        404,
      );
    }
    return instance;
  }

  private async startNewInstance(
    name: string,
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.command(
      "limactl",
      [
        "start",
        `--name=${name}`,
        `--vm-type=${configuration.vmType}`,
        `--cpus=${configuration.cpus}`,
        `--memory=${configuration.memoryGiB}`,
        `--disk=${configuration.diskGiB}`,
        "--mount-writable",
        "template:docker",
        "--tty=false",
        "--progress",
      ],
      {
        onOutput: progress?.output,
        timeoutMs: 20 * 60_000,
      },
    );
  }

  private async getRuntimeSnapshot(instanceName = this.instanceName): Promise<RuntimeSnapshot> {
    let instance: LimaInstance | undefined;
    try {
      instance = await this.getInstance(instanceName);
    } catch (error) {
      if (error instanceof CommandError && error.message.includes("ENOENT")) {
        return {
          instance: instanceName,
          message: "Lima 실행 파일을 찾을 수 없습니다.",
          phase: "error",
        };
      }
      throw error;
    }
    if (!instance) return this.missingSnapshot(instanceName);
    if (instance.status.toLowerCase() !== "running") return this.stoppedSnapshot(instanceName);
    try {
      const result = await this.dockerForInstance(instanceName, [
        "version",
        "--format",
        "{{.Server.Version}}",
      ]);
      return {
        dockerVersion: result.stdout.trim(),
        instance: instanceName,
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      };
    } catch {
      return {
        instance: instanceName,
        message: "Lima는 실행 중이며 Docker socket을 준비하고 있습니다.",
        phase: "starting",
      };
    }
  }

  private async getInstance(instanceName = this.instanceName): Promise<LimaInstance | undefined> {
    let result;
    try {
      result = await this.command("limactl", ["list", instanceName, "--format", LIMA_ROW_FORMAT]);
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
    if (name !== instanceName || !status || !directory) return undefined;
    return { directory, status };
  }

  private async getInstanceDetails(
    instanceName = this.instanceName,
  ): Promise<LimaInstanceDetails | undefined> {
    let result;
    try {
      result = await this.command("limactl", ["list", instanceName, "--json"]);
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
    try {
      const instance = parseLimaInstanceDetails(JSON.parse(result.stdout));
      if (instance.name !== instanceName) throw new Error("unexpected Lima instance");
      return instance;
    } catch {
      throw new ExpectedError(
        "invalid_lima_output",
        "Lima 인스턴스 설정을 해석하지 못했습니다.",
        503,
      );
    }
  }

  private configurationFromInstance(instance: LimaInstanceDetails): DockerEngineConfiguration {
    if (instance.vmType !== "vz" && instance.vmType !== "qemu") {
      throw new ExpectedError(
        "unsupported_runtime_driver",
        `지원하지 않는 Lima VM 드라이버입니다: ${instance.vmType}`,
        503,
      );
    }
    if (!Number.isSafeInteger(instance.cpus) || instance.cpus < 1) {
      throw new ExpectedError(
        "invalid_lima_output",
        "Lima 인스턴스의 CPU 설정을 해석하지 못했습니다.",
        503,
      );
    }
    return {
      cpus: instance.cpus,
      diskGiB: this.integerGibibytes(instance.disk, "디스크"),
      memoryGiB: this.integerGibibytes(instance.memory, "메모리"),
      provider: "lima",
      vmType: instance.vmType,
    };
  }

  private homeMountWritable(instance: LimaInstanceDetails): boolean {
    const home = homedir();
    return Boolean(
      instance.config?.mounts?.some(
        (mount) =>
          mount.writable === true && (mount.location === home || mount.mountPoint === home),
      ),
    );
  }

  private async getDockerCliIntegration(
    instance?: LimaInstanceDetails,
  ): Promise<DockerCliIntegrationSnapshot> {
    if (!instance) {
      return {
        contextName: DOCKER_CONTEXT,
        homeMountWritable: false,
        message: "Docker Engine을 만들면 macOS Docker CLI가 자동으로 연결됩니다.",
        ready: false,
      };
    }
    const expectedEndpoint = `unix://${instance.dir}/sock/docker.sock`;
    const [activeContext, contextEndpoint] = await Promise.all([
      this.activeDockerContext(),
      this.dockerContextEndpoint(),
    ]);
    const homeMountWritable = this.homeMountWritable(instance);
    const ready =
      homeMountWritable && activeContext === DOCKER_CONTEXT && contextEndpoint === expectedEndpoint;
    const message = !homeMountWritable
      ? "로컬 Compose bind mount를 위해 macOS 홈 공유를 쓰기 가능하게 설정해야 합니다."
      : !contextEndpoint
        ? "overseer Docker context를 만들어야 합니다."
        : contextEndpoint !== expectedEndpoint
          ? "overseer Docker context가 다른 Docker Engine을 가리키고 있습니다."
          : activeContext !== DOCKER_CONTEXT
            ? `현재 Docker context는 ${activeContext || "확인되지 않음"}입니다.`
            : "터미널에서 별도 환경 변수 없이 docker 명령을 사용할 수 있습니다.";
    return {
      ...(activeContext ? { activeContext } : {}),
      ...(contextEndpoint ? { contextEndpoint } : {}),
      contextName: DOCKER_CONTEXT,
      expectedEndpoint,
      homeMountWritable,
      message,
      ready,
    };
  }

  private async activeDockerContext(): Promise<string | undefined> {
    try {
      const result = await this.command("docker", ["context", "show"], { timeoutMs: 5_000 });
      return result.stdout.trim() || undefined;
    } catch (error) {
      if (error instanceof CommandError) {
        throw new ExpectedError(
          "docker_context_unavailable",
          "현재 Docker context를 확인하지 못했습니다.",
          503,
        );
      }
      throw error;
    }
  }

  private async dockerContextEndpoint(): Promise<string | undefined> {
    try {
      const result = await this.command(
        "docker",
        ["context", "inspect", DOCKER_CONTEXT, "--format", "{{.Endpoints.docker.Host}}"],
        { timeoutMs: 5_000 },
      );
      return result.stdout.trim() || undefined;
    } catch (error) {
      if (
        error instanceof CommandError &&
        (error.stderr.includes("context not found") || error.stderr.includes("no such file"))
      ) {
        return undefined;
      }
      if (error instanceof CommandError) {
        throw new ExpectedError(
          "docker_context_unavailable",
          "overseer Docker context를 확인하지 못했습니다.",
          503,
        );
      }
      throw error;
    }
  }

  private async configureDockerContext(
    instance: LimaInstanceDetails,
    progress?: OperationProgress,
  ): Promise<void> {
    const endpoint = `unix://${instance.dir}/sock/docker.sock`;
    const currentEndpoint = await this.dockerContextEndpoint();
    progress?.step(currentEndpoint ? "Docker context 갱신 중" : "Docker context 만드는 중");
    await this.command(
      "docker",
      [
        "context",
        currentEndpoint ? "update" : "create",
        DOCKER_CONTEXT,
        "--description",
        DOCKER_CONTEXT_DESCRIPTION,
        "--docker",
        `host=${endpoint}`,
      ],
      { onOutput: progress?.output, timeoutMs: 30_000 },
    );
    progress?.step("overseer Docker context 선택 중");
    await this.command("docker", ["context", "use", DOCKER_CONTEXT], {
      onOutput: progress?.output,
      timeoutMs: 30_000,
    });
    progress?.step("Docker CLI 연결 확인 중");
    await this.command("docker", ["info", "--format", "{{.ServerVersion}}"], {
      onOutput: progress?.output,
      timeoutMs: 30_000,
    });
  }

  private integerGibibytes(value: number, label: string): number {
    const gibibytes = value / GIBIBYTE;
    if (!Number.isSafeInteger(gibibytes) || gibibytes < 1) {
      throw new ExpectedError(
        "unsupported_runtime_configuration",
        `${label}가 정수 GiB 단위가 아니어서 설정 화면에서 변경할 수 없습니다.`,
        503,
      );
    }
    return gibibytes;
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

  private async compose(
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
    return this.dockerForInstance(this.instanceName, args, timeoutMs, progress);
  }

  private async dockerForInstance(
    instanceName: string,
    args: readonly string[],
    timeoutMs?: number,
    progress?: OperationProgress,
  ) {
    try {
      return await this.rawDockerForInstance(instanceName, args, timeoutMs, progress);
    } catch (error) {
      if (error instanceof CommandError)
        throw new ExpectedError("docker_command_failed", this.dockerMessage(error), 503);
      throw error;
    }
  }

  private async rawDockerForInstance(
    instanceName: string,
    args: readonly string[],
    timeoutMs?: number,
    progress?: OperationProgress,
  ) {
    const instance = await this.getInstance(instanceName);
    if (!instance || instance.status.toLowerCase() !== "running") {
      throw new ExpectedError("runtime_unavailable", "Lima 런타임이 실행 중이 아닙니다.", 503);
    }
    const host = `unix://${instance.directory}/sock/docker.sock`;
    return this.command("docker", ["--host", host, ...args], {
      onOutput: progress?.output,
      timeoutMs,
    });
  }

  private containerTerminalUnavailable(
    inspected: DockerInspectContainer,
  ): ContainerTerminalAccess | undefined {
    if (inspected.State.Paused) return { status: "paused" };
    if (!inspected.State.Running || inspected.State.Restarting) return { status: "not-running" };
    return undefined;
  }

  private isMissingContainerExecutable(error: CommandError): boolean {
    const detail = stripVTControlCharacters(error.stderr).toLowerCase();
    return (
      detail.includes("executable file not found") ||
      (detail.includes("exec:") && detail.includes("no such file or directory"))
    );
  }

  private dockerMessage(error: CommandError): string {
    const detail = stripVTControlCharacters(error.stderr).trim();
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
    const lastLine = detail
      .split(/\r?\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    return lastLine?.slice(0, 2_000) || "Docker 명령을 완료하지 못했습니다.";
  }

  private missingSnapshot(instanceName = this.instanceName): RuntimeSnapshot {
    return {
      instance: instanceName,
      message: "전용 Lima 인스턴스가 아직 없습니다.",
      phase: "missing",
    };
  }

  private stoppedSnapshot(instanceName = this.instanceName): RuntimeSnapshot {
    return {
      instance: instanceName,
      message: "Lima 인스턴스가 중지되어 있습니다.",
      phase: "stopped",
    };
  }
}
