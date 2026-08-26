import type { Hono } from "hono";
import type { ContainerController } from "../../application/overseer-controller.ts";
import { ExpectedError } from "../../core/errors.ts";
import { requireContainerReference } from "../../core/validation.ts";
import { parseContainerSpec, parseUpdateContainerInput } from "../../modules/containers/index.ts";
import { readObject, type EnqueueApiOperation } from "../http.ts";

export function registerContainerRoutes(
  app: Hono,
  controller: ContainerController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/containers", async (context) =>
    context.json({ containers: await controller.getContainers() }),
  );
  app.post("/containers", async (context) => {
    const spec = parseContainerSpec(await readObject(context));
    const name = spec.name ?? spec.image;
    const operation = enqueue(
      context,
      {
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
      },
      spec,
    );
    return context.json({ operation }, 202);
  });
  app.get("/containers/:id", async (context) =>
    context.json({
      container: await controller.getContainer(requireContainerReference(context.req.param("id"))),
    }),
  );
  app.get("/containers/:id/inspect", async (context) =>
    context.json({
      inspection: await controller.getContainerInspection(
        requireContainerReference(context.req.param("id")),
      ),
    }),
  );
  app.get("/containers/:id/terminal", async (context) =>
    context.json({
      terminal: await controller.getContainerTerminalAccess(
        requireContainerReference(context.req.param("id")),
      ),
    }),
  );
  app.patch("/containers/:id", async (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const input = parseUpdateContainerInput(await readObject(context));
    const name = input.spec.name ?? id;
    const operation = enqueue(
      context,
      {
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
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.post("/containers/:id/actions/:action", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const action = context.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new ExpectedError("invalid_action", "지원하지 않는 컨테이너 작업입니다.", 400);
    }
    const operation = enqueue(context, {
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
    const operation = enqueue(context, {
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
}
