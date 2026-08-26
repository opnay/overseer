import type { Hono } from "hono";
import type { PullImageInput } from "../../../shared/contracts.ts";
import type { ImageController } from "../../application/overseer-controller.ts";
import {
  requireContainerReference,
  requireImageIdentifier,
  requireImageReference,
} from "../../core/validation.ts";
import { readObject, requirePageNumber, type EnqueueApiOperation } from "../http.ts";

export function registerImageRoutes(
  app: Hono,
  controller: ImageController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/images", async (context) => context.json({ images: await controller.getImages() }));
  app.get("/images/:id/history", async (context) => {
    const history = await controller.getImageHistory(
      requireImageIdentifier(context.req.param("id")),
    );
    return context.json({ history });
  });
  app.get("/images/:id/tags", async (context) => {
    const tags = await controller.getImageRepositoryTags(
      requireImageIdentifier(context.req.param("id")),
      requirePageNumber(context.req.query("page")),
    );
    return context.json({ tags });
  });
  app.get("/images/:id", async (context) => {
    const image = await controller.getImage(requireImageIdentifier(context.req.param("id")));
    return context.json({ image });
  });
  app.post("/images/pull", async (context) => {
    const body = await readObject(context);
    const input: PullImageInput = { image: requireImageReference(body.image) };
    const operation = enqueue(
      context,
      {
        kind: "image.pull",
        locks: [`image:${input.image}`],
        run: (progress) => controller.pullImage(input, progress),
        successMessage: `${input.image} 이미지를 받았습니다.`,
        target: { name: input.image, resource: "image" },
        title: "이미지 받기",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.delete("/images/:id", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const operation = enqueue(context, {
      kind: "image.remove",
      locks: [`image:${id}`],
      run: (progress) => controller.removeImage(id, progress),
      successMessage: "이미지를 삭제했습니다.",
      target: { id, name: id, resource: "image" },
      title: "이미지 삭제",
    });
    return context.json({ operation }, 202);
  });
}
