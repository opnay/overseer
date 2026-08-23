import { Hono } from "hono";
import type { PullImageInput, RegisterRemoteComposeInput } from "../shared/contracts.ts";
import { parseContainerSpec, parseUpdateContainerInput } from "./container-spec.ts";
import { ExpectedError } from "./errors.ts";
import { LimaDockerRuntime, type RuntimeController } from "./lima-docker-runtime.ts";
import { OperationQueue } from "./operations.ts";
import { deriveRemoteComposeProjectName } from "./remote-compose.ts";
import { requireLocalRequest } from "./security.ts";
import {
  requireContainerReference,
  requireComposeUrl,
  requireImageReference,
  optionalComposeProjectName,
  requireResourceName,
} from "./validation.ts";

async function readObject(context: { req: { json: () => Promise<unknown> } }) {
  try {
    const value = await context.req.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError("invalid_body", "요청 본문은 객체여야 합니다.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    throw new ExpectedError("invalid_json", "JSON 요청 본문을 확인하십시오.", 400);
  }
}

export function createApi(controller: RuntimeController, operations = new OperationQueue()) {
  const app = new Hono();

  app.use("*", requireLocalRequest);

  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/dashboard", async (context) => context.json(await controller.getDashboard()));

  app.get("/operations", (context) => context.json({ operations: operations.list() }));
  app.get("/operations/:id", (context) => {
    const operation = operations.get(context.req.param("id"));
    if (!operation) throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    return context.json({ operation });
  });
  app.delete("/operations/:id", (context) =>
    context.json({ operation: operations.cancel(context.req.param("id")) }),
  );

  app.post("/runtime/start", (context) => {
    const operation = operations.enqueue({
      exclusive: true,
      kind: "runtime.start",
      locks: [],
      run: async (progress) => void (await controller.startRuntime(progress)),
      successMessage: "Lima 런타임을 시작했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "런타임 시작",
    });
    return context.json({ operation }, 202);
  });

  app.post("/runtime/stop", (context) => {
    const operation = operations.enqueue({
      exclusive: true,
      kind: "runtime.stop",
      locks: [],
      run: async (progress) => void (await controller.stopRuntime(progress)),
      successMessage: "Lima 런타임을 중지했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "런타임 중지",
    });
    return context.json({ operation }, 202);
  });

  app.get("/compose/projects", async (context) =>
    context.json({ projects: await controller.getComposeProjects() }),
  );
  app.post("/compose/remote", async (context) => {
    const body = await readObject(context);
    const requestedName = optionalComposeProjectName(body.name);
    const input: RegisterRemoteComposeInput = {
      ...(requestedName ? { name: requestedName } : {}),
      url: requireComposeUrl(body.url),
    };
    const name = input.name ?? deriveRemoteComposeProjectName(input.url);
    const operation = operations.enqueue({
      kind: "compose.remote.register",
      locks: [`compose:${name}`],
      run: (progress) => controller.registerRemoteCompose(input, progress),
      successMessage: `${name} URL Compose 프로젝트를 등록했습니다.`,
      target: { name, resource: "compose" },
      title: "URL Compose 등록",
    });
    return context.json({ operation }, 202);
  });
  app.post("/compose/projects/:name/remote/check", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = operations.enqueue({
      kind: "compose.remote.check",
      locks: [`compose:${name}`],
      run: (progress) => controller.checkRemoteComposeUpdate(name, progress),
      successMessage: `${name} Compose 업데이트를 확인했습니다.`,
      target: { name, resource: "compose" },
      title: "Compose 업데이트 확인",
    });
    return context.json({ operation }, 202);
  });
  app.post("/compose/projects/:name/remote/update", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = operations.enqueue({
      kind: "compose.remote.update",
      locks: [`compose:${name}`],
      run: (progress) => controller.applyRemoteComposeUpdate(name, progress),
      successMessage: `${name} Compose 파일을 업데이트했습니다.`,
      target: { name, resource: "compose" },
      title: "Compose 업데이트 적용",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/compose/projects/:name/remote", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = operations.enqueue({
      kind: "compose.remote.remove",
      locks: [`compose:${name}`],
      run: (progress) => controller.removeRemoteCompose(name, progress),
      successMessage: `${name} URL Compose 등록을 해제했습니다.`,
      target: { name, resource: "compose" },
      title: "URL Compose 등록 해제",
    });
    return context.json({ operation }, 202);
  });
  app.get("/compose/projects/:name/logs", async (context) => {
    const logs = await controller.getComposeProjectLogs(
      requireResourceName(context.req.param("name")),
    );
    return context.json({ logs });
  });
  app.get("/compose/projects/:name", async (context) =>
    context.json({
      project: await controller.getComposeProject(requireResourceName(context.req.param("name"))),
    }),
  );
  app.post("/compose/projects/:name/actions/:action", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const action = context.req.param("action");
    if (action !== "up" && action !== "stop" && action !== "restart" && action !== "down") {
      throw new ExpectedError("invalid_action", "지원하지 않는 Compose 작업입니다.", 400);
    }
    const operation = operations.enqueue({
      kind: `compose.${action}`,
      locks: [`compose:${name}`],
      run: (progress) => controller.composeProjectAction(name, action, progress),
      successMessage: `${name} Compose 작업을 완료했습니다.`,
      target: { name, resource: "compose" },
      title: `Compose ${action}`,
    });
    return context.json({ operation }, 202);
  });

  app.get("/containers", async (context) =>
    context.json({ containers: await controller.getContainers() }),
  );
  app.post("/containers", async (context) => {
    const spec = parseContainerSpec(await readObject(context));
    const name = spec.name ?? spec.image;
    const operation = operations.enqueue({
      kind: "container.create",
      locks: [
        ...(spec.name ? [`container-name:${spec.name}`] : []),
        ...spec.networks.map((network) => `network:${network}`),
        ...spec.volumes.map(({ volume }) => `volume:${volume}`),
      ],
      run: (progress) => controller.runContainer(spec, progress),
      successMessage: `${name} 컨테이너를 실행했습니다.`,
      target: { name, resource: "container" },
      title: "컨테이너 실행",
    });
    return context.json({ operation }, 202);
  });
  app.get("/containers/:id", async (context) =>
    context.json({
      container: await controller.getContainer(requireContainerReference(context.req.param("id"))),
    }),
  );
  app.patch("/containers/:id", async (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const input = parseUpdateContainerInput(await readObject(context));
    const name = input.spec.name ?? id;
    const operation = operations.enqueue({
      kind: "container.update",
      locks: [
        `container:${id}`,
        `container-name:${name}`,
        ...input.spec.networks.map((network) => `network:${network}`),
        ...input.spec.volumes.map(({ volume }) => `volume:${volume}`),
      ],
      run: (progress) => controller.updateContainer(id, input, progress),
      successMessage: `${name} 컨테이너 설정을 변경했습니다.`,
      target: { id, name, resource: "container" },
      title: "컨테이너 설정 변경",
    });
    return context.json({ operation }, 202);
  });
  app.post("/containers/:id/actions/:action", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const action = context.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new ExpectedError("invalid_action", "지원하지 않는 컨테이너 작업입니다.", 400);
    }
    const operation = operations.enqueue({
      kind: `container.${action}`,
      locks: [`container:${id}`],
      run: (progress) => controller.containerAction(id, action, progress),
      successMessage: `컨테이너 ${action} 작업을 완료했습니다.`,
      target: { id, name: id, resource: "container" },
      title: `컨테이너 ${action}`,
    });
    return context.json({ operation }, 202);
  });
  app.delete("/containers/:id", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const operation = operations.enqueue({
      kind: "container.remove",
      locks: [`container:${id}`],
      run: (progress) => controller.removeContainer(id, progress),
      successMessage: "컨테이너를 삭제했습니다.",
      target: { id, name: id, resource: "container" },
      title: "컨테이너 삭제",
    });
    return context.json({ operation }, 202);
  });
  app.get("/containers/:id/logs", async (context) => {
    const logs = await controller.getContainerLogs(
      requireContainerReference(context.req.param("id")),
    );
    return context.json({ logs });
  });

  app.get("/images", async (context) => context.json({ images: await controller.getImages() }));
  app.post("/images/pull", async (context) => {
    const body = await readObject(context);
    const input: PullImageInput = { image: requireImageReference(body.image) };
    const operation = operations.enqueue({
      kind: "image.pull",
      locks: [`image:${input.image}`],
      run: (progress) => controller.pullImage(input, progress),
      successMessage: `${input.image} 이미지를 받았습니다.`,
      target: { name: input.image, resource: "image" },
      title: "이미지 받기",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/images/:id", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const operation = operations.enqueue({
      kind: "image.remove",
      locks: [`image:${id}`],
      run: (progress) => controller.removeImage(id, progress),
      successMessage: "이미지를 삭제했습니다.",
      target: { id, name: id, resource: "image" },
      title: "이미지 삭제",
    });
    return context.json({ operation }, 202);
  });

  app.get("/volumes", async (context) => context.json({ volumes: await controller.getVolumes() }));
  app.post("/volumes", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = operations.enqueue({
      kind: "volume.create",
      locks: [`volume:${name}`],
      run: (progress) => controller.createVolume({ name }, progress),
      successMessage: `${name} 볼륨을 만들었습니다.`,
      target: { name, resource: "volume" },
      title: "볼륨 만들기",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/volumes/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = operations.enqueue({
      kind: "volume.remove",
      locks: [`volume:${name}`],
      run: (progress) => controller.removeVolume(name, progress),
      successMessage: `${name} 볼륨을 삭제했습니다.`,
      target: { name, resource: "volume" },
      title: "볼륨 삭제",
    });
    return context.json({ operation }, 202);
  });

  app.get("/networks", async (context) =>
    context.json({ networks: await controller.getNetworks() }),
  );
  app.post("/networks", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = operations.enqueue({
      kind: "network.create",
      locks: [`network:${name}`],
      run: (progress) => controller.createNetwork({ name }, progress),
      successMessage: `${name} 네트워크를 만들었습니다.`,
      target: { name, resource: "network" },
      title: "네트워크 만들기",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/networks/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = operations.enqueue({
      kind: "network.remove",
      locks: [`network:${name}`],
      run: (progress) => controller.removeNetwork(name, progress),
      successMessage: `${name} 네트워크를 삭제했습니다.`,
      target: { name, resource: "network" },
      title: "네트워크 삭제",
    });
    return context.json({ operation }, 202);
  });

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

export const api = createApi(new LimaDockerRuntime());
export type ApiType = ReturnType<typeof createApi>;
