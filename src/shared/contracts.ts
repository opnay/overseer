export type RuntimePhase = "missing" | "stopped" | "starting" | "running" | "stopping" | "error";

export interface RuntimeSnapshot {
  dockerVersion?: string;
  instance: string;
  message: string;
  phase: RuntimePhase;
}

export type DockerEngineProvider = "lima";
export type LimaVmType = "qemu" | "vz";

export interface DockerEngineConfiguration {
  cpus: number;
  diskGiB: number;
  memoryGiB: number;
  provider: DockerEngineProvider;
  vmType: LimaVmType;
}

export interface DockerEngineConfigurationOption<T extends string> {
  available: boolean;
  label: string;
  unavailableReason?: string;
  value: T;
}

export interface DockerEngineConfigurationSnapshot {
  configuration: DockerEngineConfiguration;
  dockerCli: DockerCliIntegrationSnapshot;
  providers: DockerEngineConfigurationOption<DockerEngineProvider>[];
  source: "default" | "instance";
  vmTypes: DockerEngineConfigurationOption<LimaVmType>[];
}

export interface RuntimeInstanceSummary {
  active: boolean;
  architecture: string;
  compatible: boolean;
  configuration?: DockerEngineConfiguration;
  containerCount?: {
    running: number;
    total: number;
  };
  dockerVersion?: string;
  homeMountWritable: boolean;
  managed: boolean;
  message: string;
  name: string;
  prepared: boolean;
  status: string;
}

export interface RuntimeInstancesSnapshot {
  activeInstanceName: string;
  instances: RuntimeInstanceSummary[];
  selectionLocked: boolean;
}

export interface CreateRuntimeInstanceInput {
  configuration: DockerEngineConfiguration;
  name: string;
}

export type RuntimeInstanceResources = Pick<
  DockerEngineConfiguration,
  "cpus" | "diskGiB" | "memoryGiB"
>;

export interface UpdateRuntimeInstanceInput {
  configuration: RuntimeInstanceResources;
}

export interface DeleteRuntimeInstanceInput {
  confirmation: string;
}

export interface DockerCliIntegrationSnapshot {
  activeContext?: string;
  contextEndpoint?: string;
  contextName: string;
  expectedEndpoint?: string;
  homeMountWritable: boolean;
  message: string;
  ready: boolean;
}

export interface DockerDaemonAddressPool {
  base: string;
  size: number;
}

export type DockerDaemonLogDriver = "json-file" | "local";

export interface DockerDaemonProxyConfiguration {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy: string[];
}

export interface DockerDaemonConfiguration {
  debug: boolean;
  defaultAddressPools: DockerDaemonAddressPool[];
  dns: string[];
  insecureRegistries: string[];
  liveRestore: boolean;
  logDriver: DockerDaemonLogDriver;
  logMaxFile?: number;
  logMaxSize?: string;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  proxies: DockerDaemonProxyConfiguration;
  registryMirrors: string[];
}

export interface DockerDaemonConfigurationSnapshot {
  additionalJson: string;
  available: boolean;
  configuration: DockerDaemonConfiguration;
  message: string;
  path: string;
  source: "default" | "file";
}

export interface UpdateDockerDaemonConfigurationInput {
  additionalJson: string;
  configuration: DockerDaemonConfiguration;
}

export type DockerDaemonConfigurationSection =
  | "advanced"
  | "logging"
  | "network"
  | "proxy"
  | "registry"
  | "stability"
  | "transfer";

export type UpdateDockerDaemonConfigurationSectionInput =
  | {
      additionalJson: string;
      section: "advanced";
    }
  | {
      configuration: Pick<DockerDaemonConfiguration, "logDriver" | "logMaxFile" | "logMaxSize">;
      section: "logging";
    }
  | {
      configuration: Pick<DockerDaemonConfiguration, "defaultAddressPools" | "dns">;
      section: "network";
    }
  | {
      configuration: Pick<DockerDaemonConfiguration, "proxies">;
      section: "proxy";
    }
  | {
      configuration: Pick<DockerDaemonConfiguration, "insecureRegistries" | "registryMirrors">;
      section: "registry";
    }
  | {
      configuration: Pick<DockerDaemonConfiguration, "debug" | "liveRestore">;
      section: "stability";
    }
  | {
      configuration: Pick<
        DockerDaemonConfiguration,
        "maxConcurrentDownloads" | "maxConcurrentUploads"
      >;
      section: "transfer";
    };

