import { describe, expect, it, vi } from "vitest";
import {
  ImageRepositoryService,
  MemoryImageRepositoryStore,
} from "../src/server/modules/image-repositories/index.ts";

describe("image repository metadata", () => {
  it("maps Docker Hub description and date, deduplicates requests and expires cached metadata", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            description: " Short description ",
            full_description: "# README\n\nDetails",
            last_updated: "2026-11-06T02:41:19Z",
          }),
        ),
    );
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "docker.io/library/node" });
    const results = await Promise.all([
      service.getMetadata(repository.id),
      service.getMetadata(repository.id),
    ]);
    expect(results[0]).toEqual({
      description: "Short description",
      fullDescription: "# README\n\nDetails",
      lastUpdated: "2026-11-06T02:41:19Z",
    });
    expect(results[1]).toEqual(results[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://hub.docker.com/v2/namespaces/library/repositories/node"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await service.getMetadata(repository.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(60_001);
    await service.getMetadata(repository.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("allows retry after failures and handles missing descriptions or invalid dates", async () => {
    let failing = true;
    const fetcher = vi.fn(async () =>
      failing
        ? new Response("Unavailable", { status: 503 })
        : new Response(
            JSON.stringify({ description: "", full_description: null, last_updated: "not-a-date" }),
          ),
    );
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "docker.io/library/node" });
    await expect(service.getMetadata(repository.id)).rejects.toMatchObject({
      code: "image_repository_metadata_unavailable",
      status: 503,
    });
    failing = false;
    await expect(service.getMetadata(repository.id)).resolves.toEqual({
      description: undefined,
      fullDescription: undefined,
      lastUpdated: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(service.get(repository.id).favoriteCount).toBe(0);
  });

  it("does not call Docker Hub for other registries and preserves missing repository errors", async () => {
    const fetcher = vi.fn();
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });
    await expect(service.getMetadata(repository.id)).resolves.toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => service.getMetadata("missing")).toThrow("이미지 저장소를 찾을 수 없습니다.");
  });
});
