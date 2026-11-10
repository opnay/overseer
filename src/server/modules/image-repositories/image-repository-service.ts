import { randomUUID } from "node:crypto";
import type {
  AddImageRepositoryInput,
  ImageRepositoryDetail,
  ImageRepositoryMetadata,
  ImageRepositorySummary,
  ImageRepositoryTagItem,
  ImageRepositoryTagList,
  ImageRepositoryTagQuery,
} from "../../../shared/contracts.ts";
import { IMAGE_REPOSITORY_FAVORITE_LIMIT } from "../../../shared/contracts.ts";
import { parseImageRepository } from "../../../shared/validation.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { OperationProgress } from "../operations/index.ts";
import { MemoryImageRepositoryStore, type ImageRepositoryStore } from "./image-repository-store.ts";
import { getRegistryRepositoryTags, type RegistryRepositoryTags } from "./registry-tags.ts";
import { mayMatchManifestDigest } from "./registry-tag-metadata.ts";
import { getDockerHubMetadata } from "./docker-hub-metadata.ts";
import { DockerHubTags } from "./docker-hub-tags.ts";

const TAG_PAGE_SIZE = 25;
const TAG_CACHE_TTL = 60_000;

interface CachedRegistryTags {
  expiresAt: number;
  tags: Promise<RegistryRepositoryTags>;
  value?: RegistryRepositoryTags;
}

export interface ImageRepositoryController {
  add(input: AddImageRepositoryInput): ImageRepositorySummary;
  get(id: string): ImageRepositoryDetail;
  getMetadata(id: string): Promise<ImageRepositoryMetadata>;
  getTags(
    id: string,
    page: number,
    query?: ImageRepositoryTagQuery,
  ): Promise<ImageRepositoryTagList>;
  list(): ImageRepositorySummary[];
  remove(id: string): void;
  setFavorite(id: string, tag: string, favorite: boolean): ImageRepositoryTagItem;
  sync(id: string, progress?: OperationProgress): Promise<void>;
}

export class ImageRepositoryService implements ImageRepositoryController {
  private readonly fetcher: typeof fetch;
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly store: ImageRepositoryStore;
  private readonly tagCache = new Map<string, CachedRegistryTags>();
  private readonly metadataCache = new Map<
    string,
    { expiresAt: number; value: Promise<ImageRepositoryMetadata> }
  >();
  private readonly hubCache = new Map<string, { expiresAt: number; tags: DockerHubTags }>();

  constructor(
    store: ImageRepositoryStore = new MemoryImageRepositoryStore(),
    fetcher: typeof fetch = fetch,
    now: () => string = () => new Date().toISOString(),
    id: () => string = randomUUID,
  ) {
    this.store = store;
    this.fetcher = fetcher;
    this.now = now;
    this.id = id;
  }

  add(input: AddImageRepositoryInput): ImageRepositorySummary {
    if (this.store.findByRepository(input.repository)) {
      throw new ExpectedError("image_repository_exists", "이미 등록된 이미지 저장소입니다.", 409);
    }
    const repository: ImageRepositorySummary = {
      createdAt: this.now(),
      id: this.id(),
      repository: input.repository,
    };
    this.store.add(repository);
    return this.summary(repository);
  }

  list(): ImageRepositorySummary[] {
    return this.store.list().map((repository) => this.summary(repository));
  }

  get(id: string): ImageRepositoryDetail {
    const repository = this.requireRepository(id);
    const favoriteTags = this.store.favoriteTags(id);
    return { ...this.summary(repository), favoriteTags, favoriteCount: favoriteTags.length };
  }