export interface RecreateDockerEngineInput {
  configuration: DockerEngineConfiguration;
  confirmation: string;
}

export type StartupPrerequisiteId = "compose" | "docker" | "homebrew" | "lima";
export type StartupStepId = StartupPrerequisiteId | "engine";
export type StartupInstallTarget = StartupPrerequisiteId | "docker-with-compose";

export interface StartupPrerequisite {
  automaticInstall: boolean;
  automaticInstallUnavailableReason?: string;
  description: string;
  id: StartupPrerequisiteId;
  installCommand: string;
  installed: boolean;
  label: string;
  missingReason?: string;
  required: boolean;
  version?: string;
}

export interface StartupSnapshot {
  prerequisites: StartupPrerequisite[];
  ready: boolean;
}

export type ToolUpdateId = Exclude<StartupPrerequisiteId, "homebrew">;

export interface ToolUpdateItem {
  automaticUpdate: boolean;
  automaticUpdateUnavailableReason?: string;
  currentVersion?: string;
  id: ToolUpdateId;
  installed: boolean;
  label: string;
  latestVersion?: string;
  managedByHomebrew: boolean;
  updateAvailable?: boolean;
}

export interface ToolUpdateSnapshot {
  checkedAt?: string;
  items: ToolUpdateItem[];
}

export interface ContainerSummary {
  composeProject?: string;
  composeService?: string;
  id: string;
  image: string;
  name: string;
  ports: string;
  state: string;
  status: string;
}

export type ContainerPullPolicy = "always" | "missing" | "never";
export type ContainerPortProtocol = "tcp" | "udp";
export type ContainerRestartMode = "always" | "no" | "on-failure" | "unless-stopped";

export interface ContainerKeyValue {
  key: string;
  value: string;
}

export interface ContainerPortMapping {
  containerPort: number;
  hostPort?: number;
  protocol: ContainerPortProtocol;
}

export interface ContainerVolumeMount {
  containerPath: string;
  readOnly: boolean;
  volume: string;
}

export type ContainerMount =
  | {
      containerPath: string;
      hostPath: string;
      readOnly: boolean;
      type: "bind";
    }
  | {
      containerPath: string;
      readOnly: boolean;
      type: "volume";
      volume: string;
    }
  | {
      containerPath: string;
      dockerType: string;
      readOnly: boolean;
      source?: string;
      type: "other";
    };

export interface ContainerRestartPolicy {
  maximumRetryCount?: number;
  mode: ContainerRestartMode;
}

export interface ContainerResourceLimits {
  cpus?: number;
  memoryMiB?: number;
}

export interface ContainerSpecInput {
  command: string[];
  environment: ContainerKeyValue[];
  hostname?: string;
  image: string;
  labels: ContainerKeyValue[];
  name?: string;
  networks: string[];
  ports: ContainerPortMapping[];
  pullPolicy: ContainerPullPolicy;
  resources: ContainerResourceLimits;
  restartPolicy: ContainerRestartPolicy;
  volumes: ContainerVolumeMount[];
}

export interface ContainerDetail {
  configHash: string;
  id: string;
  mounts: ContainerMount[];
  replacementBlockers: string[];
  running: boolean;
  spec: ContainerSpecInput;
}

export type ContainerHealthStatus = "healthy" | "starting" | "unhealthy";

export interface ContainerHealthCheck {
  endedAt: string;
  exitCode: number;
  output: string;
  startedAt: string;
}

export interface ContainerHealth {
  failingStreak: number;
  history: ContainerHealthCheck[];
  status: ContainerHealthStatus;
}

export interface ContainerInspection {
  health?: ContainerHealth;
  json: string;
}

export type ContainerShell = "ash" | "bash" | "sh" | "zsh";
export type ContainerTerminalStatus = "not-running" | "paused" | "ready" | "shell-not-found";

export interface ContainerTerminalAccess {
  command?: string;
  shell?: ContainerShell;
  status: ContainerTerminalStatus;
}

export interface UpdateContainerInput {
  expectedConfigHash: string;
  spec: ContainerSpecInput;
}

export interface ComposeProjectSummary {
  builder?: ComposeBuilderSource;
  configFiles: string[];
  name: string;
  remote?: ComposeRemoteSource;
  status: string;
}

export interface ComposeBuilderSource {
  configHash: string;
  mode: ComposeBuilderInput["mode"];
}

