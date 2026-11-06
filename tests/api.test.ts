import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/server/app/api.ts";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import {
  emptyComposeBuilderService,
  emptyComposeBuilderSpec,
} from "../src/shared/compose-builder.ts";
import type { RuntimeController } from "../src/server/application/overseer-controller.ts";
import { ExpectedError } from "../src/server/core/errors.ts";
import { OperationQueue } from "../src/server/modules/operations/index.ts";
import type { DockerCliPluginController } from "../src/server/modules/docker-plugins/index.ts";
import {
  ImageRepositoryService,
  MemoryImageRepositoryStore,
} from "../src/server/modules/image-repositories/index.ts";
import {
  StartupPrerequisiteService,
  type StartupPrerequisiteController,
} from "../src/server/modules/startup/index.ts";
import type {
  DockerCliPluginSnapshot,
  OperationKind,
  OperationListResponse,
  OperationResource,
  StartupSnapshot,
} from "../src/shared/contracts.ts";

function createController(): RuntimeController {
  return {
    applyDockerDaemonConfiguration: vi.fn(async () => undefined),
    applyDockerDaemonConfigurationSection: vi.fn(async () => undefined),
    applyRemoteComposeUpdate: vi.fn(async () => undefined),
    checkRemoteComposeUpdate: vi.fn(async () => undefined),
    connectDockerCli: vi.fn(async () => undefined),
    composeProjectAction: vi.fn(async () => undefined),
    containerAction: vi.fn(async () => undefined),
    createNetwork: vi.fn(async () => undefined),
    createRuntimeInstance: vi.fn(async () => undefined),
    deleteRuntimeInstance: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => undefined),
    getBuilderComposeProject: vi.fn(async (name) => ({
      configHash: "a".repeat(64),
      input: { mode: "form" as const, spec: { name, networks: [], services: [], volumes: [] } },
      yaml: "services: {}\n",
    })),
    getContainer: vi.fn(async (id) => ({
      configHash: "a".repeat(64),
      id,
      mounts: [],
      replacementBlockers: [],
      running: true,
      spec: { ...emptyContainerSpec(), image: "nginx:alpine", name: "web" },
    })),
    getContainerInspection: vi.fn(async () => ({
      health: {
        failingStreak: 0,
        history: [],
        status: "healthy" as const,
      },
      json: '{\n  "Id": "container-id"\n}',
    })),
    getContainers: vi.fn(async () => []),
    getComposeProject: vi.fn(async (name) => ({
      configFiles: ["/workspace/compose.yaml"],
      configuration: { configFiles: ["/workspace/compose.yaml"], kind: "discovered" as const },
      name,
      services: [],
      status: "running(1)",
    })),
    getComposeProjectLogs: vi.fn(async () => "compose logs"),
    getComposeProjects: vi.fn(async () => []),
    getContainerLogs: vi.fn(async () => "hello"),
    getContainerTerminalAccess: vi.fn(async () => ({
      command: "docker --context overseer exec -it container-id sh",
      shell: "sh" as const,
      status: "ready" as const,
    })),
    getDashboard: vi.fn(async () => ({
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing" as const,
      },
      volumes: [],
    })),
    getDockerDaemonConfiguration: vi.fn(async () => ({
      additionalJson: '{\n  "features": {\n    "containerd-snapshotter": true\n  }\n}\n',
      available: true,
      configuration: {
        debug: false,
        defaultAddressPools: [],
        dns: [],
        insecureRegistries: [],
        liveRestore: false,
        logDriver: "json-file" as const,
        maxConcurrentDownloads: 3,
        maxConcurrentUploads: 5,
        proxies: { noProxy: [] },
        registryMirrors: [],
      },
      message: "저장하면 Docker Engine만 다시 시작합니다.",
      path: "~/.config/docker/daemon.json",
      source: "file" as const,
    })),
    getDockerEngineConfiguration: vi.fn(async () => ({
      configuration: {
        cpus: 4,
        diskGiB: 100,
        memoryGiB: 4,
        provider: "lima" as const,
        vmType: "vz" as const,
      },
      dockerCli: {
        contextName: "overseer",
        homeMountWritable: false,
        message: "Docker Engine을 먼저 만드십시오.",
        ready: false,
      },
      providers: [{ available: true, label: "Lima VM", value: "lima" as const }],
      source: "default" as const,
      vmTypes: [
        { available: true, label: "Apple Virtualization (VZ)", value: "vz" as const },
        { available: false, label: "QEMU", value: "qemu" as const },
      ],
    })),
    getImage: vi.fn(async (id) => ({
      architecture: "arm64",
      command: ["node", "server.js"],
      createdAt: "2026-08-22T09:22:08.000Z",
      entrypoint: ["/usr/bin/dumb-init", "--"],
      environment: [{ key: "NODE_ENV", value: "production" }],
      exposedPorts: ["3001/tcp"],
      id,
      inspectJson: '{"Id":"image-id"}',
      labels: [{ key: "org.opencontainers.image.source", value: "https://example.com/source" }],
      layers: ["sha256:layer"],
      operatingSystem: "linux",
      repositoryDigests: ["example/image@sha256:digest"],
      repositoryTags: ["example/image:latest"],
      sizeBytes: 1_000,
      workingDirectory: "/app",
    })),
    getImageHistory: vi.fn(async () => [
      {
        createdAt: "2026-08-22T09:22:08.000Z",
        createdBy: 'CMD ["node" "server.js"]',
        createdSince: "2 days ago",
        id: "sha256:layer",
        size: "0B",
      },
    ]),
    getImageRepositoryTags: vi.fn(async (_id, page) => ({
      count: 1,
      page,
      pageSize: 25,
      repository: "example/image",
      tags: [
        {
          lastUpdated: "2026-08-24T02:32:04.000Z",
          name: "latest",
          platforms: ["linux/amd64", "linux/arm64"],
          sizeBytes: 601_000_000,
        },
      ],
    })),
    getImages: vi.fn(async () => []),
    getMenuBarSnapshot: vi.fn(async () => ({
      composeProjects: [],
      containers: [],
      runtime: {
        instance: "overseer",
        message: "정상 실행 중",
        phase: "running" as const,
      },
    })),
    getNetwork: vi.fn(async (name) => ({
      attachable: false,
      builtIn: name === "bridge",
      configOnly: false,
      containers: [],
      createdAt: "2026-08-24T10:00:00.000Z",
      driver: "bridge",
      enableIpv4: true,
      enableIpv6: false,
      id: "network-id",
      ingress: false,
      inspectJson: '{"Name":"bridge"}',
      internal: false,
      ipamConfigurations: [],
      ipamDriver: "default",
      ipamOptions: [],
      labels: [],
      name,
      options: [],
      scope: "local",
    })),
    getNetworks: vi.fn(async () => []),
    getRuntimeInstances: vi.fn(async () => ({
      activeInstanceName: "overseer",
      instances: [],
      selectionLocked: false,
    })),
    getVolumes: vi.fn(async () => []),
    getVolume: vi.fn(async (name) => ({
      createdAt: "2026-08-24T10:00:00.000Z",
      driver: "local",
      inspectJson: '{"Name":"app-data"}',
      labels: [],
      mountpoint: "/var/lib/docker/volumes/app-data/_data",
      name,
      options: [],
      scope: "local",
    })),
    forceRestartRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    forceStopRuntimeInstance: vi.fn(async () => undefined),
    pullImage: vi.fn(async () => undefined),
    prepareRuntimeInstance: vi.fn(async () => undefined),
    registerBuilderCompose: vi.fn(async () => undefined),
    registerRemoteCompose: vi.fn(async () => undefined),
    recreateRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    restartRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    removeBuilderCompose: vi.fn(async () => undefined),
    removeContainer: vi.fn(async () => undefined),
    removeImage: vi.fn(async () => undefined),
    removeImageTag: vi.fn(async () => undefined),
    removeNetwork: vi.fn(async () => undefined),
    removeRemoteCompose: vi.fn(async () => undefined),
    removeVolume: vi.fn(async () => undefined),
    runContainer: vi.fn(async () => undefined),
    selectRuntimeInstance: vi.fn(async () => undefined),
    startRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    startRuntimeInstance: vi.fn(async () => undefined),
    stopRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "중지됨",
      phase: "stopped" as const,
    })),
    stopRuntimeInstance: vi.fn(async () => undefined),
    updateContainer: vi.fn(async () => undefined),
    updateBuilderCompose: vi.fn(async () => undefined),
    updateRuntimeInstance: vi.fn(async () => undefined),
  };
}

