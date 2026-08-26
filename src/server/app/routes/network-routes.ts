import type { Hono } from "hono";
import type { NetworkController } from "../../application/overseer-controller.ts";
import { requireResourceName } from "../../core/validation.ts";
import { readObject, type EnqueueApiOperation } from "../http.ts";

export function registerNetworkRoutes(
  app: Hono,
  controller: NetworkController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/networks", async (context) =>
    context.json({ networks: await controller.getNetworks() }),
  );
  app.get("/networks/:name", async (context) =>
    context.json({
      network: await controller.getNetwork(requireResourceName(context.req.param("name"))),
    }),
  );
  app.post("/networks", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = enqueue(
      context,
      {
        kind: "network.create",
        locks: [`network:${name}`],
        run: (progress) => controller.createNetwork({ name }, progress),
        successMessage: `${name} 네트워크를 만들었습니다.`,
        target: { name, resource: "network" },
        title: "네트워크 만들기",
      },
      { name },
    );
    return context.json({ operation }, 202);
  });
  app.delete("/networks/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "network.remove",
      locks: [`network:${name}`],
      run: (progress) => controller.removeNetwork(name, progress),
      successMessage: `${name} 네트워크를 삭제했습니다.`,
      target: { name, resource: "network" },
      title: "네트워크 삭제",
    });
    return context.json({ operation }, 202);
  });
}