export interface ComposeBuilderService {
  command: string[];
  containerName?: string;
  environment: ContainerKeyValue[];
  image: string;
  name: string;
  networks: string[];
  ports: ContainerPortMapping[];
  restartPolicy: ContainerRestartPolicy;
  tag: string;
  volumes: ContainerVolumeMount[];
}

export interface ComposeBuilderSpec {
  name: string;
  networks: string[];
  services: ComposeBuilderService[];
  volumes: string[];
}

export type ComposeBuilderInput =
  | { mode: "form"; spec: ComposeBuilderSpec }
  | { mode: "yaml"; name: string; yaml: string };

export interface ComposeBuilderProjectDetail {
  configHash: string;
  input: ComposeBuilderInput;
  yaml: string;
}

export interface UpdateComposeBuilderInput {
  expectedConfigHash: string;
  input: ComposeBuilderInput;
}

export interface ComposeRemoteSource {
  buildContext: boolean;
  checkError?: string;
  checkedAt: string;
  updateAvailable: boolean;
  url: string;
}

export interface RegisterRemoteComposeInput {
  name?: string;
  url: string;
}

export interface ComposeServiceSummary {
  health: string;
  id: string;
  image: string;
  name: string;
  ports: string;
  service: string;
  state: string;
  status: string;
}

export type ComposeProjectConfiguration =
  | {
      configFiles: string[];
      kind: "discovered";
    }
  | {
      configHash: string;
      kind: "builder";
      yaml: string;
    }
  | {
      checkedAt: string;
      checkError?: string;
      contentHash: string;
      kind: "remote";
      pendingHash?: string;
      pendingYaml?: string;
      url: string;
      yaml: string;
    };

export interface ComposeProjectDetail extends ComposeProjectSummary {
  configuration: ComposeProjectConfiguration;
  services: ComposeServiceSummary[];
}

export type ComposeProjectAction = "down" | "restart" | "stop" | "up";

export interface ImageSummary {
  createdAt: string;
  createdSince: string;
  id: string;
  platform: string;
  repository: string;
  size: string;
  tag: string;
  url: string;
}

export interface ImageDetail {
  architecture: string;
  command: string[];
  comment?: string;
  createdAt: string;
  entrypoint: string[];
  environment: ContainerKeyValue[];
  exposedPorts: string[];
  id: string;
  inspectJson: string;
  labels: ContainerKeyValue[];
  layers: string[];
  operatingSystem: string;
  repositoryDigests: string[];
  repositoryTags: string[];
  sizeBytes: number;
  workingDirectory?: string;
}

export interface ImageHistoryEntry {
  comment?: string;
  createdAt: string;
  createdBy: string;
  createdSince: string;
  id?: string;
  size: string;
}

export interface ImageRepositoryTag {
  lastUpdated: string;
  name: string;
  platforms: string[];
  sizeBytes: number;
}

export interface ImageRepositoryTags {
  count: number;
  page: number;
  pageSize: number;
  repository: string;
  tags: ImageRepositoryTag[];
}

export interface AddImageRepositoryInput {
  repository: string;
}

export interface ImageRepositorySummary {
  createdAt: string;
  id: string;
  lastSyncedAt?: string;
  repository: string;
  tagCount?: number;
}

export interface ImageRepositoryDetail extends ImageRepositorySummary {
  favoriteCount: number;
}

export interface ImageRepositoryTagItem {
  favorite: boolean;
  name: string;
}

export type ImageRepositoryTagSort = "tag" | "-tag";

export interface ImageRepositoryTagQuery {
  filter?: { tag?: string };
  sort?: ImageRepositoryTagSort;
}

export interface ImageRepositoryTagList {
  count: number;
  totalCount: number;
  page: number;
  pageSize: number;
  repository: string;
  tags: ImageRepositoryTagItem[];
}

export interface VolumeSummary {
  driver: string;
  labels: string;
  name: string;
  scope: string;
}

export interface VolumeDetail {
  createdAt?: string;
  driver: string;
  inspectJson: string;
  labels: ContainerKeyValue[];
  mountpoint: string;
  name: string;
  options: ContainerKeyValue[];
  scope: string;
}

export interface NetworkSummary {
  builtIn: boolean;
  createdAt: string;
  driver: string;
  id: string;
  internal: boolean;
  ipv4: boolean;
  ipv6: boolean;
  labels: string;
  name: string;
  scope: string;
}

export interface NetworkIpamConfiguration {
  auxiliaryAddresses: ContainerKeyValue[];
  gateway?: string;
  ipRange?: string;
  subnet?: string;
}

