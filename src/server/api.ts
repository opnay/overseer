import { Hono } from "hono";
import type { PullImageInput, RunContainerInput } from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";
import { LimaDockerRuntime, type RuntimeController } from "./lima-docker-runtime.ts";
import { requireLocalRequest } from "./security.ts";
import {
  optionalContainerName,
  optionalPort,
  requireContainerReference,
  requireImageReference,
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

export function createApi(controller: RuntimeController) {
  const app = new Hono();

  app.use("*", requireLocalRequest);

  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/dashboard", async (context) => context.json(await controller.getDashboard()));

  app.post("/runtime/start", async (context) =>
    context.json({ runtime: await controller.startRuntime() }),
  );
  app.post("/runtime/stop", async (context) =>
    context.json({ runtime: await controller.stopRuntime() }),
  );

  app.post("/containers", async (context) => {
    const body = await readObject(context);
    const input: RunContainerInput = {
      containerPort: optionalPort(body.containerPort),
      image: requireImageReference(body.image),
      name: optionalContainerName(body.name),
    };
    await controller.runContainer(input);
    return context.json({ ok: true }, 201);
  });

  app.post("/containers/:id/actions/:action", async (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const action = context.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new ExpectedError("invalid_action", "지원하지 않는 컨테이너 작업입니다.", 400);
    }
    await controller.containerAction(id, action);
    return context.json({ ok: true });
  });

  app.delete("/containers/:id", async (context) => {
    await controller.removeContainer(requireContainerReference(context.req.param("id")));
    return context.json({ ok: true });
  });

  app.get("/containers/:id/logs", async (context) => {
    const logs = await controller.getContainerLogs(
      requireContainerReference(context.req.param("id")),
    );
    return context.json({ logs });
  });

  app.post("/images/pull", async (context) => {
    const body = await readObject(context);
    const input: PullImageInput = { image: requireImageReference(body.image) };
    await controller.pullImage(input);
    return context.json({ ok: true }, 201);
  });

  app.delete("/images/:id", async (context) => {
    await controller.removeImage(requireContainerReference(context.req.param("id")));
    return context.json({ ok: true });
  });

  app.post("/volumes", async (context) => {
    const body = await readObject(context);
    await controller.createVolume({ name: requireResourceName(body.name) });
    return context.json({ ok: true }, 201);
  });

  app.delete("/volumes/:name", async (context) => {
    await controller.removeVolume(requireResourceName(context.req.param("name")));
    return context.json({ ok: true });
  });

  app.post("/networks", async (context) => {
    const body = await readObject(context);
    await controller.createNetwork({ name: requireResourceName(body.name) });
    return context.json({ ok: true }, 201);
  });

  app.delete("/networks/:name", async (context) => {
    await controller.removeNetwork(requireResourceName(context.req.param("name")));
    return context.json({ ok: true });
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
