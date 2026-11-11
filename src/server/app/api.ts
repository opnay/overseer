import { Hono, type Context } from "hono";
import type { MenuBarResponse } from "../../shared/contracts.ts";
import type { RuntimeController } from "../application/overseer-controller.ts";
import { ExpectedError } from "../core/errors.ts";
import { LimaDockerRuntime } from "../infrastructure/lima/lima-docker-runtime.ts";
import {
  DockerCliPluginService,
  type DockerCliPluginController,
} from "../modules/docker-plugins/index.ts";
import {
  ImageRepositoryService,
  SqliteImageRepositoryStore,
  type ImageRepositoryController,
} from "../modules/image-repositories/index.ts";
import { SqliteRuntimeInstanceStore } from "../modules/instances/index.ts";
import {
  OperationQueue,
  SqliteOperationHistoryStore,
  type OperationRetryMethod,
  type OperationRetryRequest,
} from "../modules/operations/index.ts";
import {
  StartupPrerequisiteService,
  type StartupPrerequisiteController,
} from "../modules/startup/index.ts";
import { type EnqueueApiOperation } from "./http.ts";
import { registerComposeRoutes } from "./routes/compose-routes.ts";
import { registerBuildRoutes } from "./routes/build-routes.ts";
import { registerContainerRoutes } from "./routes/container-routes.ts";
import { registerDockerPluginRoutes } from "./routes/docker-plugin-routes.ts";
import { registerImageRoutes } from "./routes/image-routes.ts";
import { registerImageRepositoryRoutes } from "./routes/image-repository-routes.ts";
import { registerNetworkRoutes } from "./routes/network-routes.ts";
import { registerOperationRoutes } from "./routes/operation-routes.ts";
import { registerRuntimeRoutes } from "./routes/runtime-routes.ts";
import { registerStartupRoutes } from "./routes/startup-routes.ts";
import { registerVolumeRoutes } from "./routes/volume-routes.ts";
import { requireLocalRequest } from "./security.ts";

function retryRequest(context: Context, body?: unknown): OperationRetryRequest {
  const method = context.req.method;
  if (method !== "DELETE" && method !== "PATCH" && method !== "POST") {
    throw new Error(`unsupported operation retry method: ${method}`);
  }
  const pathname = new URL(context.req.url).pathname;
  const path = pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname;
  return {
    ...(body === undefined ? {} : { body }),
    method: method as OperationRetryMethod,
    path,
  };
}

export function createApi(
  controller: RuntimeController,
  operations = new OperationQueue(),
  startup: StartupPrerequisiteController = new StartupPrerequisiteService(),
  imageRepositories: ImageRepositoryController = new ImageRepositoryService(),
  dockerPlugins: DockerCliPluginController = new DockerCliPluginService(),
) {
  const app = new Hono();
  const enqueue: EnqueueApiOperation = (context, input, body, retryable = true) =>
    operations.enqueue({
      ...input,
      ...(retryable ? { retryRequest: retryRequest(context, body) } : {}),
    });

  app.use("*", requireLocalRequest);
  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/dashboard", async (context) => context.json(await controller.getDashboard()));
  app.get("/menu-bar", async (context) => {
    const prerequisites = await startup.getSnapshot();
    if (!prerequisites.ready) {
      return context.json({ setupRequired: true } satisfies MenuBarResponse);
    }
    const snapshot = await controller.getMenuBarSnapshot();
    const response: MenuBarResponse =
      snapshot.runtime.phase === "missing" || snapshot.runtime.phase === "error"
        ? { setupRequired: true }
        : { ...snapshot, setupRequired: false };
    return context.json(response);
  });

  registerStartupRoutes(app, startup, enqueue);
  registerRuntimeRoutes(app, controller, enqueue);
  registerOperationRoutes(app, operations);
  registerComposeRoutes(app, controller, enqueue);
  registerBuildRoutes(app, controller);
  registerContainerRoutes(app, controller, enqueue);
  registerDockerPluginRoutes(app, dockerPlugins, enqueue);
  registerImageRepositoryRoutes(app, imageRepositories, enqueue);
  registerImageRoutes(app, controller, enqueue);
  registerVolumeRoutes(app, controller, enqueue);
  registerNetworkRoutes(app, controller, enqueue);

  app.onError((error, context) => {
    if (error instanceof ExpectedError) {
      return context.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error(error);
    return context.json(
      { error: { code: "internal_error", message: "요청을 처리하지 못했습니다." } },
      500,
    );
  });

  return app;
}

export function createPersistentApi() {
  const history = new SqliteOperationHistoryStore();
  const instances = new SqliteRuntimeInstanceStore();
  const imageRepositories = new ImageRepositoryService(new SqliteImageRepositoryStore());
  return createApi(
    new LimaDockerRuntime(undefined, undefined, undefined, undefined, instances),
    new OperationQueue(3, history),
    undefined,
    imageRepositories,
  );
}

export type ApiType = ReturnType<typeof createApi>;
