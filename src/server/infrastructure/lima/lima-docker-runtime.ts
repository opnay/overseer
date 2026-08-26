import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import type {
  ComposeProjectAction,
  ComposeBuilderProjectDetail,
  ComposeBuilderSpec,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ContainerDetail,
  ContainerInspection,
  ContainerSummary,
  ContainerTerminalAccess,
  ContainerShell,
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
  UpdateRuntimeInstanceInput,
  VolumeDetail,
  VolumeSummary,
} from "../../../shared/contracts.ts";
import type { OverseerController } from "../../application/overseer-controller.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import {
  BuilderComposeService,
  ComposeProjectService,
  RemoteComposeService,
  type BuilderComposeRegistry,
  type RemoteComposeRegistry,
} from "../../modules/compose/index.ts";
import { DockerContainerService } from "../../modules/containers/index.ts";
import {
  dockerDaemonJson,
  dockerDaemonSnapshot,
  mergeDockerDaemonConfigurationSection,
} from "../../modules/engine/index.ts";
import {
  MemoryRuntimeInstanceStore,
  type RuntimeInstanceStore,
} from "../../modules/instances/index.ts";
import { DockerImageService } from "../../modules/images/index.ts";
import { DockerNetworkService } from "../../modules/networks/index.ts";
import type { OperationProgress } from "../../modules/operations/index.ts";
import { DockerVolumeService } from "../../modules/volumes/index.ts";
import { CommandError, type CommandRunner, runCommand } from "../process.ts";

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
const READ_DOCKER_DAEMON_CONFIGURATION =
  'target="$HOME/.config/docker/daemon.json"; if [ -f "$target" ]; then printf "file\\n"; cat "$target"; else printf "default\\n{}\\n"; fi';
const WRITE_DOCKER_DAEMON_CONFIGURATION =
  'set -eu; target="$HOME/.config/docker/daemon.json"; temp="$target.overseer.tmp"; mkdir -p "$(dirname "$target")"; trap \'rm -f "$temp"\' EXIT; cat > "$temp"; dockerd --validate --config-file="$temp"; mv "$temp" "$target"; trap - EXIT';
const REMOVE_DOCKER_DAEMON_CONFIGURATION =
  'rm -f "$HOME/.config/docker/daemon.json" "$HOME/.config/docker/daemon.json.overseer.tmp"';

export class LimaDockerRuntime implements OverseerController {
  private readonly builderCompose: BuilderComposeRegistry;
  private readonly command: CommandRunner;
  private readonly composeProjects: ComposeProjectService;
  private readonly containers: DockerContainerService;
  private readonly instanceStore: RuntimeInstanceStore;
  private readonly images: DockerImageService;
  private readonly networks: DockerNetworkService;
  private readonly remoteCompose: RemoteComposeRegistry;
  private readonly volumes: DockerVolumeService;
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
    this.instanceStore = instanceStore;
    this.remoteCompose = remoteCompose ?? new RemoteComposeService(command);
    this.builderCompose = builderCompose ?? new BuilderComposeService(command);
    this.composeProjects = new ComposeProjectService(
      (args, timeoutMs, progress) => this.docker(args, timeoutMs, progress),
      this.remoteCompose,
      this.builderCompose,
    );
    this.containers = new DockerContainerService(
      (args, timeoutMs, progress) => this.docker(args, timeoutMs, progress),
      (id, shell) => this.probeContainerShell(id, shell),
      DOCKER_CONTEXT,
    );
    this.images = new DockerImageService(
      (args, timeoutMs, progress) => this.docker(args, timeoutMs, progress),
      fetcher,
    );
    this.volumes = new DockerVolumeService((args, timeoutMs, progress) =>
      this.docker(args, timeoutMs, progress),
    );
    this.networks = new DockerNetworkService((args, timeoutMs, progress) =>
      this.docker(args, timeoutMs, progress),
    );
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
      instances: summaries.sort((left, right) => left.name.localeCompare(right.name)),
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

