import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/server/api.ts";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import type { RuntimeController } from "../src/server/lima-docker-runtime.ts";

function createController(): RuntimeController {
  return {
    composeProjectAction: vi.fn(async () => undefined),
    containerAction: vi.fn(async () => undefined),
    createNetwork: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => undefined),
    getContainer: vi.fn(async (id) => ({
      configHash: "a".repeat(64),
      id,
      replacementBlockers: [],
      running: true,
      spec: { ...emptyContainerSpec(), image: "nginx:alpine", name: "web" },
    })),
    getContainers: vi.fn(async () => []),
    getComposeProject: vi.fn(async (name) => ({
      configFiles: ["/workspace/compose.yaml"],
      name,
      services: [],
      status: "running(1)",
    })),
    getComposeProjectLogs: vi.fn(async () => "compose logs"),
    getComposeProjects: vi.fn(async () => []),
    getContainerLogs: vi.fn(async () => "hello"),
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
    getImages: vi.fn(async () => []),
    getNetworks: vi.fn(async () => []),
    getVolumes: vi.fn(async () => []),
    pullImage: vi.fn(async () => undefined),
    removeContainer: vi.fn(async () => undefined),
    removeImage: vi.fn(async () => undefined),
    removeNetwork: vi.fn(async () => undefined),
    removeVolume: vi.fn(async () => undefined),
    runContainer: vi.fn(async () => undefined),
    startRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "정상 실행 중",
      phase: "running" as const,
    })),
    stopRuntime: vi.fn(async () => ({
      instance: "overseer",
      message: "중지됨",
      phase: "stopped" as const,
    })),
    updateContainer: vi.fn(async () => undefined),
  };
}

const localHeaders = { host: "overseer.localhost:1355", origin: "http://overseer.localhost:1355" };

describe("API boundary", () => {
  it("returns the dashboard to a local request", async () => {
    const app = createApi(createController());
    const response = await app.request("/dashboard", { headers: localHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runtime: { phase: "missing" } });
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
});
