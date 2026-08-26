import type { Hono } from "hono";
import type { VolumeController } from "../../application/overseer-controller.ts";
import { requireResourceName } from "../../core/validation.ts";
import { readObject, type EnqueueApiOperation } from "../http.ts";

export function registerVolumeRoutes(
  app: Hono,
  controller: VolumeController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/volumes", async (context) => context.json({ volumes: await controller.getVolumes() }));
  app.get("/volumes/:name", async (context) =>
    context.json({
      volume: await controller.getVolume(requireResourceName(context.req.param("name"))),
    }),
  );
  app.post("/volumes", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = enqueue(
      context,
      {
        kind: "volume.create",
        locks: [`volume:${name}`],
        run: (progress) => controller.createVolume({ name }, progress),
        successMessage: `${name} 볼륨을 만들었습니다.`,
        target: { name, resource: "volume" },
        title: "볼륨 만들기",
      },
      { name },
    );
    return context.json({ operation }, 202);
  });
  app.delete("/volumes/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "volume.remove",
      locks: [`volume:${name}`],
      run: (progress) => controller.removeVolume(name, progress),
      successMessage: `${name} 볼륨을 삭제했습니다.`,
      target: { name, resource: "volume" },
      title: "볼륨 삭제",
    });
    return context.json({ operation }, 202);
  });
}