  getMetadata(id: string): Promise<ImageRepositoryMetadata> {
    const repository = this.requireRepository(id);
    const parsed = parseImageRepository(repository.repository);
    if (parsed?.registry !== "docker.io") return Promise.resolve({});
    const cached = this.metadataCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const entry = { expiresAt: Infinity, value: getDockerHubMetadata(parsed.name, this.fetcher) };
    this.metadataCache.set(id, entry);
    void entry.value.then(
      () => {
        entry.expiresAt = Date.now() + TAG_CACHE_TTL;
      },
      () => {
        if (this.metadataCache.get(id) === entry) this.metadataCache.delete(id);
      },
    );
    return entry.value;
  }

  async getTags(
    id: string,
    page: number,
    query: ImageRepositoryTagQuery = {},
  ): Promise<ImageRepositoryTagList> {
    const repository = this.requireRepository(id);
    const parsed = parseImageRepository(repository.repository);
    const hasFilter = Object.values(query.filter ?? {}).some((value) => value?.trim());
    if (parsed?.registry === "docker.io" && !hasFilter) {
      return this.hubTags(repository).list(
        page,
        query.sort ?? "-lastUpdated",
        this.store.favoriteTags(id),
      );
    }
    if (query.sort === "lastUpdated" || query.sort === "-lastUpdated") {
      throw new ExpectedError(
        "image_repository_date_sort_unavailable",
        "이 저장소 또는 검색 조건에서는 날짜 정렬을 지원하지 않습니다.",
        400,
      );
    }
    const remote = await this.remoteTags(repository);
    const tagFilter = query.filter?.tag?.trim().toLowerCase() ?? "";
    const digestFilter = query.filter?.digest?.trim().toLowerCase() ?? "";
    const search = query.filter?.search?.trim().toLowerCase() ?? "";
    let tags = remote.tags.filter(({ name }) => name.toLowerCase().includes(tagFilter));
    const searchDigests = Boolean(search && mayMatchManifestDigest(search));
    if ((digestFilter && mayMatchManifestDigest(digestFilter)) || searchDigests) {
      const digestIndex = remote.prepareDigestIndex();
      if (digestIndex) {
        return {
          count: 0,
          totalCount: remote.tags.length,
          page,
          pageSize: TAG_PAGE_SIZE,
          repository: repository.repository,
          tags: [],
          digestIndex,
        };
      }
    }
    tags = tags.filter(
      ({ name, digest }) =>
        (digest?.includes(digestFilter) ?? !digestFilter) &&
        (!search || name.toLowerCase().includes(search) || digest?.includes(search)),
    );
    const favorites = new Set(this.store.favoriteTags(id));
    tags.sort((left, right) => {
      const favoriteOrder = Number(favorites.has(right.name)) - Number(favorites.has(left.name));
      const nameOrder = left.name.localeCompare(right.name, "en");
      return favoriteOrder || (query.sort === "-tag" ? -nameOrder : nameOrder);
    });
    const start = (page - 1) * TAG_PAGE_SIZE;
    const selected = tags.slice(start, start + TAG_PAGE_SIZE);
    await remote.resolveDigests(selected);
    return {
      count: tags.length,
      totalCount: remote.tags.length,
      page,
      pageSize: TAG_PAGE_SIZE,
      repository: repository.repository,
      tags: selected.map((tag) => ({ ...tag, favorite: favorites.has(tag.name) })),
    };
  }

  remove(id: string): void {
    if (!this.store.remove(id)) {
      throw new ExpectedError(
        "image_repository_not_found",
        "이미지 저장소를 찾을 수 없습니다.",
        404,
      );
    }
    this.tagCache.get(id)?.value?.cancel();
    this.tagCache.delete(id);
    this.hubCache.delete(id);
    this.metadataCache.delete(id);
  }

  setFavorite(id: string, tag: string, favorite: boolean): ImageRepositoryTagItem {
    this.requireRepository(id);
    const favorites = this.store.favoriteTags(id);
    if (
      favorite &&
      !favorites.includes(tag) &&
      favorites.length >= IMAGE_REPOSITORY_FAVORITE_LIMIT
    ) {
      throw new ExpectedError(
        "image_repository_favorite_limit",
        `즐겨찾기는 저장소당 최대 ${IMAGE_REPOSITORY_FAVORITE_LIMIT}개까지 추가할 수 있습니다.`,
        409,
      );
    }
    this.store.setFavorite(id, tag, favorite, this.now());
    return { favorite, name: tag };
  }

