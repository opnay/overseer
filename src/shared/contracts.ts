export type RuntimePhase = "missing" | "stopped" | "starting" | "running" | "stopping" | "error";

export interface RuntimeSnapshot {
  dockerVersion?: string;
  instance: string;
  message: string;
  phase: RuntimePhase;
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
  configFiles: string[];
  name: string;
  remote?: ComposeRemoteSource;
  status: string;
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

export interface ComposeProjectDetail extends ComposeProjectSummary {
  services: ComposeServiceSummary[];
}

export type ComposeProjectAction = "down" | "restart" | "stop" | "up";

export interface ImageSummary {
  createdSince: string;
  id: string;
  repository: string;
  size: string;
  tag: string;
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
  | "runtime.stop"
  | "volume.create"
  | "volume.remove";

export type OperationResource =
  | "compose"
  | "container"
  | "image"
  | "network"
  | "runtime"
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