export interface NetworkContainerAttachment {
  endpointId?: string;
  id: string;
  ipv4Address?: string;
  ipv6Address?: string;
  macAddress?: string;
  name: string;
}

export interface NetworkDetail {
  attachable: boolean;
  builtIn: boolean;
  configOnly: boolean;
  containers: NetworkContainerAttachment[];
  createdAt: string;
  driver: string;
  enableIpv4: boolean;
  enableIpv6: boolean;
  id: string;
  ingress: boolean;
  inspectJson: string;
  internal: boolean;
  ipamConfigurations: NetworkIpamConfiguration[];
  ipamDriver: string;
  ipamOptions: ContainerKeyValue[];
  labels: ContainerKeyValue[];
  name: string;
  options: ContainerKeyValue[];
  scope: string;
}

export interface DashboardSnapshot {
  capabilities?: {
    dockerCompose: boolean;
  };
  composeProjects: ComposeProjectSummary[];
  containers: ContainerSummary[];
  images: ImageSummary[];
  networks: NetworkSummary[];
  runtime: RuntimeSnapshot;
  volumes: VolumeSummary[];
}

export interface MenuBarSnapshot {
  composeProjects: ComposeProjectSummary[];
  containers: ContainerSummary[];
  runtime: RuntimeSnapshot;
}

export type MenuBarResponse =
  | { setupRequired: true }
  | (MenuBarSnapshot & { setupRequired: false });

export type RunContainerInput = ContainerSpecInput;

export interface PullImageInput {
  image: string;
}

export interface RemoveImageTagInput {
  id: string;
  reference: string;
}

export interface CreateNamedResourceInput {
  name: string;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
}

export type OperationStatus = "cancelled" | "failed" | "queued" | "running" | "succeeded";

export type OperationKind =
  | "compose.builder.register"
  | "compose.builder.remove"
  | "compose.builder.update"
  | "compose.down"
  | "compose.remote.check"
  | "compose.remote.register"
  | "compose.remote.remove"
  | "compose.remote.update"
  | "compose.restart"
  | "compose.stop"
  | "compose.up"
  | "container.create"
  | "container.remove"
  | "container.restart"
  | "container.start"
  | "container.stop"
  | "container.update"
  | "docker.plugin.install"
  | "docker.plugin.update"
  | "docker.plugin.update.check"
  | "image.pull"
  | "image.remove"
  | "image.tag.remove"
  | "image.repository.sync"
  | "network.create"
  | "network.remove"
  | "runtime.daemon.configure"
  | "runtime.start"
  | "runtime.connect"
  | "runtime.instance.delete"
  | "runtime.instance.force-stop"
  | "runtime.instance.update"
  | "runtime.force-restart"
  | "runtime.recreate"
  | "runtime.restart"
  | "runtime.stop"
  | "startup.install"
  | "startup.update"
  | "startup.update.check"
  | "volume.create"
  | "volume.remove";

export type OperationCategory = "lima" | "docker-cli";

export type OperationResource =
  | "compose"
  | "container"
  | "dockerPlugin"
  | "image"
  | "imageRepository"
  | "network"
  | "runtime"
  | "startup"
  | "volume";

export type DockerCliPluginId = "docker" | "buildx" | "compose" | "lima";

export interface DockerCliPluginSummary {
  automaticUpdate?: boolean;
  description: string;
  executablePath?: string;
  id: DockerCliPluginId;
  installAvailable: boolean;
  installUnavailableReason?: string;
  installed: boolean;
  label: string;
  management: "extensions" | "startup";
  source: "homebrew" | "external" | "unknown";
  latestVersion?: string;
  updateAvailable?: boolean;
  updateUnavailableReason?: string;
  version?: string;
}

export interface DockerCliPluginSnapshot {
  checkedAt?: string;
  inspectionWarning?: string;
  plugins: DockerCliPluginSummary[];
}

export interface OperationTarget {
  id?: string;
  name: string;
  resource: OperationResource;
}

export interface OperationSnapshot {
  createdAt: string;
  error?: ApiFailure["error"];
  finishedAt?: string;
  id: string;
  kind: OperationKind;
  output: string[];
  retriedFromId?: string;
  retryable: boolean;
  startedAt?: string;
  status: OperationStatus;
  step: string;
  successMessage: string;
  target: OperationTarget;
  title: string;
}

export interface OperationAccepted {
  operation: OperationSnapshot;
}

export interface OperationListResponse {
  operations: OperationSnapshot[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
