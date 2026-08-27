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
        { favorite: false, name: "latest" },
        { favorite: false, name: "v1" },
        { favorite: true, name: "v2" },
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