const localHeaders = { host: "overseer.localhost:1355", origin: "http://overseer.localhost:1355" };
const dockerEngineConfiguration = {
  cpus: 4,
  diskGiB: 100,
  memoryGiB: 4,
  provider: "lima" as const,
  vmType: "vz" as const,
};
const dockerDaemonConfiguration = {
  debug: false,
  defaultAddressPools: [{ base: "172.30.0.0/16", size: 24 }],
  dns: ["1.1.1.1"],
  insecureRegistries: [],
  liveRestore: true,
  logDriver: "local" as const,
  logMaxFile: 3,
  logMaxSize: "10m",
  maxConcurrentDownloads: 3,
  maxConcurrentUploads: 5,
  proxies: { noProxy: ["localhost"] },
  registryMirrors: ["https://mirror.gcr.io/"],
};

describe("API boundary", () => {
  it("returns the dashboard to a local request", async () => {
    const app = createApi(createController());
    const response = await app.request("/dashboard", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runtime: { phase: "missing" } });
  });

  it("returns the lightweight menu bar snapshot", async () => {
    const controller = createController();
    const startup = new StartupPrerequisiteService();
    vi.spyOn(startup, "getSnapshot").mockResolvedValue({ prerequisites: [], ready: true });
    const app = createApi(controller, undefined, startup);
    const response = await app.request("/menu-bar", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runtime: { phase: "running" },
      setupRequired: false,
    });
    expect(controller.getMenuBarSnapshot).toHaveBeenCalledOnce();
    expect(controller.getDashboard).not.toHaveBeenCalled();
  });

  it("keeps the menu in setup mode without probing an unavailable runtime", async () => {
    const controller = createController();
    const startup = new StartupPrerequisiteService();
    vi.spyOn(startup, "getSnapshot").mockResolvedValue({ prerequisites: [], ready: false });
    const app = createApi(controller, undefined, startup);

    const response = await app.request("/menu-bar", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ setupRequired: true });
    expect(controller.getMenuBarSnapshot).not.toHaveBeenCalled();
  });

  it.each(["missing", "stopped", "starting", "running", "error"] as const)(
    "distinguishes engine setup from the %s runtime state",
    async (phase) => {
      const controller = createController();
      vi.mocked(controller.getMenuBarSnapshot).mockResolvedValue({
        composeProjects: [],
        containers: [],
        runtime: { instance: "overseer", message: "상태", phase },
      });
      const startup = new StartupPrerequisiteService();
      vi.spyOn(startup, "getSnapshot").mockResolvedValue({ prerequisites: [], ready: true });
      const app = createApi(controller, undefined, startup);

      const response = await app.request("/menu-bar", { headers: localHeaders });

      await expect(response.json()).resolves.toMatchObject({
        setupRequired: phase === "missing" || phase === "error",
      });
    },
  );

  it("reports prerequisites and enqueues supported automatic installs", async () => {
    const startup: StartupPrerequisiteController = {
      checkUpdates: vi.fn(async () => undefined),
      getSnapshot: vi.fn(async (): Promise<StartupSnapshot> => ({
        prerequisites: [
          {
            automaticInstall: false,
            description: "패키지 관리자",
            id: "homebrew",
            installCommand: "install brew",
            installed: true,
            label: "Homebrew",
            required: true,
          },
          {
            automaticInstall: true,
            description: "Docker 도구",
            id: "docker",
            installCommand: "brew install docker",
            installed: false,
            label: "Docker CLI",
            required: true,
          },
          {
            automaticInstall: false,
            description: "Compose 도구",
            id: "compose",
            installCommand: "brew install docker-compose",
            installed: false,
            label: "Docker Compose",
            required: false,
          },
          {
            automaticInstall: true,
            description: "VM 도구",
            id: "lima",
            installCommand: "brew install lima",
            installed: false,
            label: "Lima",
            required: true,
          },
        ],
        ready: false,
      })),
      getUpdates: vi.fn(async () => ({ items: [] })),
      install: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    };
    const app = createApi(createController(), new OperationQueue(), startup);

    const status = await app.request("/startup", { headers: localHeaders });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ ready: false });

    const install = await app.request("/startup/prerequisites/docker-with-compose/install", {
      headers: localHeaders,
      method: "POST",
    });
    expect(install.status).toBe(202);
    await vi.waitFor(() =>
      expect(startup.install).toHaveBeenCalledWith("docker-with-compose", expect.any(Object)),
    );

    const updates = await app.request("/startup/updates", { headers: localHeaders });
    expect(updates.status).toBe(200);
    const check = await app.request("/startup/updates/check", {
      headers: localHeaders,
      method: "POST",
    });
    const update = await app.request("/startup/prerequisites/docker/update", {
      headers: localHeaders,
      method: "POST",
    });
    expect([check.status, update.status]).toEqual([202, 202]);
    await vi.waitFor(() => expect(startup.checkUpdates).toHaveBeenCalledWith(expect.any(Object)));
    await vi.waitFor(() =>
      expect(startup.update).toHaveBeenCalledWith("docker", expect.any(Object)),
    );
  });

  it("reports Docker CLI plugins and enqueues Buildx installation", async () => {
    const plugins: DockerCliPluginController = {
      checkUpdates: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      getSnapshot: vi.fn(async (): Promise<DockerCliPluginSnapshot> => ({
        plugins: [
          {
            description: "BuildKit 기반 빌드",
            id: "buildx",
            installAvailable: true,
            installed: false,
            label: "Docker Buildx",
            management: "extensions",
            source: "homebrew",
          },
          {
            description: "macOS에서 단일 overseer VM과 Docker Engine을 실행합니다.",
            id: "lima",
            installAvailable: false,
            installed: true,
            label: "Lima",
            management: "startup",
            source: "homebrew",
            version: "1.0.0",
          },
        ],
      })),
      install: vi.fn(async () => undefined),
    };
    const app = createApi(createController(), new OperationQueue(), undefined, undefined, plugins);

    const snapshot = await app.request("/docker-cli/plugins", { headers: localHeaders });
    expect(snapshot.status).toBe(200);
    await expect(snapshot.json()).resolves.toMatchObject({
      plugins: [{ id: "buildx" }, { id: "lima", management: "startup", version: "1.0.0" }],
    });

    const install = await app.request("/docker-cli/plugins/buildx/install", {
      headers: localHeaders,
      method: "POST",
    });
    expect(install.status).toBe(202);
    await vi.waitFor(() =>
      expect(plugins.install).toHaveBeenCalledWith("buildx", expect.any(Object)),
    );

    const unsupported = await app.request("/docker-cli/plugins/compose/install", {
      headers: localHeaders,
      method: "POST",
    });
    expect(unsupported.status).toBe(400);

    const check = await app.request("/docker-cli/plugins/updates/check", {
      headers: localHeaders,
      method: "POST",
    });
    expect(check.status).toBe(202);
    expect((await check.json()).operation).toMatchObject({
      kind: "docker.plugin.update.check",
      target: { resource: "dockerPlugin" },
    });
    await vi.waitFor(() => expect(plugins.checkUpdates).toHaveBeenCalledWith(expect.any(Object)));

    const update = await app.request("/docker-cli/plugins/compose/update", {
      headers: localHeaders,
      method: "POST",
    });
    expect(update.status).toBe(202);
    await vi.waitFor(() =>
      expect(plugins.update).toHaveBeenCalledWith("compose", expect.any(Object)),
    );
    const limaUpdate = await app.request("/docker-cli/plugins/lima/update", {
      headers: localHeaders,
      method: "POST",
    });
    expect(limaUpdate.status).toBe(202);
    expect((await limaUpdate.json()).operation).toMatchObject({
      kind: "docker.plugin.update",
      target: { id: "lima", name: "Lima", resource: "dockerPlugin" },
    });
    await vi.waitFor(() => expect(plugins.update).toHaveBeenCalledWith("lima", expect.any(Object)));

    const invalidUpdate = await app.request("/docker-cli/plugins/unknown/update", {
      headers: localHeaders,
      method: "POST",
    });
    expect(invalidUpdate.status).toBe(400);
  });

  it("does not enqueue automatic Homebrew installation", async () => {
    const startup: StartupPrerequisiteController = {
      checkUpdates: vi.fn(async () => undefined),
      getSnapshot: vi.fn(async (): Promise<StartupSnapshot> => ({
        prerequisites: [
          {
            automaticInstall: false,
            automaticInstallUnavailableReason: "터미널에서 설치하십시오.",
            description: "패키지 관리자",
            id: "homebrew",
            installCommand: "install brew",
            installed: false,
            label: "Homebrew",
            required: true,
          },
        ],
        ready: false,
      })),
      getUpdates: vi.fn(async () => ({ items: [] })),
      install: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    };
    const app = createApi(createController(), new OperationQueue(), startup);

    const response = await app.request("/startup/prerequisites/homebrew/install", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(startup.install).not.toHaveBeenCalled();

    const unsupportedUpdate = await app.request("/startup/prerequisites/homebrew/update", {
      headers: localHeaders,
      method: "POST",
    });
    expect(unsupportedUpdate.status).toBe(400);
    expect(startup.update).not.toHaveBeenCalled();
  });

  it("returns Docker Engine configuration and capabilities", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/configuration", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configuration: dockerEngineConfiguration,
      source: "default",
      vmTypes: [{ value: "vz" }, { available: false, value: "qemu" }],
    });
  });

  it("returns discovered Lima instances and the active selection", async () => {
    const controller = createController();
    vi.mocked(controller.getRuntimeInstances).mockResolvedValueOnce({
      activeInstanceName: "dev",
      instances: [],
      selectionLocked: false,
    });
    const app = createApi(controller);
    const response = await app.request("/runtime/instances", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activeInstanceName: "dev",
      instances: [],
      selectionLocked: false,
    });
  });

  it("filters and paginates operation history query parameters", async () => {
    const operations = new OperationQueue(30);
    for (let index = 0; index < 25; index += 1) {
      operations.enqueue({
        kind: "container.start",
        locks: [`container:worker-${index}`],
        run: async () => undefined,
        successMessage: "완료",
        target: { name: `worker-${index}`, resource: "container" },
        title: index % 2 === 0 ? "컨테이너 시작" : "컨테이너 중지",
      });
    }
    await vi.waitFor(() =>
      expect(operations.list().filter(({ status }) => status === "succeeded")).toHaveLength(25),
    );
    const app = createApi(createController(), operations);

    const secondPage = await app.request("/operations?page=2&pageSize=10", {
      headers: localHeaders,
    });
    expect(secondPage.status).toBe(200);
    await expect(secondPage.json()).resolves.toMatchObject({
      operations: expect.arrayContaining([expect.objectContaining({ status: "succeeded" })]),
      pagination: { page: 2, pageSize: 10, total: 25, totalPages: 3 },
    });

    const filtered = await app.request(
      "/operations?page=1&pageSize=10&query=worker-24&resource=container&status=succeeded",
      { headers: localHeaders },
    );
    await expect(filtered.json()).resolves.toMatchObject({
      operations: [{ target: { name: "worker-24" } }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    });

    const invalidStatus = await app.request("/operations?status=unknown", {
      headers: localHeaders,
    });
    const oversizedPage = await app.request("/operations?pageSize=101", {
      headers: localHeaders,
    });
    expect([invalidStatus.status, oversizedPage.status]).toEqual([400, 400]);
  });

  it("classifies operation kinds before filtering and paginating without losing other history", async () => {
    const entries: Array<[OperationKind, OperationResource]> = [
      ["runtime.start", "runtime"],
      ["runtime.instance.update", "runtime"],
      ["runtime.stop", "runtime"],
      ["runtime.recreate", "runtime"],
      ["runtime.connect", "runtime"],
      ["runtime.daemon.configure", "runtime"],
      ["compose.up", "compose"],
      ["compose.builder.register", "compose"],
      ["compose.remote.check", "compose"],
      ["container.start", "container"],
      ["image.pull", "image"],
      ["volume.create", "volume"],
      ["network.create", "network"],
      ["docker.plugin.install", "dockerPlugin"],
      ["image.repository.sync", "imageRepository"],
      ["startup.update", "startup"],
    ];
    const queue = new OperationQueue(30);
    for (const [kind, resource] of entries) {
      queue.enqueue({
        kind,
        locks: [],
        run: async () => undefined,
        successMessage: "완료",
        target: { name: kind, resource },
        title: kind,
      });
    }
    await vi.waitFor(() =>
      expect(queue.list().filter(({ status }) => status === "succeeded")).toHaveLength(16),
    );
    const app = createApi(createController(), queue);
    const history = async (search = "") => {
      const response = await app.request(`/operations${search}`, { headers: localHeaders });
      expect(response.status).toBe(200);
      return (await response.json()) as OperationListResponse;
    };

    expect((await history()).pagination.total).toBe(16);
    const lima = await history("?category=lima&page=2&pageSize=2");
    expect(lima.pagination).toEqual({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect(lima.operations).toHaveLength(2);
    for (const operation of lima.operations) {
      expect([
        "runtime.start",
        "runtime.instance.update",
        "runtime.stop",
        "runtime.recreate",
      ]).toContain(operation.kind);
    }
    const docker = await history("?category=docker-cli");
    expect(docker.pagination.total).toBe(6);
    expect(docker.operations.map(({ kind }) => kind).sort()).toEqual([
      "compose.up",
      "container.start",
      "image.pull",
      "network.create",
      "runtime.connect",
      "volume.create",
    ]);
    const connection = await history(
      "?category=docker-cli&resource=runtime&status=succeeded&query=connect",
    );
    expect(connection.pagination.total).toBe(1);
    expect(connection.operations[0]?.kind).toBe("runtime.connect");
    expect((await history("?category=lima&resource=image")).pagination.total).toBe(0);
    expect((await history("?resource=imageRepository")).operations[0]?.kind).toBe(
      "image.repository.sync",
    );
    const invalid = await app.request("/operations?category=unknown", { headers: localHeaders });
    expect(invalid.status).toBe(400);
    expect(queue.list()).toHaveLength(16);
  });

  it("validates and creates a named Lima instance without retry", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = { configuration: dockerEngineConfiguration, name: "dev-engine" };
    const response = await app.request("/runtime/instances", {
      body: JSON.stringify(input),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.createRuntimeInstance).toHaveBeenCalledWith(input, expect.any(Object)),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as {
        operations: Array<{ retryable: boolean; target: { name: string } }>;
      };
      expect(body.operations[0]).toMatchObject({
        retryable: false,
        target: { name: "dev-engine" },
      });
    });
  });

  it("validates and updates a Lima instance without retry", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = { configuration: { cpus: 6, diskGiB: 120, memoryGiB: 8 } };
    const response = await app.request("/runtime/instances/dev", {
      body: JSON.stringify(input),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.updateRuntimeInstance).toHaveBeenCalledWith(
        "dev",
        input,
        expect.any(Object),
      ),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as { operations: Array<{ retryable: boolean }> };
      expect(body.operations[0]?.retryable).toBe(false);
    });
  });

  it("rejects invalid Lima instance resources before enqueueing", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/instances/dev", {
      body: JSON.stringify({ configuration: { cpus: 4, diskGiB: 9, memoryGiB: 4 } }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(400);
    expect(controller.updateRuntimeInstance).not.toHaveBeenCalled();
  });

  it("requires the instance name before deleting without retry", async () => {
    const controller = createController();
    const app = createApi(controller);
    const rejected = await app.request("/runtime/instances/dev", {
      body: JSON.stringify({ confirmation: "wrong" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "DELETE",
    });

    expect(rejected.status).toBe(400);
    expect(controller.deleteRuntimeInstance).not.toHaveBeenCalled();

    const accepted = await app.request("/runtime/instances/dev", {
      body: JSON.stringify({ confirmation: "dev" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "DELETE",
    });
    expect(accepted.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.deleteRuntimeInstance).toHaveBeenCalledWith("dev", expect.any(Object)),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as { operations: Array<{ retryable: boolean }> };
      expect(body.operations[0]?.retryable).toBe(false);
    });
  });

  it("rejects an invalid Lima instance name before enqueueing", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/instances", {
      body: JSON.stringify({ configuration: dockerEngineConfiguration, name: "Invalid Name" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(controller.createRuntimeInstance).not.toHaveBeenCalled();
  });

  it("selects a Lima instance through an exclusive operation", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/instances/dev/select", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.selectRuntimeInstance).toHaveBeenCalledWith("dev", expect.any(Object)),
    );
  });

  it("returns the rootless Docker daemon configuration", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/engine/configuration", {
      headers: localHeaders,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      configuration: { logDriver: "json-file" },
      path: "~/.config/docker/daemon.json",
      source: "file",
    });
  });

  it("validates and applies Docker daemon settings without a retry body", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = {
      additionalJson: '{"features":{"containerd-snapshotter":true}}',
      configuration: dockerDaemonConfiguration,
    };
    const response = await app.request("/runtime/engine/configuration", {
      body: JSON.stringify(input),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.applyDockerDaemonConfiguration).toHaveBeenCalledWith(
        input,
        expect.any(Object),
      ),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as {
        operations: Array<{ kind: string; retryable: boolean }>;
      };
      expect(body.operations[0]).toMatchObject({
        kind: "runtime.daemon.configure",
        retryable: false,
      });
    });
  });

  it("rejects invalid Docker daemon settings before enqueueing", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/engine/configuration", {
      body: JSON.stringify({
        additionalJson: "{}",
        configuration: { ...dockerDaemonConfiguration, dns: ["not-an-ip"] },
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(400);
    expect(controller.applyDockerDaemonConfiguration).not.toHaveBeenCalled();
  });

  it("validates and applies one Docker daemon section without a retry body", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = {
      configuration: {
        defaultAddressPools: [{ base: "172.31.0.0/16", size: 24 }],
        dns: ["8.8.8.8"],
      },
      section: "network" as const,
    };
    const response = await app.request("/runtime/engine/configuration/network", {
      body: JSON.stringify({ configuration: input.configuration }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.applyDockerDaemonConfigurationSection).toHaveBeenCalledWith(
        input,
        expect.any(Object),
      ),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as {
        operations: Array<{ retryable: boolean; title: string }>;
      };
      expect(body.operations[0]).toMatchObject({
        retryable: false,
        title: "네트워크 설정 적용",
      });
    });
  });

  it("rejects an unsupported Docker daemon section", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/engine/configuration/unknown", {
      body: JSON.stringify({ configuration: {} }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(400);
    expect(controller.applyDockerDaemonConfigurationSection).not.toHaveBeenCalled();
  });

  it("rejects keys owned by another Docker daemon section", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/engine/configuration/network", {
      body: JSON.stringify({
        configuration: { debug: true, defaultAddressPools: [], dns: [] },
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(400);
    expect(controller.applyDockerDaemonConfigurationSection).not.toHaveBeenCalled();
  });

  it("connects the macOS Docker CLI through an exclusive async operation", async () => {
    const controller = createController();
    const app = createApi(controller);

    const response = await app.request("/runtime/cli/connect", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.connectDockerCli).toHaveBeenCalledWith(expect.any(Object)),
    );
  });

  it("validates and forwards Docker Engine creation settings", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/start", {
      body: JSON.stringify({ configuration: dockerEngineConfiguration }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(controller.startRuntime).toHaveBeenCalled());
    expect(controller.startRuntime).toHaveBeenCalledWith(
      expect.any(Object),
      dockerEngineConfiguration,
    );
  });

  it("rejects invalid Docker Engine settings before enqueueing", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/start", {
      body: JSON.stringify({
        configuration: { ...dockerEngineConfiguration, diskGiB: 9 },
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(controller.startRuntime).not.toHaveBeenCalled();
  });

  it("requires the exact instance name before recreating", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/recreate", {
      body: JSON.stringify({
        configuration: dockerEngineConfiguration,
        confirmation: "wrong",
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(controller.recreateRuntime).not.toHaveBeenCalled();
  });

  it("enqueues recreation without an automatic retry contract", async () => {
    const controller = createController();
    vi.mocked(controller.recreateRuntime).mockRejectedValueOnce(new Error("create failed"));
    const app = createApi(controller);
    const response = await app.request("/runtime/recreate", {
      body: JSON.stringify({
        configuration: dockerEngineConfiguration,
        confirmation: "overseer",
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(controller.recreateRuntime).toHaveBeenCalled());
    expect(controller.recreateRuntime).toHaveBeenCalledWith(
      dockerEngineConfiguration,
      expect.any(Object),
    );
    await vi.waitFor(async () => {
      const operations = await app.request("/operations", { headers: localHeaders });
      const body = (await operations.json()) as { operations: Array<{ retryable: boolean }> };
      expect(body.operations[0]?.retryable).toBe(false);
    });
  });

  it("restarts the active Docker Engine through one exclusive operation", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/restart", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.restartRuntime).toHaveBeenCalledWith(expect.any(Object)),
    );
  });

  it("force restarts the active Docker Engine through one exclusive operation", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/force-restart", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.forceRestartRuntime).toHaveBeenCalledWith(expect.any(Object)),
    );
  });

  it("force stops a named Lima instance through one exclusive operation", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/runtime/instances/overseer-docker/force-stop", {
      headers: localHeaders,
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() =>
      expect(controller.forceStopRuntimeInstance).toHaveBeenCalledWith(
        "overseer-docker",
        expect.any(Object),
      ),
    );
  });

  it("rejects a non-local Host header", async () => {
    const app = createApi(createController());
    const response = await app.request("/dashboard", { headers: { host: "overseer.example.com" } });

    expect(response.status).toBe(403);
  });

  it("validates and forwards a typed run request", async () => {
    const controller = createController();
    const app = createApi(controller);
    const spec = {
      ...emptyContainerSpec(),
      image: "nginx:alpine",
      name: "web",
      ports: [{ containerPort: 80, protocol: "tcp" as const }],
    };
    const response = await app.request("/containers", {
      body: JSON.stringify(spec),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(controller.runContainer).toHaveBeenCalled());
    expect(controller.runContainer).toHaveBeenCalledWith(spec, expect.any(Object));
  });

  it("rejects command injection input before the runtime", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/containers", {
      body: JSON.stringify({ ...emptyContainerSpec(), image: "nginx; whoami" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(controller.runContainer).not.toHaveBeenCalled();
  });

  it("rejects wrong container spec value types instead of dropping them", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/containers", {
      body: JSON.stringify({
        ...emptyContainerSpec(),
        image: "nginx:alpine",
        resources: { cpus: "0.5" },
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(controller.runContainer).not.toHaveBeenCalled();
  });

  it("rejects cross-site state changes", async () => {
    const app = createApi(createController());
    const response = await app.request("/runtime/start", {
      headers: { host: "overseer.localhost:1355", origin: "https://attacker.example" },
      method: "POST",
    });

    expect(response.status).toBe(403);
  });

  it("validates and creates named Docker resources", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/volumes", {
      body: JSON.stringify({ name: "app-data" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(controller.createVolume).toHaveBeenCalled());
    expect(controller.createVolume).toHaveBeenCalledWith({ name: "app-data" }, expect.any(Object));
  });

  it("returns image inspection details for a validated image identifier", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/images/3e24e96c89ef", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      image: {
        id: "3e24e96c89ef",
        inspectJson: expect.stringContaining("image-id"),
        operatingSystem: "linux",
      },
    });
    expect(controller.getImage).toHaveBeenCalledWith("3e24e96c89ef");

    const history = await app.request("/images/3e24e96c89ef/history", {
      headers: localHeaders,
    });
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      history: [{ createdBy: 'CMD ["node" "server.js"]' }],
    });
    expect(controller.getImageHistory).toHaveBeenCalledWith("3e24e96c89ef");

    const tags = await app.request("/images/3e24e96c89ef/tags?page=2", {
      headers: localHeaders,
    });
    expect(tags.status).toBe(200);
    await expect(tags.json()).resolves.toMatchObject({ tags: { page: 2 } });
    expect(controller.getImageRepositoryTags).toHaveBeenCalledWith("3e24e96c89ef", 2);

    const invalid = await app.request("/images/not-an-image", { headers: localHeaders });
    expect(invalid.status).toBe(400);
    expect(controller.getImage).toHaveBeenCalledTimes(1);
    const invalidPage = await app.request("/images/3e24e96c89ef/tags?page=0", {
      headers: localHeaders,
    });
    expect(invalidPage.status).toBe(400);
  });

  it("separates image tag removal from full image deletion", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = {
      id: "3e24e96c89ef",
      reference: "docker.io/louislam/uptime-kuma:2.5.3",
    };

    const removeTag = await app.request("/images/tags/remove", {
      body: JSON.stringify(input),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    const removeImage = await app.request(`/images/${input.id}`, {
      headers: localHeaders,
      method: "DELETE",
    });

    expect([removeTag.status, removeImage.status]).toEqual([202, 202]);
    await vi.waitFor(() => expect(controller.removeImageTag).toHaveBeenCalled());
    await vi.waitFor(() => expect(controller.removeImage).toHaveBeenCalled());
    expect(controller.removeImageTag).toHaveBeenCalledWith(input, expect.any(Object));
    expect(controller.removeImage).toHaveBeenCalledWith(input.id, expect.any(Object));
  });

  it("manages and synchronizes image repository registrations", async () => {
    const controller = createController();
    const repositories = new ImageRepositoryService(
      new MemoryImageRepositoryStore(),
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const names = ["latest", "v1", "v2"];
        if (init?.method === "HEAD") {
          const name = new URL(String(input)).pathname.split("/").at(-1)!;
          return new Response(null, {
            headers: {
              "docker-content-digest": `sha256:${String(names.indexOf(name) + 1).repeat(64)}`,
            },
          });
        }
        return new Response(JSON.stringify({ tags: names }));
      }),
      () => "2026-08-27T01:00:00.000Z",
      () => "11111111-1111-4111-8111-111111111111",
    );
    const app = createApi(controller, undefined, undefined, repositories);

    const added = await app.request("/image-repositories", {
      body: JSON.stringify({ repository: "nginx" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(added.status).toBe(201);
    await expect(added.json()).resolves.toMatchObject({
      repository: { repository: "docker.io/library/nginx" },
    });
    const duplicate = await app.request("/image-repositories", {
      body: JSON.stringify({ repository: "docker.io/library/nginx" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(duplicate.status).toBe(409);
    const invalid = await app.request("/image-repositories", {
      body: JSON.stringify({ repository: "nginx:latest" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);

    const detail = await app.request("/image-repositories/11111111-1111-4111-8111-111111111111", {
      headers: localHeaders,
    });
    await expect(detail.json()).resolves.toMatchObject({ repository: { favoriteCount: 0 } });
    const favorite = await app.request(
      "/image-repositories/11111111-1111-4111-8111-111111111111/tags/latest/favorite",
      {
        body: JSON.stringify({ favorite: true }),
        headers: { ...localHeaders, "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(favorite.status).toBe(200);
    const indexing = await app.request(
      `/image-repositories/11111111-1111-4111-8111-111111111111/tags?filter[search]=${"3".repeat(32)}`,
      { headers: localHeaders },
    );
    expect(indexing.status).toBe(202);
    expect((await indexing.json()).tags.digestIndex.total).toBe(3);
    const tags = await app.request(
      "/image-repositories/11111111-1111-4111-8111-111111111111/tags?page=1",
      { headers: localHeaders },
    );
    await expect(tags.json()).resolves.toMatchObject({
      tags: {
        count: 3,
        tags: [
          { favorite: true, name: "latest" },
          { favorite: false, name: "v1" },
          { favorite: false, name: "v2" },
        ],
      },
    });

    const descending = await app.request(
      "/image-repositories/11111111-1111-4111-8111-111111111111/tags?sort=-tag",
      { headers: localHeaders },
    );
    expect((await descending.json()).tags.tags).toMatchObject([
      { favorite: true, name: "latest" },
      { favorite: false, name: "v2" },
      { favorite: false, name: "v1" },
    ]);
    const filtered = await app.request(
      "/image-repositories/11111111-1111-4111-8111-111111111111/tags?sort=-tag&filter%5Btag%5D=%20V%20",
      { headers: localHeaders },
    );
    expect((await filtered.json()).tags).toMatchObject({
      count: 2,
      totalCount: 3,
      tags: [
        { favorite: false, name: "v2" },
        { favorite: false, name: "v1" },
      ],
    });
    const digestSearch = await app.request(
      `/image-repositories/11111111-1111-4111-8111-111111111111/tags?sort=-tag&filter[search]=${"3".repeat(32)}`,
      { headers: localHeaders },
    );
    expect((await digestSearch.json()).tags).toMatchObject({
      count: 1,
      tags: [{ name: "v2", digest: `sha256:${"3".repeat(64)}` }],
    });
    const digestFilter = await app.request(
      `/image-repositories/11111111-1111-4111-8111-111111111111/tags?filter[tag]=v&filter[digest]=${"3".repeat(16)}`,
      { headers: localHeaders },
    );
    expect((await digestFilter.json()).tags).toMatchObject({ count: 1, tags: [{ name: "v2" }] });
    for (const query of [
      "sort=name",
      "sort=tag,-tag",
      "filter[name]=v",
      `filter[tag]=${"v".repeat(129)}`,
      `filter[search]=${"a".repeat(257)}`,
    ]) {
      const invalidQuery = await app.request(
        `/image-repositories/11111111-1111-4111-8111-111111111111/tags?${query}`,
        { headers: localHeaders },
      );
      expect(invalidQuery.status).toBe(400);
    }

    const sync = await app.request(
      "/image-repositories/11111111-1111-4111-8111-111111111111/sync",
      { headers: localHeaders, method: "POST" },
    );
    expect(sync.status).toBe(202);
    await vi.waitFor(() => expect(repositories.list()[0]?.tagCount).toBe(3));

    const listed = await app.request("/image-repositories", { headers: localHeaders });
    await expect(listed.json()).resolves.toMatchObject({
      repositories: [{ repository: "docker.io/library/nginx", tagCount: 3 }],
    });

    const removed = await app.request("/image-repositories/11111111-1111-4111-8111-111111111111", {
      headers: localHeaders,
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(repositories.list()).toEqual([]);
  });

  it("returns volume and network inspect details for validated names", async () => {
    const controller = createController();
    const app = createApi(controller);

    const volume = await app.request("/volumes/app-data", { headers: localHeaders });
    expect(volume.status).toBe(200);
    await expect(volume.json()).resolves.toMatchObject({
      volume: { inspectJson: expect.stringContaining("app-data"), name: "app-data" },
    });
    expect(controller.getVolume).toHaveBeenCalledWith("app-data");

    const network = await app.request("/networks/app-network", { headers: localHeaders });
    expect(network.status).toBe(200);
    await expect(network.json()).resolves.toMatchObject({
      network: { id: "network-id", name: "app-network" },
    });
    expect(controller.getNetwork).toHaveBeenCalledWith("app-network");

    const invalid = await app.request("/volumes/bad%2Fname", { headers: localHeaders });
    expect(invalid.status).toBe(400);
    expect(controller.getVolume).toHaveBeenCalledTimes(1);
  });

  it("lists Compose projects and forwards project actions", async () => {
    const controller = createController();
    vi.mocked(controller.getComposeProjects).mockResolvedValue([
      {
        configFiles: ["/workspace/compose.yaml"],
        name: "demo-stack",
        status: "running(1)",
      },
    ]);
    const app = createApi(controller);

    const listResponse = await app.request("/compose/projects", { headers: localHeaders });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      projects: [{ name: "demo-stack", status: "running(1)" }],
    });

    const actionResponse = await app.request("/compose/projects/demo-stack/actions/stop", {
      headers: localHeaders,
      method: "POST",
    });
    expect(actionResponse.status).toBe(202);
    await vi.waitFor(() => expect(controller.composeProjectAction).toHaveBeenCalled());
    expect(controller.composeProjectAction).toHaveBeenCalledWith(
      "demo-stack",
      "stop",
      expect.any(Object),
    );
  });

  it("validates and accepts remote Compose lifecycle operations", async () => {
    const controller = createController();
    const app = createApi(controller);
    const register = await app.request("/compose/remote", {
      body: JSON.stringify({
        name: "remote-stack",
        url: "https://raw.githubusercontent.com/opnay/example/main/compose.yaml",
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(register.status).toBe(202);
    await vi.waitFor(() => expect(controller.registerRemoteCompose).toHaveBeenCalled());
    expect(controller.registerRemoteCompose).toHaveBeenCalledWith(
      {
        name: "remote-stack",
        url: "https://raw.githubusercontent.com/opnay/example/main/compose.yaml",
      },
      expect.any(Object),
    );

    const check = await app.request("/compose/projects/remote-stack/remote/check", {
      headers: localHeaders,
      method: "POST",
    });
    const update = await app.request("/compose/projects/remote-stack/remote/update", {
      headers: localHeaders,
      method: "POST",
    });
    const remove = await app.request("/compose/projects/remote-stack/remote", {
      headers: localHeaders,
      method: "DELETE",
    });
    expect([check.status, update.status, remove.status]).toEqual([202, 202, 202]);
    await vi.waitFor(() => expect(controller.removeRemoteCompose).toHaveBeenCalled());
  });

  it("validates and accepts form Compose lifecycle operations", async () => {
    const controller = createController();
    const app = createApi(controller);
    const spec = {
      ...emptyComposeBuilderSpec(),
      name: "form-stack",
      services: [{ ...emptyComposeBuilderService(), image: "nginx", name: "web" }],
    };
    const register = await app.request("/compose/builder", {
      body: JSON.stringify(spec),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(register.status).toBe(202);
    await vi.waitFor(() => expect(controller.registerBuilderCompose).toHaveBeenCalled());
    expect(controller.registerBuilderCompose).toHaveBeenCalledWith(
      { mode: "form", spec },
      expect.any(Object),
    );

    const detail = await app.request("/compose/projects/form-stack/builder", {
      headers: localHeaders,
    });
    expect(detail.status).toBe(200);
    const update = await app.request("/compose/projects/form-stack/builder", {
      body: JSON.stringify({
        expectedConfigHash: "a".repeat(64),
        input: { mode: "form", spec },
      }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });
    const remove = await app.request("/compose/projects/form-stack/builder", {
      headers: localHeaders,
      method: "DELETE",
    });
    expect([update.status, remove.status]).toEqual([202, 202]);
    await vi.waitFor(() => expect(controller.removeBuilderCompose).toHaveBeenCalled());
  });

  it("accepts directly authored Compose YAML", async () => {
    const controller = createController();
    const app = createApi(controller);
    const input = {
      mode: "yaml",
      name: "yaml-stack",
      yaml: "services:\n  web:\n    image: nginx:alpine\n",
    };

    const response = await app.request("/compose/builder", {
      body: JSON.stringify(input),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(controller.registerBuilderCompose).toHaveBeenCalled());
    expect(controller.registerBuilderCompose).toHaveBeenCalledWith(input, expect.any(Object));
  });

  it("rejects an insecure remote Compose URL before queueing", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/compose/remote", {
      body: JSON.stringify({ url: "http://127.0.0.1/compose.yaml" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(controller.registerRemoteCompose).not.toHaveBeenCalled();
  });

  it("accepts a long operation before the Docker promise settles", async () => {
    const controller = createController();
    let finish!: () => void;
    vi.mocked(controller.runContainer).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const app = createApi(controller);
    const response = await app.request("/containers", {
      body: JSON.stringify({ ...emptyContainerSpec(), image: "alpine:3.23", name: "async" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    const value = (await response.json()) as { operation: { id: string; status: string } };
    expect(value.operation.id).toBeTruthy();
    expect(["queued", "running"]).toContain(value.operation.status);
    await vi.waitFor(() => expect(controller.runContainer).toHaveBeenCalled());
    finish();
  });

  it("returns container detail and accepts a typed async update", async () => {
    const controller = createController();
    const app = createApi(controller);
    const detailResponse = await app.request("/containers/container-id", { headers: localHeaders });
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      container: { configHash: "a".repeat(64), id: "container-id" },
    });

    const inspectResponse = await app.request("/containers/container-id/inspect", {
      headers: localHeaders,
    });
    expect(inspectResponse.status).toBe(200);
    await expect(inspectResponse.json()).resolves.toMatchObject({
      inspection: { health: { status: "healthy" }, json: expect.stringContaining("container-id") },
    });

    const terminalResponse = await app.request("/containers/container-id/terminal", {
      headers: localHeaders,
    });
    expect(terminalResponse.status).toBe(200);
    await expect(terminalResponse.json()).resolves.toEqual({
      terminal: {
        command: "docker --context overseer exec -it container-id sh",
        shell: "sh",
        status: "ready",
      },
    });

    const spec = { ...emptyContainerSpec(), image: "nginx:alpine", name: "renamed" };
    const updateResponse = await app.request("/containers/container-id", {
      body: JSON.stringify({ expectedConfigHash: "a".repeat(64), spec }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updateResponse.status).toBe(202);
    await vi.waitFor(() => expect(controller.updateContainer).toHaveBeenCalled());
    expect(controller.updateContainer).toHaveBeenCalledWith(
      "container-id",
      { expectedConfigHash: "a".repeat(64), spec },
      expect.any(Object),
    );
  });

  it("revalidates and creates a new operation when a failed action is retried", async () => {
    const controller = createController();
    vi.mocked(controller.createVolume)
      .mockRejectedValueOnce(new ExpectedError("docker_command_failed", "첫 시도 실패", 503))
      .mockResolvedValueOnce(undefined);
    const app = createApi(controller);
    const firstResponse = await app.request("/volumes", {
      body: JSON.stringify({ name: "retry-data" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });
    const first = (await firstResponse.json()) as { operation: { id: string } };
    await vi.waitFor(async () => {
      const response = await app.request(`/operations/${first.operation.id}`, {
        headers: localHeaders,
      });
      const value = (await response.json()) as { operation: { status: string } };
      expect(value.operation.status).toBe("failed");
    });

    const retryResponse = await app.request(`/operations/${first.operation.id}/retry`, {
      headers: localHeaders,
      method: "POST",
    });
    expect(retryResponse.status).toBe(202);
    const retry = (await retryResponse.json()) as {
      operation: { id: string; retriedFromId?: string };
    };
    expect(retry.operation.id).not.toBe(first.operation.id);
    expect(retry.operation.retriedFromId).toBe(first.operation.id);
    await vi.waitFor(() => expect(controller.createVolume).toHaveBeenCalledTimes(2));
    expect(controller.createVolume).toHaveBeenLastCalledWith(
      { name: "retry-data" },
      expect.any(Object),
    );
  });
});
