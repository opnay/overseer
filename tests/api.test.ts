import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/server/api.ts";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import {
  emptyComposeBuilderService,
  emptyComposeBuilderSpec,
} from "../src/shared/compose-builder.ts";
import { ExpectedError } from "../src/server/errors.ts";
import type { RuntimeController } from "../src/server/lima-docker-runtime.ts";
import { OperationQueue } from "../src/server/operations.ts";
import type { StartupPrerequisiteController } from "../src/server/startup.ts";
import type { StartupSnapshot } from "../src/shared/contracts.ts";

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
    createVolume: vi.fn(async () => undefined),
    getBuilderComposeProject: vi.fn(async (name) => ({
      configHash: "a".repeat(64),
      spec: { name, networks: [], services: [], volumes: [] },
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
      message: "저장하면 Docker daemon만 다시 시작합니다.",
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
    pullImage: vi.fn(async () => undefined),
    prepareRuntimeInstance: vi.fn(async () => undefined),
    registerBuilderCompose: vi.fn(async () => undefined),
    registerRemoteCompose: vi.fn(async () => undefined),
    recreateRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    removeBuilderCompose: vi.fn(async () => undefined),
    removeContainer: vi.fn(async () => undefined),
    removeImage: vi.fn(async () => undefined),
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

  it("does not enqueue automatic Homebrew installation", async () => {
    const startup: StartupPrerequisiteController = {
      checkUpdates: vi.fn(async () => undefined),
      getSnapshot: vi.fn(async (): Promise<StartupSnapshot> => ({
        prerequisites: [
          {
            automaticInstall: false,
            automaticInstallUnavailableReason: "Terminal에서 설치하십시오.",
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
    expect(controller.registerBuilderCompose).toHaveBeenCalledWith(spec, expect.any(Object));

    const detail = await app.request("/compose/projects/form-stack/builder", {
      headers: localHeaders,
    });
    expect(detail.status).toBe(200);
    const update = await app.request("/compose/projects/form-stack/builder", {
      body: JSON.stringify({ expectedConfigHash: "a".repeat(64), spec }),
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