  async sync(id: string, progress?: OperationProgress): Promise<void> {
    const repository = this.requireRepository(id);
    this.metadataCache.delete(id);
    const parsed = parseImageRepository(repository.repository);
    if (!parsed) {
      throw new ExpectedError(
        "invalid_image_repository",
        "등록된 이미지 저장소 주소가 유효하지 않습니다.",
        409,
      );
    }
    progress?.step(`${parsed.registry} 태그 확인 중`);
    const tagCount =
      parsed.registry === "docker.io"
        ? (await this.hubTags(repository, true).list(1, "-lastUpdated", [])).totalCount
        : (await this.remoteTags(repository, true)).tags.length;
    const syncedAt = this.now();
    this.store.updateSync(id, syncedAt, tagCount);
    progress?.output(`${repository.repository}: 태그 ${tagCount}개`);
  }

  private requireRepository(id: string): ImageRepositorySummary {
    const repository = this.store.find(id);
    if (!repository) {
      throw new ExpectedError(
        "image_repository_not_found",
        "이미지 저장소를 찾을 수 없습니다.",
        404,
      );
    }
    return repository;
  }

  private summary(repository: ImageRepositorySummary): ImageRepositorySummary {
    const parsed = parseImageRepository(repository.repository);
    return {
      ...repository,
      official: parsed?.registry === "docker.io" && parsed.name.startsWith("library/"),
    };
  }

  private hubTags(repository: ImageRepositorySummary, refresh = false): DockerHubTags {
    let cached = this.hubCache.get(repository.id);
    if (refresh || !cached || cached.expiresAt <= Date.now()) {
      cached = {
        expiresAt: Date.now() + TAG_CACHE_TTL,
        tags: new DockerHubTags(repository.repository, this.fetcher),
      };
      this.hubCache.set(repository.id, cached);
    }
    cached.expiresAt = Date.now() + TAG_CACHE_TTL;
    return cached.tags;
  }

  private remoteTags(
    repository: ImageRepositorySummary,
    refresh = false,
  ): Promise<RegistryRepositoryTags> {
    const cached = this.tagCache.get(repository.id);
    const indexFresh =
      (cached?.value?.digestIndexFinishedAt ?? -Infinity) + TAG_CACHE_TTL > Date.now();
    if (
      !refresh &&
      cached &&
      (cached.expiresAt > Date.now() || cached.value?.digestIndex || indexFresh)
    ) {
      cached.expiresAt = cached.value ? Date.now() + TAG_CACHE_TTL : Infinity;
      return cached.tags;
    }
    cached?.value?.cancel();

    const entry: CachedRegistryTags = {
      expiresAt: Infinity,
      tags: this.loadRemoteTags(repository),
    };
    this.tagCache.set(repository.id, entry);
    void entry.tags.then(
      (value) => {
        entry.value = value;
        if (this.tagCache.get(repository.id) !== entry) value.cancel();
        entry.expiresAt = Date.now() + TAG_CACHE_TTL;
      },
      () => {
        if (this.tagCache.get(repository.id) === entry) this.tagCache.delete(repository.id);
      },
    );
    return entry.tags;
  }

  private async loadRemoteTags(
    repository: ImageRepositorySummary,
  ): Promise<RegistryRepositoryTags> {
    const parsed = parseImageRepository(repository.repository);
    if (!parsed) {
      throw new ExpectedError(
        "invalid_image_repository",
        "등록된 이미지 저장소 주소가 유효하지 않습니다.",
        409,
      );
    }
    return getRegistryRepositoryTags(parsed, this.fetcher);
  }
}
