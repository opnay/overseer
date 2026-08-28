import type {
  ComposeBuilderProjectDetail,
  ComposeBuilderInput,
  ComposeProjectAction,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ContainerDetail,
  ContainerInspection,
  ContainerSpecInput,
  ContainerSummary,
  ContainerTerminalAccess,
  CreateNamedResourceInput,
  CreateRuntimeInstanceInput,
  DashboardSnapshot,
  DockerDaemonConfigurationSnapshot,
  DockerEngineConfiguration,
  DockerEngineConfigurationSnapshot,
  ImageDetail,
  ImageHistoryEntry,
  ImageRepositoryTags,
  ImageSummary,
  MenuBarSnapshot,
  NetworkDetail,
  NetworkSummary,
  PullImageInput,
  RemoveImageTagInput,
  RegisterRemoteComposeInput,
  RuntimeInstancesSnapshot,
  RuntimeSnapshot,
  UpdateComposeBuilderInput,
  UpdateContainerInput,
  UpdateDockerDaemonConfigurationInput,
  UpdateDockerDaemonConfigurationSectionInput,
  UpdateRuntimeInstanceInput,
  VolumeDetail,
  VolumeSummary,
} from "../../shared/contracts.ts";
import type { OperationProgress } from "../modules/operations/index.ts";

export interface DashboardController {
  getDashboard(): Promise<DashboardSnapshot>;
  getMenuBarSnapshot(): Promise<MenuBarSnapshot>;
}

export interface DockerEngineController {
  applyDockerDaemonConfiguration(
    input: UpdateDockerDaemonConfigurationInput,
    progress?: OperationProgress,
  ): Promise<void>;
  applyDockerDaemonConfigurationSection(
    input: UpdateDockerDaemonConfigurationSectionInput,
    progress?: OperationProgress,
  ): Promise<void>;
  connectDockerCli(progress?: OperationProgress): Promise<void>;
  getDockerDaemonConfiguration(): Promise<DockerDaemonConfigurationSnapshot>;
  getDockerEngineConfiguration(): Promise<DockerEngineConfigurationSnapshot>;
  recreateRuntime(
    configuration: DockerEngineConfiguration,
    progress?: OperationProgress,
  ): Promise<RuntimeSnapshot>;
  restartRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
  startRuntime(
    progress?: OperationProgress,
    configuration?: DockerEngineConfiguration,
  ): Promise<RuntimeSnapshot>;
  stopRuntime(progress?: OperationProgress): Promise<RuntimeSnapshot>;
}

export interface RuntimeInstanceController {
  createRuntimeInstance(
    input: CreateRuntimeInstanceInput,
    progress?: OperationProgress,
  ): Promise<void>;
  deleteRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  getRuntimeInstances(): Promise<RuntimeInstancesSnapshot>;
  prepareRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  selectRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  startRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  stopRuntimeInstance(name: string, progress?: OperationProgress): Promise<void>;
  updateRuntimeInstance(
    name: string,
    input: UpdateRuntimeInstanceInput,
    progress?: OperationProgress,
  ): Promise<void>;
}

export interface ComposeController {
  applyRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void>;
  checkRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void>;
  composeProjectAction(
    name: string,
    action: ComposeProjectAction,
    progress?: OperationProgress,
  ): Promise<void>;
  getBuilderComposeProject(name: string): Promise<ComposeBuilderProjectDetail>;
  getComposeProject(name: string): Promise<ComposeProjectDetail>;
  getComposeProjectLogs(name: string): Promise<string>;
  getComposeProjects(): Promise<ComposeProjectSummary[]>;
  registerBuilderCompose(input: ComposeBuilderInput, progress?: OperationProgress): Promise<void>;
  registerRemoteCompose(
    input: RegisterRemoteComposeInput,
    progress?: OperationProgress,
  ): Promise<void>;
  removeBuilderCompose(name: string, progress?: OperationProgress): Promise<void>;
  removeRemoteCompose(name: string, progress?: OperationProgress): Promise<void>;
  updateBuilderCompose(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<void>;
}

export interface ContainerController {
  containerAction(
    id: string,
    action: "restart" | "start" | "stop",
    progress?: OperationProgress,
  ): Promise<void>;
  getContainer(id: string): Promise<ContainerDetail>;
  getContainerInspection(id: string): Promise<ContainerInspection>;
  getContainerLogs(id: string): Promise<string>;
  getContainers(): Promise<ContainerSummary[]>;
  getContainerTerminalAccess(id: string): Promise<ContainerTerminalAccess>;
  removeContainer(id: string, progress?: OperationProgress): Promise<void>;
  runContainer(input: ContainerSpecInput, progress?: OperationProgress): Promise<void>;
  updateContainer(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void>;
}

export interface ImageController {
  getImage(id: string): Promise<ImageDetail>;
  getImageHistory(id: string): Promise<ImageHistoryEntry[]>;
  getImageRepositoryTags(id: string, page: number): Promise<ImageRepositoryTags>;
  getImages(): Promise<ImageSummary[]>;
  pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void>;
  removeImage(id: string, progress?: OperationProgress): Promise<void>;
  removeImageTag(input: RemoveImageTagInput, progress?: OperationProgress): Promise<void>;
}

export interface VolumeController {
  createVolume(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void>;
  getVolume(name: string): Promise<VolumeDetail>;
  getVolumes(): Promise<VolumeSummary[]>;
  removeVolume(name: string, progress?: OperationProgress): Promise<void>;
}

export interface NetworkController {
  createNetwork(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void>;
  getNetwork(name: string): Promise<NetworkDetail>;
  getNetworks(): Promise<NetworkSummary[]>;
  removeNetwork(name: string, progress?: OperationProgress): Promise<void>;
}

export interface OverseerController
  extends
    ComposeController,
    ContainerController,
    DashboardController,
    DockerEngineController,
    ImageController,
    NetworkController,
    RuntimeInstanceController,
    VolumeController {}

export type RuntimeController = OverseerController;
