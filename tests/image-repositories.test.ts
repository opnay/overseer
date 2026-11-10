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

function withoutDigestHeader(fetcher: typeof fetch): typeof fetch {
  return (input, init) =>
    init?.method === "GET" ? Promise.resolve(new Response(null)) : fetcher(input, init);
}

async function completeTags(
  service: ImageRepositoryService,
  ...args: Parameters<ImageRepositoryService["getTags"]>
) {
  let result = await service.getTags(...args);
  for (let attempt = 0; result.digestIndex && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    result = await service.getTags(...args);
  }
  expect(result.digestIndex).toBeUndefined();
  return result;
}

describe("ImageRepositoryService", () => {
  it("returns hash-index progress without blocking other queries or expiring active work", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const names = Array.from({ length: 30 }, (_, index) => `tag${index}`);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "GET") return new Response(JSON.stringify({ tags: names }));
      await gate;
      const name = new URL(String(input)).pathname.split("/").at(-1);
      return new Response(null, {
        headers: {
          "docker-content-digest": `sha256:${name === "tag29" ? "a".repeat(64) : "b".repeat(64)}`,
        },
      });
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    const query = { filter: { search: `sha256:${"a".repeat(64)}` } };
    const accepted = await service.getTags(repository.id, 1, query);
    expect(accepted.digestIndex).toEqual({ completed: 0, total: 30 });
    clock.mockReturnValue(61_000);
    expect(
      (await service.getTags(repository.id, 1, { filter: { tag: "not-present" } })).count,
    ).toBe(0);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method !== "GET")).toHaveLength(1);
    release();
    const result = await completeTags(service, repository.id, 1, query);
    expect(result.tags.map(({ name }) => name)).toEqual(["tag29"]);
    expect(fetcher).toHaveBeenCalledTimes(31);
  });

  it("avoids building the digest index for name-only searches and cancels it on removal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let block = false;
    const names = Array.from({ length: 60 }, (_, index) => `trixie-${index}`);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "GET") return new Response(JSON.stringify({ tags: names }));
      if (block) await gate;
      return new Response(null, {
        headers: { "docker-content-digest": `sha256:${"c".repeat(64)}` },
      });
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    const named = await service.getTags(repository.id, 1, { filter: { search: "TrIxIe" } });
    expect(named.digestIndex).toBeUndefined();
    expect(named.count).toBe(60);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(25);
    block = true;
    expect(
      (await service.getTags(repository.id, 1, { filter: { search: "sha256:cc" } })).digestIndex,
    ).toBeDefined();
    service.remove(repository.id);
    const beforeRelease = fetcher.mock.calls.length;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(beforeRelease);
  });

  it("refreshes an expired anonymous registry token once when resolving manifests", async () => {
    let tokens = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/token")
        return new Response(JSON.stringify({ token: `token-${++tokens}` }));
      const authorization = new Headers(init?.headers).get("authorization");
      if (!authorization || (init?.method === "GET" && authorization === "Bearer token-1")) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
          },
        });
      }
      return init?.method === "GET"
        ? new Response(null, { headers: { "docker-content-digest": `sha256:${"a".repeat(64)}` } })
        : new Response(JSON.stringify({ tags: ["latest"] }));
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    expect((await service.getTags(repository.id, 1)).tags[0]?.digest).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(tokens).toBe(2);
  });

  it("loads and searches OCI registries beyond one thousand tags", async () => {
    const names = Array.from(
      { length: 1200 },
      (_, index) => `tag${String(index).padStart(4, "0")}`,
    );
    const digest = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}`;
    const manifestRequests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "GET") {
        const name = url.pathname.split("/").at(-1)!;
        manifestRequests.push(name);
        return new Response(null, {
          headers: { "docker-content-digest": digest(names.indexOf(name)) },
        });
      }
      const last = url.searchParams.get("last");
      const start = last ? names.indexOf(last) + 1 : 0;
      const page = names.slice(start, start + Number(url.searchParams.get("n")));
      return new Response(JSON.stringify({ tags: page }), {
        headers:
          start + page.length < names.length
            ? { link: `</v2/library/node/tags/list?n=1000&last=${page.at(-1)}>; rel="next"` }
            : {},
      });
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    service.setFavorite(repository.id, "tag1199", true);
    const page = await completeTags(service, repository.id, 1);
    expect(page).toMatchObject({ count: 1200 });
    expect(page.tags[0]).toEqual({ name: "tag1199", digest: digest(1199), favorite: true });
    expect(page.tags).toHaveLength(25);
    expect(manifestRequests).toHaveLength(25);
    const found = await completeTags(service, repository.id, 1, {
      filter: { search: digest(1100) },
    });
    expect(found).toMatchObject({
      count: 1,
      totalCount: 1200,
      tags: [{ name: "tag1100", digest: digest(1100) }],
    });
    expect(manifestRequests).toHaveLength(1200);
  });

  it.each(["registry.example.com/library/node", "ghcr.io/opnay/overseer"])(
    "rejects invalid remote tag names before manifest lookup for %s",
    async (address) => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ tags: ["../other"] })));
      const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
      const repository = service.add({ repository: address });
      await expect(completeTags(service, repository.id, 1)).rejects.toThrow(
        "응답을 해석하지 못했습니다",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects registry pagination that never terminates", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ tags: ["latest"] }), {
          headers: { link: '</v2/library/node/tags/list?n=100&last=latest>; rel="next"' },
        }),
    );
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    await expect(completeTags(service, repository.id, 1)).rejects.toThrow("태그가 너무 많아");
    expect(fetcher).toHaveBeenCalledTimes(100);
  });

  it("searches shared root manifest digests and requests multi-platform manifest types", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const platformDigest = `sha256:${"b".repeat(64)}`;
    const names = Array.from({ length: 105 }, (_, index) => `tag${index}`);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        const accept = new Headers(init.headers).get("accept");
        expect(accept).toContain("application/vnd.oci.image.index.v1+json");
        expect(accept).toContain("application/vnd.docker.distribution.manifest.list.v2+json");
        const index = Number(new URL(String(input)).pathname.split("/").at(-1)?.slice(3));
        return new Response(null, {
          headers: { "docker-content-digest": index >= 100 ? digest : `sha256:${"c".repeat(64)}` },
        });
      }
      return new Response(JSON.stringify({ tags: names }));
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/library/node" });
    service.setFavorite(repository.id, "tag104", true);
    const result = await completeTags(service, repository.id, 1, {
      sort: "-tag",
      filter: { search: digest.toUpperCase() },
    });
    expect(result).toMatchObject({ count: 5, totalCount: 105 });
    expect(result.tags.map(({ name }) => name)).toEqual([
      "tag104",
      "tag103",
      "tag102",
      "tag101",
      "tag100",
    ]);
    expect(result.tags.every((tag) => tag.digest === digest)).toBe(true);
    expect(
      (await completeTags(service, repository.id, 1, { filter: { search: "TAG104" } })).tags,
    ).toEqual([{ name: "tag104", digest, favorite: true }]);
    expect(
      (await completeTags(service, repository.id, 1, { filter: { digest: platformDigest } })).count,
    ).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(106);
  });

  it("loads OCI digests for the visible page and searches hashes beyond it without fetching twice", async () => {
    const names = Array.from({ length: 60 }, (_, index) => `tag${String(index).padStart(2, "0")}`);
    const digest = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}`;
    const manifestRequests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "GET") {
        const name = url.pathname.split("/").at(-1)!;
        manifestRequests.push(name);
        return new Response(null, {
          headers: { "docker-content-digest": digest(names.indexOf(name)) },
        });
      }
      return new Response(JSON.stringify({ tags: names }));
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });
    service.setFavorite(repository.id, "tag59", true);
    const page = await completeTags(service, repository.id, 1);
    expect(page.tags[0]).toEqual({ name: "tag59", digest: digest(59), favorite: true });
    expect(manifestRequests).toHaveLength(25);
    const found = await completeTags(service, repository.id, 1, { filter: { search: digest(48) } });
    expect(found).toMatchObject({
      count: 1,
      totalCount: 60,
      tags: [{ name: "tag48", digest: digest(48), favorite: false }],
    });
    expect(new Set(manifestRequests).size).toBe(60);
    expect(manifestRequests).toHaveLength(60);
    expect(
      (
        await completeTags(service, repository.id, 1, {
          filter: { tag: "tag59", digest: digest(48) },
        })
      ).count,
    ).toBe(0);
    await completeTags(service, repository.id, 1, { sort: "-tag" });
    expect(manifestRequests).toHaveLength(60);
  });

  it("reports manifest lookup failures and retries without returning a false empty search result", async () => {
    let fail = true;
    const digest = `sha256:${"d".repeat(64)}`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "GET") return new Response(JSON.stringify({ tags: ["latest"] }));
      if (fail) {
        fail = false;
        return new Response(null, { status: 503 });
      }
      return new Response(null, { headers: { "docker-content-digest": digest } });
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });
    await expect(
      completeTags(service, repository.id, 1, { filter: { search: digest } }),
    ).rejects.toThrow("해시");
    expect(
      (await completeTags(service, repository.id, 1, { filter: { search: digest } })).tags[0]
        ?.digest,
    ).toBe(digest);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries failed tag loads, shares pending loads, expires the cache, and refreshes on sync", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v1"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v2"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: ["v3"] })));
    const service = new ImageRepositoryService(
      new MemoryImageRepositoryStore(),
      withoutDigestHeader(fetcher),
    );
    const repository = service.add({ repository: "ghcr.io/opnay/overseer" });

    await expect(completeTags(service, repository.id, 1)).rejects.toThrow();
    const pages = await Promise.all([
      completeTags(service, repository.id, 1),
      completeTags(service, repository.id, 1),
    ]);
    expect(pages.map(({ tags }) => tags)).toEqual([
      [{ favorite: false, name: "v1" }],
      [{ favorite: false, name: "v1" }],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(60_001);
    expect((await completeTags(service, repository.id, 1)).tags[0]?.name).toBe("v2");
    await service.sync(repository.id);
    expect((await completeTags(service, repository.id, 1)).tags[0]?.name).toBe("v3");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(["registry.example.com/library/nginx", "ghcr.io/opnay/overseer"])(
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
      const store = new MemoryImageRepositoryStore();
      const service = new ImageRepositoryService(store, withoutDigestHeader(fetcher));
      const expectedRequests = 2;
      const repository = service.add({ repository: address });
      service.setFavorite(repository.id, "tag54", true);
      service.setFavorite(repository.id, "tag50", true);
      service.setFavorite(repository.id, "removed", true);

      const ascending = await completeTags(service, repository.id, 1);
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
      const second = await completeTags(service, repository.id, 2);
      const third = await completeTags(service, repository.id, 3);
      const allNames = [...ascending.tags, ...second.tags, ...third.tags].map(({ name }) => name);
      expect(allNames).toHaveLength(55);
      expect(new Set(allNames)).toEqual(new Set(names));

      const descending = await completeTags(service, repository.id, 1, { sort: "-tag" });
      expect(descending.tags.map(({ name }) => name)).toEqual([
        "tag54",
        "tag50",
        "tag53",
        "tag52",
        "tag51",
        ...names.slice(30, 50).reverse(),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(expectedRequests);
      expect(new URL(String(fetcher.mock.calls[0]![0])).hostname).toBe(address.split("/")[0]);

      service.setFavorite(repository.id, "tag54", false);
      const updated = await completeTags(service, repository.id, 1);
      expect(updated.tags.slice(0, 2)).toEqual([
        { favorite: true, name: "tag50" },
        { favorite: false, name: "tag00" },
      ]);
      expect(fetcher).toHaveBeenCalledTimes(expectedRequests);
      const filtered = await completeTags(service, repository.id, 1, {
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
      expect(
        (await completeTags(service, repository.id, 2, { filter: { tag: "tag5" } })).tags,
      ).toEqual([]);
      expect(await completeTags(service, repository.id, 1, { filter: { tag: "." } })).toMatchObject(
        {
          count: 0,
          tags: [],
        },
      );
      expect((await completeTags(service, repository.id, 1, { filter: { tag: "  " } })).count).toBe(
        55,
      );
      for (const name of names.slice(28))
        store.setFavorite(repository.id, name, true, "2026-11-01T00:00:00Z");
      const favoritePage = await completeTags(service, repository.id, 1);
      const overflowPage = await completeTags(service, repository.id, 2);
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
            count: 42,
            next: null,
            results: Array.from({ length: 42 }, (_, index) => ({ name: `tag${index}` })),
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
        hostname: "hub.docker.com",
        pathname: "/v2/namespaces/library/repositories/nginx/tags",
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
    await expect(completeTags(service, repository.id, 1)).resolves.toMatchObject({
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

it("limits favorites per repository while preserving existing favorites and removals", () => {
  const store = new MemoryImageRepositoryStore();
  const service = new ImageRepositoryService(store);
  const repository = service.add({ repository: "docker.io/library/node" });
  const other = service.add({ repository: "docker.io/library/nginx" });
  for (let index = 0; index < 10; index++) service.setFavorite(repository.id, `v${index}`, true);
  expect(() => service.setFavorite(repository.id, "eleventh", true)).toThrow(
    "즐겨찾기는 저장소당 최대 10개까지 추가할 수 있습니다.",
  );
  expect(service.get(repository.id).favoriteTags).toHaveLength(10);
  expect(service.setFavorite(repository.id, "v0", true)).toEqual({ favorite: true, name: "v0" });
  service.setFavorite(other.id, "latest", true);
  service.setFavorite(repository.id, "v0", false);
  service.setFavorite(repository.id, "replacement", true);
  expect(service.get(repository.id)).toMatchObject({ favoriteCount: 10 });
  store.setFavorite(repository.id, "legacy-overflow", true, "2026-11-01T00:00:00Z");
  expect(service.get(repository.id).favoriteTags).toContain("legacy-overflow");
  expect(() => service.setFavorite(repository.id, "another", true)).toThrow();
  service.setFavorite(repository.id, "legacy-overflow", false);
  expect(service.get(repository.id).favoriteCount).toBe(10);
});
