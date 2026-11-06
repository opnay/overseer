import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ImageRepositoryService,
  MemoryImageRepositoryStore,
  SqliteImageRepositoryStore,
} from "../src/server/modules/image-repositories/index.ts";
import { openSqliteDatabase } from "../src/server/infrastructure/sqlite.ts";

describe("ImageRepositoryService", () => {
  it("retries failed tag loads, shares pending loads, expires the cache, and refreshes on sync", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v1"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v2"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v3"] })));
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });

    await expect(service.getTags(repository.id, 1)).rejects.toThrow();
    const pages = await Promise.all([
      service.getTags(repository.id, 1),
      service.getTags(repository.id, 1),
    ]);
    expect(pages.map(({ tags }) => tags)).toEqual([
      [{ favorite: false, name: "v1" }],
      [{ favorite: false, name: "v1" }],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(60_001);
    expect((await service.getTags(repository.id, 1)).tags[0]?.name).toBe("v2");
    await service.sync(repository.id);
    expect((await service.getTags(repository.id, 1)).tags[0]?.name).toBe("v3");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(["docker.io/library/nginx", "ghcr.io/opnay/overseer"])(
    "sorts favorites before pagination and orders tags in both directions for %s",
    async (address) => {
      const names = Array.from(
        { length: 55 },
        (_, index) => `tag${String(index).padStart(2, "0")}`,
      );
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const secondPage = url.searchParams.has("last");
        return new Response(
          JSON.stringify({ tags: secondPage ? names.slice(30) : names.slice(0, 30) }),
          {
            headers: secondPage ? {} : { link: `<${url.pathname}?n=100&last=tag29>; rel="next"` },
          },
        );
      });
      const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
      const repository = service.add({ repository: address });
      service.setFavorite(repository.id, "tag54", true);
      service.setFavorite(repository.id, "tag50", true);
      service.setFavorite(repository.id, "removed", true);

      const ascending = await service.getTags(repository.id, 1);
      expect(ascending).toMatchObject({ count: 55, page: 1, pageSize: 25 });
      expect(ascending.tags.map(({ name }) => name)).toEqual([
        "tag50",
        "tag54",
        ...names.slice(0, 23),
      ]);
      expect(ascending.tags.filter(({ favorite }) => favorite).map(({ name }) => name)).toEqual([
        "tag50",
        "tag54",
      ]);
      const second = await service.getTags(repository.id, 2);
      const third = await service.getTags(repository.id, 3);
      const allNames = [...ascending.tags, ...second.tags, ...third.tags].map(({ name }) => name);
      expect(allNames).toHaveLength(55);
      expect(new Set(allNames)).toEqual(new Set(names));

      const descending = await service.getTags(repository.id, 1, { sort: "-tag" });
      expect(descending.tags.map(({ name }) => name)).toEqual([
        "tag54",
        "tag50",
        "tag53",
        "tag52",
        "tag51",
        ...names.slice(30, 50).reverse(),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(new URL(String(fetcher.mock.calls[0]![0])).hostname).toBe(
        address.startsWith("docker.io/") ? "registry-1.docker.io" : "ghcr.io",
      );

      service.setFavorite(repository.id, "tag54", false);
      const updated = await service.getTags(repository.id, 1);
      expect(updated.tags.slice(0, 2)).toEqual([
        { favorite: true, name: "tag50" },
        { favorite: false, name: "tag00" },
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const filtered = await service.getTags(repository.id, 1, {
        filter: { tag: " TAG5 " },
        sort: "-tag",
      });
      expect(filtered).toMatchObject({ count: 5, totalCount: 55, page: 1 });
      expect(filtered.tags).toEqual([
        { favorite: true, name: "tag50" },
        { favorite: false, name: "tag54" },
        { favorite: false, name: "tag53" },
        { favorite: false, name: "tag52" },
        { favorite: false, name: "tag51" },
      ]);
      expect((await service.getTags(repository.id, 2, { filter: { tag: "tag5" } })).tags).toEqual(
        [],
      );
      expect(await service.getTags(repository.id, 1, { filter: { tag: "." } })).toMatchObject({
        count: 0,
        tags: [],
      });
      expect((await service.getTags(repository.id, 1, { filter: { tag: "  " } })).count).toBe(55);
      for (const name of names.slice(28)) service.setFavorite(repository.id, name, true);
      const favoritePage = await service.getTags(repository.id, 1);
      const overflowPage = await service.getTags(repository.id, 2);
      expect(favoritePage.tags).toHaveLength(25);
      expect(favoritePage.tags.every(({ favorite }) => favorite)).toBe(true);
      expect(overflowPage.tags.slice(0, 3)).toEqual([
        { favorite: true, name: "tag53" },
        { favorite: true, name: "tag54" },
        { favorite: false, name: "tag00" },
      ]);
    },
  );

  it("stores, synchronizes, and removes Docker Hub repositories", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tags: Array.from({ length: 42 }, (_, index) => `tag${index}`),
          }),
          { status: 200 },
        ),
    );
    const times = [
      "2026-08-27T00:00:00.000Z",
      "2026-08-27T02:00:00.000Z",
      "2026-08-27T03:00:00.000Z",
    ];
    const service = new ImageRepositoryService(
      new MemoryImageRepositoryStore(),
      fetcher,
      () => times.shift()!,
      () => "11111111-1111-4111-8111-111111111111",
    );

    const repository = service.add({ repository: "docker.io/library/nginx" });
    expect(repository).toMatchObject({ repository: "docker.io/library/nginx" });
    expect(repository).not.toHaveProperty("tagCount");
    expect(() => service.add({ repository: "docker.io/library/nginx" })).toThrow(
      "이미 등록된 이미지 저장소",
    );

    await service.sync(repository.id);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "registry-1.docker.io",
        pathname: "/v2/library/nginx/tags/list",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(service.list()[0]).toMatchObject({
      lastSyncedAt: "2026-08-27T02:00:00.000Z",
      tagCount: 42,
    });

    service.remove(repository.id);
    expect(service.list()).toEqual([]);
  });

  it("synchronizes public OCI registries with bearer authentication and pagination", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/token") {
        return new Response(JSON.stringify({ token: "public-token" }), { status: 200 });
      }
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (!authorization) {
        return new Response(undefined, {
          headers: {
            "www-authenticate":
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:opnay/overseer:pull"',
          },
          status: 401,
        });
      }
      if (!url.searchParams.has("last")) {
        return new Response(JSON.stringify({ name: "opnay/overseer", tags: ["latest", "v1"] }), {
          headers: {
            link: '</v2/opnay/overseer/tags/list?n=100&last=v1>; rel="next"',
          },
          status: 200,
        });
      }
      return new Response(JSON.stringify({ name: "opnay/overseer", tags: ["v2"] }), {
        status: 200,
      });
    });
    const times = ["2026-08-27T00:00:00.000Z", "2026-08-27T02:00:00.000Z"];
    const service = new ImageRepositoryService(
      new MemoryImageRepositoryStore(),
      fetcher,
      () => times.shift()!,
      () => "11111111-1111-4111-8111-111111111111",
    );
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });

    await service.sync(repository.id);
    expect(service.setFavorite(repository.id, "v2", true)).toEqual({ favorite: true, name: "v2" });
    await expect(service.getTags(repository.id, 1)).resolves.toMatchObject({
      count: 3,
      repository: "ghcr.io/opnay/overseer",
      tags: [
        { favorite: true, name: "v2" },
        { favorite: false, name: "latest" },
        { favorite: false, name: "v1" },
      ],
    });

    expect(service.get(repository.id)).toMatchObject({
      favoriteCount: 1,
      lastSyncedAt: "2026-08-27T02:00:00.000Z",
      repository: "ghcr.io/opnay/overseer",
      tagCount: 3,
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "ghcr.io", pathname: "/v2/opnay/overseer/tags/list" }),
      expect.objectContaining({ headers: { authorization: "Bearer public-token" } }),
    );
  });

  it("migrates Docker Hub provider rows to canonical registry addresses", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "overseer-image-repositories-"));
    const databasePath = join(dataDirectory, "overseer.sqlite");
    const legacy = openSqliteDatabase(databasePath);
    legacy.exec(`
      CREATE TABLE image_repositories (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider = 'docker-hub'),
        repository TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_synced_at TEXT,
        tag_count INTEGER,
        UNIQUE (provider, repository)
      );
      INSERT INTO image_repositories
        (id, provider, repository, created_at, last_synced_at, tag_count)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'docker-hub', 'library/nginx',
         '2026-08-27T00:00:00.000Z', '2026-08-27T01:00:00.000Z', 7);
    `);
    legacy.close();
    const store = new SqliteImageRepositoryStore({ dataDirectory, databasePath });
    try {
      expect(store.list()).toEqual([
        {
          createdAt: "2026-08-27T00:00:00.000Z",
          id: "11111111-1111-4111-8111-111111111111",
          lastSyncedAt: "2026-08-27T01:00:00.000Z",
          repository: "docker.io/library/nginx",
          tagCount: 7,
        },
      ]);
      expect(() =>
        store.add({
          createdAt: "2026-08-27T03:00:00.000Z",
          id: "22222222-2222-4222-8222-222222222222",
          repository: "ghcr.io/opnay/overseer",
        }),
      ).not.toThrow();
      store.setFavorite(
        "22222222-2222-4222-8222-222222222222",
        "latest",
        true,
        "2026-08-27T04:00:00.000Z",
      );
      expect(store.favoriteTags("22222222-2222-4222-8222-222222222222")).toEqual(["latest"]);
      store.remove("22222222-2222-4222-8222-222222222222");
      expect(store.favoriteTags("22222222-2222-4222-8222-222222222222")).toEqual([]);
    } finally {
      store.close();
      rmSync(dataDirectory, { force: true, recursive: true });
    }
  });
});
