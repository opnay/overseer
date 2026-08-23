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

export interface ComposeProjectSummary {
  configFiles: string[];
  name: string;
  status: string;
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

export interface RunContainerInput {
  containerPort?: number;
  image: string;
  name?: string;
}

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
