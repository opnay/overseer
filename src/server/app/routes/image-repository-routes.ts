import type { Hono } from "hono";
import type { AddImageRepositoryInput } from "../../../shared/contracts.ts";
import type { ImageRepositoryController } from "../../modules/image-repositories/index.ts";
import { ExpectedError } from "../../core/errors.ts";
import { requireImageRepository } from "../../core/validation.ts";
import { readObject, type EnqueueApiOperation } from "../http.ts";

function requireRepositoryId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new ExpectedError(
      "invalid_image_repository",
      "유효하지 않은 이미지 저장소 식별자입니다.",
      400,
    );
  }
  return value;
}

export function registerImageRepositoryRoutes(
  app: Hono,
  repositories: ImageRepositoryController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/image-repositories", (context) => context.json({ repositories: repositories.list() }));
  app.post("/image-repositories", async (context) => {
    const body = await readObject(context);
    const input: AddImageRepositoryInput = {
      repository: requireImageRepository(body.repository),
    };
    return context.json({ repository: repositories.add(input) }, 201);
  });
  app.post("/image-repositories/:id/sync", (context) => {
    const id = requireRepositoryId(context.req.param("id"));
    const repository = repositories.list().find((candidate) => candidate.id === id);
    if (!repository) {
      throw new ExpectedError(
        "image_repository_not_found",
        "이미지 저장소를 찾을 수 없습니다.",
        404,
      );
    }
    const operation = enqueue(context, {
      kind: "image.repository.sync",
      locks: [`image-repository:${id}`],
      run: (progress) => repositories.sync(id, progress),
      successMessage: `${repository.repository} 저장소를 동기화했습니다.`,
      target: { id, name: repository.repository, resource: "imageRepository" },
      title: "이미지 저장소 동기화",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/image-repositories/:id", (context) => {
    const id = requireRepositoryId(context.req.param("id"));
    repositories.remove(id);
    return context.json({ repository: { id } });
  });
}