  async updateRuntimeInstance(
    name: string,
    input: UpdateRuntimeInstanceInput,
    progress?: OperationProgress,
  ): Promise<void> {
    this.requireRuntimeIdle();
    this.requireManagedInstance(name);
    const instance = await this.requireInstanceDetails(name);
    const current = this.configurationFromInstance(instance);
    if (input.configuration.diskGiB < current.diskGiB) {
      throw new ExpectedError(
        "runtime_disk_shrink_unsupported",
        `디스크는 현재 ${current.diskGiB}GiB보다 작게 줄일 수 없습니다.`,
        409,
      );
    }
    const wasRunning = instance.status.toLowerCase() === "running";
    if (wasRunning) {
      progress?.step("Lima 인스턴스 중지 중");
      await this.command("limactl", ["stop", name], {
        onOutput: progress?.output,
        timeoutMs: 120_000,
      });
    }
    progress?.step("VM 리소스 수정 중");
    await this.command(
      "limactl",
      [
        "edit",
        name,
        `--cpus=${input.configuration.cpus}`,
        `--memory=${input.configuration.memoryGiB}`,
        `--disk=${input.configuration.diskGiB}`,
        "--tty=false",
      ],
      { onOutput: progress?.output, timeoutMs: 120_000 },
    );
    if (wasRunning) {
      progress?.step("Lima 인스턴스 시작 중");
      await this.command("limactl", ["start", name, "--tty=false", "--progress"], {
        onOutput: progress?.output,
        timeoutMs: 10 * 60_000,
      });
      await this.waitForDockerReady(progress, name);
    }
  }

  async deleteRuntimeInstance(name: string, progress?: OperationProgress): Promise<void> {
    this.requireRuntimeIdle();
    this.requireManagedInstance(name);
    if (CONFIGURED_LIMA_INSTANCE === name) {
      throw new ExpectedError(
        "runtime_instance_selection_locked",
        `OVERSEER_LIMA_INSTANCE=${name} 설정을 해제해야 이 인스턴스를 삭제할 수 있습니다.`,
        409,
      );
    }
    const instance = await this.requireInstanceDetails(name);
    if (instance.status.toLowerCase() === "running") {
      progress?.step("Lima 인스턴스 중지 중");
      await this.command("limactl", ["stop", name], {
        onOutput: progress?.output,
        timeoutMs: 120_000,
      });
    }
    progress?.step("Lima 인스턴스 삭제 중");
    await this.command("limactl", ["delete", "--force", name], {
      onOutput: progress?.output,
      timeoutMs: 120_000,
    });
    this.instanceStore.clearActiveInstanceName(name);
    this.instanceStore.unmarkManaged(name);
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
    await this.containers.run(input, progress);
  }

  async updateContainer(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.containers.update(id, input, progress);
  }

  async getContainer(id: string): Promise<ContainerDetail> {
    return this.containers.get(id);
  }

  async getContainerInspection(id: string): Promise<ContainerInspection> {
    return this.containers.inspection(id);
  }

  async getContainerTerminalAccess(id: string): Promise<ContainerTerminalAccess> {
    return this.containers.terminal(id);
  }

  async containerAction(
    id: string,
    action: "restart" | "start" | "stop",
    progress?: OperationProgress,
  ): Promise<void> {
    await this.containers.action(id, action, progress);
  }

  async removeContainer(id: string, progress?: OperationProgress): Promise<void> {
    await this.containers.remove(id, progress);
  }

  async getContainerLogs(id: string): Promise<string> {
    return this.containers.logs(id);
  }

  async getContainers(): Promise<ContainerSummary[]> {
    return this.containers.list();
  }
  async getComposeProjects(): Promise<ComposeProjectSummary[]> {
    return this.composeProjects.list();
  }

  async getComposeProject(name: string): Promise<ComposeProjectDetail> {
    return this.composeProjects.get(name);
  }

  async getBuilderComposeProject(name: string): Promise<ComposeBuilderProjectDetail> {
    return this.composeProjects.getBuilder(name);
  }

  async getComposeProjectLogs(name: string): Promise<string> {
    return this.composeProjects.logs(name);
  }

  async composeProjectAction(
    name: string,
    action: ComposeProjectAction,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.composeProjects.action(name, action, progress);
  }

  async registerRemoteCompose(
    input: RegisterRemoteComposeInput,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.composeProjects.registerRemote(input, progress);
  }

  async registerBuilderCompose(
    spec: ComposeBuilderSpec,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.composeProjects.registerBuilder(spec, progress);
  }

