import type { Hono } from "hono";
import type { AddImageRepositoryInput } from "../../../shared/contracts.ts";
import type { ImageRepositoryController } from "../../modules/image-repositories/index.ts";
import { ExpectedError } from "../../core/errors.ts";
import {
  requireImageRepository,
  requireImageRepositoryIdentifier,
  requireImageTag,
} from "../../core/validation.ts";
import { readObject, requirePageNumber, type EnqueueApiOperation } from "../http.ts";

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
  app.get("/image-repositories/:id/metadata", async (context) => {
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
    return context.json({ metadata: await repositories.getMetadata(id) });
  });
  app.get("/image-repositories/:id/tags", async (context) => {
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
    const page = requirePageNumber(context.req.query("page"));
    const sort = context.req.query("sort");
    if (
      sort !== undefined &&
      sort !== "tag" &&
      sort !== "-tag" &&
      sort !== "lastUpdated" &&
      sort !== "-lastUpdated"
    ) {
      throw new ExpectedError(
        "invalid_image_repository_tag_sort",
        "태그 정렬 기준을 확인하십시오.",
        400,
      );
    }
    const tag = context.req.query("filter[tag]")?.trim();
    const digest = context.req.query("filter[digest]")?.trim();
    const search = context.req.query("filter[search]")?.trim();
    const unsupportedFilter = Object.keys(context.req.query()).some(
      (key) =>
        key.startsWith("filter[") &&
        !["filter[tag]", "filter[digest]", "filter[search]"].includes(key),
    );
    if (
      unsupportedFilter ||
      (tag?.length ?? 0) > 128 ||
      [digest, search].some((value) => (value?.length ?? 0) > 256)
    ) {
      throw new ExpectedError(
        "invalid_image_repository_tag_filter",
        "태그 검색 조건을 확인하십시오.",
        400,
      );
    }
    const tags = await repositories.getTags(id, page, { filter: { tag, digest, search }, sort });
    return context.json({ tags }, tags.digestIndex ? 202 : 200);
  });
  app.patch("/image-repositories/:id/tags/:tag/favorite", async (context) => {
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
    const tag = requireImageTag(context.req.param("tag"));
    const body = await readObject(context);
    if (typeof body.favorite !== "boolean") {
      throw new ExpectedError(
        "invalid_image_repository_favorite",
        "즐겨찾기 상태를 확인하십시오.",
        400,
      );
    }
    return context.json({ tag: repositories.setFavorite(id, tag, body.favorite) });
  });
  app.get("/image-repositories/:id", (context) => {
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
    return context.json({ repository: repositories.get(id) });
  });
  app.post("/image-repositories/:id/sync", (context) => {
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
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
    const id = requireImageRepositoryIdentifier(context.req.param("id"));
    repositories.remove(id);
    return context.json({ repository: { id } });
  });
}
