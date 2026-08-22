export type RuntimePhase = "missing" | "stopped" | "starting" | "running" | "stopping" | "error";

export interface RuntimeSnapshot {
  dockerVersion?: string;
  instance: string;
  message: string;
  phase: RuntimePhase;
}

export interface ContainerSummary {
  id: string;
  image: string;
  name: string;
  ports: string;
  state: string;
  status: string;
}

export interface ImageSummary {
  createdSince: string;
  id: string;
  repository: string;
  size: string;
  tag: string;
}

export interface DashboardSnapshot {
  containers: ContainerSummary[];
  images: ImageSummary[];
  runtime: RuntimeSnapshot;
}

export interface RunContainerInput {
  containerPort?: number;
  image: string;
  name?: string;
}

export interface PullImageInput {
  image: string;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
}
