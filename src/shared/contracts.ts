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
  providers: DockerEngineConfigurationOption<DockerEngineProvider>[];
  source: "default" | "instance";
  vmTypes: DockerEngineConfigurationOption<LimaVmType>[];
}

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
  replacementBlockers: string[];
  running: boolean;
  spec: ContainerSpecInput;
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

export interface ComposeBuilderProjectDetail {
  configHash: string;
  spec: ComposeBuilderSpec;
  yaml: string;
}

export interface UpdateComposeBuilderInput {
  expectedConfigHash: string;
  spec: ComposeBuilderSpec;
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
  createdSince: string;
  id: string;
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
  labels: ContainerKeyValue[];
  layers: string[];
  operatingSystem: string;
  repositoryDigests: string[];
  repositoryTags: string[];
  sizeBytes: number;
  workingDirectory?: string;
}

export interface VolumeSummary {
  driver: string;
  labels: string;
  name: string;
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

export type RunContainerInput = ContainerSpecInput;

export interface PullImageInput {
  image: string;
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
  | "image.pull"
  | "image.remove"
  | "network.create"
  | "network.remove"
  | "runtime.start"
  | "runtime.recreate"
  | "runtime.stop"
  | "startup.install"
  | "startup.update"
  | "startup.update.check"
  | "volume.create"
  | "volume.remove";

export type OperationResource =
  | "compose"
  | "container"
  | "image"
  | "network"
  | "runtime"
  | "startup"
  | "volume";

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
