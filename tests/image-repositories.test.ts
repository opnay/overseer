import { describe, expect, it, vi } from "vitest";
import {
  ImageRepositoryService,
  MemoryImageRepositoryStore,
  SqliteImageRepositoryStore,
} from "../src/server/modules/image-repositories/index.ts";

describe("ImageRepositoryService", () => {
  it("stores, synchronizes, and removes Docker Hub repositories", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            count: 42,
            results: [
              {
                full_size: 1_000,
                images: [{ architecture: "arm64", os: "linux" }],
                last_updated: "2026-08-27T01:00:00.000Z",
                name: "latest",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const times = ["2026-08-27T00:00:00.000Z", "2026-08-27T02:00:00.000Z"];
    const service = new ImageRepositoryService(
      new MemoryImageRepositoryStore(),
      fetcher,
      () => times.shift()!,
      () => "11111111-1111-4111-8111-111111111111",
    );

    const repository = service.add({ provider: "docker-hub", repository: "library/nginx" });
    expect(repository).toMatchObject({ repository: "library/nginx" });
    expect(repository).not.toHaveProperty("tagCount");
    expect(() => service.add({ provider: "docker-hub", repository: "library/nginx" })).toThrow(
      "이미 등록된 이미지 저장소",
    );

    await service.sync(repository.id);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/v2/namespaces/library/repositories/nginx/tags" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(service.list()[0]).toMatchObject({
      lastSyncedAt: "2026-08-27T02:00:00.000Z",
      tagCount: 42,
    });

    service.remove(repository.id);
    expect(service.list()).toEqual([]);
  });

  it("persists repository synchronization metadata in SQLite", () => {
    const store = new SqliteImageRepositoryStore({ databasePath: ":memory:" });
    store.add({
      createdAt: "2026-08-27T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      provider: "docker-hub",
      repository: "opnay/overseer",
    });
    store.updateSync("11111111-1111-4111-8111-111111111111", "2026-08-27T01:00:00.000Z", 7);

    expect(store.list()).toEqual([
      {
        createdAt: "2026-08-27T00:00:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        lastSyncedAt: "2026-08-27T01:00:00.000Z",
        provider: "docker-hub",
        repository: "opnay/overseer",
        tagCount: 7,
      },
    ]);
    store.close();
  });
});