  async updateBuilderCompose(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.composeProjects.updateBuilder(name, input, progress);
  }

  async checkRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.composeProjects.checkRemoteUpdate(name, progress);
  }

  async applyRemoteComposeUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.composeProjects.applyRemoteUpdate(name, progress);
  }

  async removeRemoteCompose(name: string, progress?: OperationProgress): Promise<void> {
    await this.composeProjects.removeRemote(name, progress);
  }

  async removeBuilderCompose(name: string, progress?: OperationProgress): Promise<void> {
    await this.composeProjects.removeBuilder(name, progress);
  }
  async pullImage(input: PullImageInput, progress?: OperationProgress): Promise<void> {
    await this.images.pull(input, progress);
  }

  async removeImage(id: string, progress?: OperationProgress): Promise<void> {
    await this.images.remove(id, progress);
  }

  async getImage(id: string): Promise<ImageDetail> {
    return this.images.get(id);
  }

  async getImageHistory(id: string): Promise<ImageHistoryEntry[]> {
    return this.images.history(id);
  }

  async getImageRepositoryTags(id: string, page: number): Promise<ImageRepositoryTags> {
    return this.images.repositoryTags(id, page);
  }
  async getImages(): Promise<ImageSummary[]> {
    return this.images.list();
  }
  async createVolume(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void> {
    await this.volumes.create(input, progress);
  }

  async removeVolume(name: string, progress?: OperationProgress): Promise<void> {
    await this.volumes.remove(name, progress);
  }

  async getVolumes(): Promise<VolumeSummary[]> {
    return this.volumes.list();
  }

  async getVolume(name: string): Promise<VolumeDetail> {
    return this.volumes.get(name);
  }

  async createNetwork(
    input: CreateNamedResourceInput,
    progress?: OperationProgress,
  ): Promise<void> {
    await this.networks.create(input, progress);
  }

  async removeNetwork(name: string, progress?: OperationProgress): Promise<void> {
    await this.networks.remove(name, progress);
  }

  async getNetworks(): Promise<NetworkSummary[]> {
    return this.networks.list();
  }

  async getNetwork(name: string): Promise<NetworkDetail> {
    return this.networks.get(name);
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

  private requireManagedInstance(name: string): void {
    if (!this.instanceStore.isManaged(name) && name !== DEFAULT_LIMA_INSTANCE) {
      throw new ExpectedError(
        "runtime_instance_external",
        "외부에서 만든 Lima 인스턴스는 Overseer에서 수정하거나 삭제할 수 없습니다.",
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
    let containerCount: RuntimeInstanceSummary["containerCount"];
    if (socketConfigured && instance.status.toLowerCase() === "running") {
      const [versionResult, containersResult] = await Promise.allSettled([
        this.command(
          "docker",
          [
            "--host",
            `unix://${instance.dir}/sock/docker.sock`,
            "version",
            "--format",
            "{{.Server.Version}}",
          ],
          { timeoutMs: 5_000 },
        ),
        this.command(
          "docker",
          [
            "--host",
            `unix://${instance.dir}/sock/docker.sock`,
            "container",
            "ls",
            "--all",
            "--format",
            "{{.State}}",
          ],
          { timeoutMs: 5_000 },
        ),
      ]);
      if (versionResult.status === "fulfilled") {
        dockerVersion = versionResult.value.stdout.trim() || undefined;
      }
      if (containersResult.status === "fulfilled") {
        const states = containersResult.value.stdout
          .split(/\r?\n/)
          .map((state) => state.trim().toLowerCase())
          .filter(Boolean);
        containerCount = {
          running: states.filter((state) => state === "running").length,
          total: states.length,
        };
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
      ...(containerCount ? { containerCount } : {}),
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

  private async probeContainerShell(id: string, shell: ContainerShell): Promise<boolean> {
    try {
      await this.rawDockerForInstance(
        this.instanceName,
        ["container", "exec", id, shell, "-c", "exit 0"],
        2_000,
      );
      return true;
    } catch (error) {
      if (error instanceof CommandError && this.isMissingContainerExecutable(error)) return false;
      if (error instanceof CommandError) {
        throw new ExpectedError("docker_command_failed", this.dockerMessage(error), 503);
      }
      throw error;
    }
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
