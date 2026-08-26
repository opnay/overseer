import type { Hono } from "hono";
import type {
  ComposeBuilderProjectDetail,
  RegisterRemoteComposeInput,
} from "../../../shared/contracts.ts";
import type { ComposeController } from "../../application/overseer-controller.ts";
import { ExpectedError } from "../../core/errors.ts";
import {
  deriveRemoteComposeProjectName,
  parseComposeBuilderSpec,
  parseUpdateComposeBuilderInput,
} from "../../modules/compose/index.ts";
import {
  optionalComposeProjectName,
  requireComposeUrl,
  requireResourceName,
} from "../../core/validation.ts";
import { readObject, type EnqueueApiOperation } from "../http.ts";

export function registerComposeRoutes(
  app: Hono,
  controller: ComposeController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/compose/projects", async (context) =>
    context.json({ projects: await controller.getComposeProjects() }),
  );
  app.post("/compose/builder", async (context) => {
    const spec = parseComposeBuilderSpec(await readObject(context));
    const operation = enqueue(
      context,
      {
        kind: "compose.builder.register",
        locks: [`compose:${spec.name}`],
        run: (progress) => controller.registerBuilderCompose(spec, progress),
        successMessage: `${spec.name} 폼 Compose 프로젝트를 등록했습니다.`,
        target: { name: spec.name, resource: "compose" },
        title: "폼 Compose 등록",
      },
      spec,
    );
    return context.json({ operation }, 202);
  });
  app.get("/compose/projects/:name/builder", async (context) => {
    const project: ComposeBuilderProjectDetail = await controller.getBuilderComposeProject(
      requireResourceName(context.req.param("name")),
    );
    return context.json({ project });
  });
  app.patch("/compose/projects/:name/builder", async (context) => {
    const name = requireResourceName(context.req.param("name"));
    const input = parseUpdateComposeBuilderInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        kind: "compose.builder.update",
        locks: [`compose:${name}`],
        run: (progress) => controller.updateBuilderCompose(name, input, progress),
        successMessage: `${name} 폼 Compose 구성을 수정했습니다.`,
        target: { name, resource: "compose" },
        title: "폼 Compose 수정",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.delete("/compose/projects/:name/builder", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "compose.builder.remove",
      locks: [`compose:${name}`],
      run: (progress) => controller.removeBuilderCompose(name, progress),
      successMessage: `${name} 폼 Compose 등록을 해제했습니다.`,
      target: { name, resource: "compose" },
      title: "폼 Compose 등록 해제",
    });
    return context.json({ operation }, 202);
  });
  app.post("/compose/remote", async (context) => {
    const body = await readObject(context);
    const requestedName = optionalComposeProjectName(body.name);
    const input: RegisterRemoteComposeInput = {
      ...(requestedName ? { name: requestedName } : {}),
      url: requireComposeUrl(body.url),
    };
    const name = input.name ?? deriveRemoteComposeProjectName(input.url);
    const operation = enqueue(
      context,
      {
        kind: "compose.remote.register",
        locks: [`compose:${name}`],
        run: (progress) => controller.registerRemoteCompose(input, progress),
        successMessage: `${name} URL Compose 프로젝트를 등록했습니다.`,
        target: { name, resource: "compose" },
        title: "URL Compose 등록",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.post("/compose/projects/:name/remote/check", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
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
    const operation = enqueue(context, {
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
    const operation = enqueue(context, {
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
    const operation = enqueue(context, {
      kind: `compose.${action}`,
      locks: [`compose:${name}`],
      run: (progress) => controller.composeProjectAction(name, action, progress),
      successMessage: `${name} Compose 작업을 완료했습니다.`,
      target: { name, resource: "compose" },
      title: `Compose ${action}`,
    });
    return context.json({ operation }, 202);
  });
}
