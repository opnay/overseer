import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/server/api.ts";
import type { RuntimeController } from "../src/server/lima-docker-runtime.ts";

function createController(): RuntimeController {
  return {
    containerAction: vi.fn(async () => undefined),
    createNetwork: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => undefined),
    getContainerLogs: vi.fn(async () => "hello"),
    getDashboard: vi.fn(async () => ({
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
    const response = await app.request("/containers", {
      body: JSON.stringify({ containerPort: 80, image: "nginx:alpine", name: "web" }),
      headers: { ...localHeaders, "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(controller.runContainer).toHaveBeenCalledWith({
      containerPort: 80,
      image: "nginx:alpine",
      name: "web",
    });
  });

  it("rejects command injection input before the runtime", async () => {
    const controller = createController();
    const app = createApi(controller);
    const response = await app.request("/containers", {
      body: JSON.stringify({ image: "nginx; whoami" }),
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

    expect(response.status).toBe(201);
    expect(controller.createVolume).toHaveBeenCalledWith({ name: "app-data" });
  });
});
