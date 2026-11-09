import type { ImageRepositoryTagList, ImageRepositoryTagSort } from "../../../shared/contracts.ts";
import { isImageTag } from "../../../shared/validation.ts";
import { ExpectedError } from "../../core/errors.ts";
import {
  imagePlatforms,
  manifestDigest,
  type RemoteRepositoryTag,
} from "./registry-tag-metadata.ts";

const PAGE_SIZE = 25;
const REMOTE_PAGE_SIZE = 100;
const ordering = {
  tag: "-name",
  "-tag": "name",
  lastUpdated: "-last_updated",
  "-lastUpdated": "last_updated",
};

interface TagPages {
  tags: RemoteRepositoryTag[];
  count: number;
  next: number | undefined;
  loading?: Promise<void>;
}

function parseTag(value: unknown): RemoteRepositoryTag {
  const source = value as Record<string, unknown> | null;
  if (!source || typeof source.name !== "string" || !isImageTag(source.name)) {
    throw new ExpectedError(
      "invalid_image_repository_tags",
      "Docker Hub 태그 응답을 해석하지 못했습니다.",
      503,
    );
  }
  const lastUpdated =
    typeof source.last_updated === "string" && Number.isFinite(Date.parse(source.last_updated))
      ? source.last_updated
      : undefined;
  return {
    name: source.name,
    digest: manifestDigest(source.digest),
    lastUpdated,
    platforms: imagePlatforms(source.images),
  };
}

// Cache only the remote pages needed by navigation. Favorites are fetched by exact tag name,
// then excluded from the ordinary stream before pagination to avoid duplicate rows.
export class DockerHubTags {
  private readonly pages = new Map<ImageRepositoryTagSort, TagPages>();
  private readonly favorites = new Map<string, Promise<RemoteRepositoryTag | undefined>>();
  private readonly base: string;
  private readonly repository: string;
  private readonly fetcher: typeof fetch;

  constructor(repository: string, fetcher: typeof fetch) {
    this.repository = repository;
    this.fetcher = fetcher;
    const [namespace, ...name] = repository.replace(/^docker\.io\//, "").split("/");
    this.base = `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace!)}/repositories/${encodeURIComponent(name.join("/"))}/tags`;
  }

  private async request(url: string, missingAllowed = false): Promise<unknown> {
    try {
      const response = await this.fetcher(new URL(url), { signal: AbortSignal.timeout(10_000) });
      if (missingAllowed && response.status === 404) return undefined;
      if (!response.ok) {
        throw new ExpectedError(
          "image_repository_tags_unavailable",
          response.status === 401 || response.status === 403
            ? "Docker Hub가 태그 조회를 제한했습니다. 인증이 필요한 페이지는 아직 조회할 수 없습니다."
            : "Docker Hub 태그 정보를 불러오지 못했습니다.",
          503,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw new ExpectedError(
        "image_repository_tags_unavailable",
        "Docker Hub 태그 정보를 불러오지 못했습니다.",
        503,
      );
    }
  }

  private async loadPage(state: TagPages, sort: ImageRepositoryTagSort): Promise<void> {
    if (state.loading) return state.loading;
    if (state.next === undefined) return;
    const url = new URL(this.base);
    url.searchParams.set("page", String(state.next));
    url.searchParams.set("page_size", String(REMOTE_PAGE_SIZE));
    url.searchParams.set("ordering", ordering[sort]);
    const loading = (async () => {
      const source = (await this.request(String(url))) as {
        count?: unknown;
        results?: unknown;
        next?: unknown;
      };
      if (
        !source ||
        !Number.isSafeInteger(source.count) ||
        (source.count as number) < 0 ||
        !Array.isArray(source.results) ||
        source.results.length > REMOTE_PAGE_SIZE ||
        (source.next != null && typeof source.next !== "string")
      ) {
        throw new ExpectedError(
          "invalid_image_repository_tags",
          "Docker Hub 태그 응답을 해석하지 못했습니다.",
          503,
        );
      }
      const tags = source.results.map(parseTag);
      if (source.next && tags.length === 0)
        throw new ExpectedError(
          "invalid_image_repository_tags",
          "Docker Hub 태그 페이지가 비어 있습니다.",
          503,
        );
      const seen = new Set(state.tags.map(({ name }) => name));
      state.tags.push(
        ...tags.filter(({ name }) => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        }),
      );
      state.count = source.count as number;
      state.next = source.next ? state.next! + 1 : undefined;
    })();
    state.loading = loading;
    try {
      await loading;
    } finally {
      state.loading = undefined;
    }
  }

  async list(
    page: number,
    sort: ImageRepositoryTagSort,
    favoriteNames: string[],
  ): Promise<ImageRepositoryTagList> {
    let state = this.pages.get(sort);
    if (!state) {
      state = { tags: [], count: 0, next: 1 };
      this.pages.set(sort, state);
    }
    if (state.tags.length === 0 && state.next !== undefined) await this.loadPage(state, sort);
    const pinned: RemoteRepositoryTag[] = [];
    for (let start = 0; start < favoriteNames.length; start += 8) {
      const items = await Promise.all(
        favoriteNames.slice(start, start + 8).map((name) => {
          const loaded = state.tags.find((tag) => tag.name === name);
          if (loaded) return loaded;
          let pending = this.favorites.get(name);
          if (!pending) {
            pending = this.request(`${this.base}/${encodeURIComponent(name)}`, true).then(
              (value) => (value === undefined ? undefined : parseTag(value)),
            );
            this.favorites.set(name, pending);
            void pending.catch(() => this.favorites.delete(name));
          }
          return pending;
        }),
      );
      pinned.push(...items.filter((item): item is RemoteRepositoryTag => Boolean(item)));
    }
    pinned.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "en");
      if (sort === "tag" || sort === "-tag") return sort === "tag" ? byName : -byName;
      if (!a.lastUpdated || !b.lastUpdated)
        return Number(Boolean(b.lastUpdated)) - Number(Boolean(a.lastUpdated)) || byName;
      const byDate = Date.parse(a.lastUpdated) - Date.parse(b.lastUpdated);
      return (sort === "lastUpdated" ? byDate : -byDate) || byName;
    });
    const favorites = new Set(pinned.map(({ name }) => name));
    const ordinary = () => state.tags.filter(({ name }) => !favorites.has(name));
    const end = page * PAGE_SIZE;
    while (
      pinned.length + ordinary().length < Math.min(end, state.count) &&
      state.next !== undefined
    ) {
      const before = state.tags.length;
      await this.loadPage(state, sort);
      if (before === state.tags.length && state.next !== undefined)
        throw new ExpectedError(
          "invalid_image_repository_tags",
          "Docker Hub 태그 페이지가 진행되지 않습니다.",
          503,
        );
    }
    return {
      count: state.count,
      totalCount: state.count,
      page,
      pageSize: PAGE_SIZE,
      repository: this.repository,
      tags: [...pinned, ...ordinary()]
        .slice((page - 1) * PAGE_SIZE, end)
        .map((tag) => ({ ...tag, favorite: favorites.has(tag.name) })),
    };
  }
}
