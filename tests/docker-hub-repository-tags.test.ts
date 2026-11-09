import { describe, expect, it, vi } from "vitest";
import {
  ImageRepositoryService,
  MemoryImageRepositoryStore,
} from "../src/server/modules/image-repositories/index.ts";

function hubFixture(count = 1200) {
  const items = Array.from({ length: count }, (_, index) => ({
    name: `tag${String(index).padStart(4, "0")}`,
    last_updated: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    images: [
      { os: "linux", architecture: "amd64" },
      { os: "linux", architecture: "arm64", variant: "v8" },
      { os: "linux", architecture: "amd64" },
      { os: "unknown", architecture: "unknown" },
    ],
  }));
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("hub.docker.com");
    if (!url.pathname.endsWith("/tags")) {
      const item = items.find(
        ({ name }) => name === decodeURIComponent(url.pathname.split("/").at(-1)!),
      );
      return new Response(JSON.stringify(item ?? {}), { status: item ? 200 : 404 });
    }
    const sort = url.searchParams.get("ordering");
    const sorted = [...items].sort((a, b) =>
      sort?.includes("name")
        ? a.name.localeCompare(b.name)
        : Date.parse(a.last_updated) - Date.parse(b.last_updated),
    );
    if (sort === "last_updated" || sort === "name") sorted.reverse();
    const page = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("page_size"));
    return new Response(
      JSON.stringify({
        count,
        next: page * size < count ? "next" : null,
        results: sorted.slice((page - 1) * size, page * size),
      }),
    );
  });
  const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
  const repository = service.add({ repository: "docker.io/library/node" });
  return { service, repository, fetcher, items };
}

describe("Docker Hub repository metadata", () => {
  it("reads OCI index platforms and single-image config without using build time as a tag date", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("tags/list"))
        return new Response(JSON.stringify({ tags: ["index", "single"] }));
      if (path.includes("/blobs/"))
        return new Response(
          JSON.stringify({
            os: "linux",
            architecture: "arm64",
            variant: "v8",
            created: "2026-11-01T00:00:00Z",
          }),
        );
      return new Response(
        JSON.stringify(
          path.endsWith("/index")
            ? {
                manifests: [
                  { platform: { os: "linux", architecture: "amd64" } },
                  { platform: { os: "unknown", architecture: "unknown" } },
                ],
              }
            : { config: { digest } },
        ),
        { headers: { "docker-content-digest": digest } },
      );
    });
    const service = new ImageRepositoryService(new MemoryImageRepositoryStore(), fetcher);
    const repository = service.add({ repository: "ghcr.io/team/app" });
    const result = await service.getTags(repository.id, 1);
    expect(result.tags).toEqual([
      { name: "index", favorite: false, digest, platforms: ["linux/amd64"] },
      { name: "single", favorite: false, digest, platforms: ["linux/arm64/v8"] },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("defaults to latest dates, pins old favorites, and lazily fills pages without duplicates", async () => {
    const { service, repository, fetcher, items } = hubFixture();
    service.setFavorite(repository.id, "tag0000", true);
    service.setFavorite(repository.id, "deleted", true);
    const first = await service.getTags(repository.id, 1);
    expect(first).toMatchObject({ count: 1200, pageSize: 25 });
    expect(first.tags[0]).toMatchObject({
      name: "tag0000",
      favorite: true,
      lastUpdated: items[0]!.last_updated,
      platforms: ["linux/amd64", "linux/arm64/v8"],
    });
    expect(first.tags.slice(1).map(({ name }) => name)).toEqual(
      items
        .slice(-24)
        .reverse()
        .map(({ name }) => name),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const second = await service.getTags(repository.id, 2);
    expect(second.tags[0]?.name).toBe("tag1175");
    expect(new Set([...first.tags, ...second.tags].map(({ name }) => name)).size).toBe(50);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const fifth = await service.getTags(repository.id, 5);
    expect(fifth.tags[0]?.name).toBe("tag1100");
    expect(fetcher).toHaveBeenCalledTimes(4);
    service.setFavorite(repository.id, "tag0000", false);
    expect((await service.getTags(repository.id, 1)).tags[0]?.name).toBe("tag1199");
    await service.sync(repository.id);
    expect(service.list()[0]).toMatchObject({ official: true, tagCount: 1200 });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("sorts dates in both directions and keeps overflowing favorites before ordinary tags", async () => {
    const { service, repository } = hubFixture(130);
    for (let index = 0; index < 27; index++)
      service.setFavorite(repository.id, `tag${String(index).padStart(4, "0")}`, true);
    const first = await service.getTags(repository.id, 1, { sort: "lastUpdated" });
    expect(first.tags.every(({ favorite }) => favorite)).toBe(true);
    const second = await service.getTags(repository.id, 2, { sort: "lastUpdated" });
    expect(second.tags.slice(0, 3).map(({ name, favorite }) => ({ name, favorite }))).toEqual([
      { name: "tag0025", favorite: true },
      { name: "tag0026", favorite: true },
      { name: "tag0027", favorite: false },
    ]);
    const descending = await service.getTags(repository.id, 1, { sort: "-lastUpdated" });
    expect(descending.tags[0]?.name).toBe("tag0026");
    const named = await service.getTags(repository.id, 1, { sort: "tag" });
    expect(named.tags[0]?.name).toBe("tag0000");
    const reversed = await service.getTags(repository.id, 1, { sort: "-tag" });
    expect(reversed.tags[0]?.name).toBe("tag0026");
  });

  it("limits Official to Docker Hub library and rejects unavailable date sorting", async () => {
    const service = new ImageRepositoryService();
    for (const repository of [
      "docker.io/library/node",
      "docker.io/team/node",
      "ghcr.io/library/node",
      "quay.io/library/node",
    ])
      service.add({ repository });
    expect(service.list().map(({ official }) => official)).toEqual([true, false, false, false]);
    const other = service.list().find(({ repository }) => repository.startsWith("ghcr.io"))!;
    await expect(service.getTags(other.id, 1, { sort: "-lastUpdated" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reports anonymous limits and retries failed page loads without treating them as empty results", async () => {
    const fixture = hubFixture(30);
    fixture.fetcher.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await expect(fixture.service.getTags(fixture.repository.id, 1)).rejects.toThrow("인증");
    expect((await fixture.service.getTags(fixture.repository.id, 1)).tags).toHaveLength(25);
  });
});
