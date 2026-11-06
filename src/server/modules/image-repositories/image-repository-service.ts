import { randomUUID } from "node:crypto";
import type {
  AddImageRepositoryInput,
  ImageRepositoryDetail,
  ImageRepositorySummary,
  ImageRepositoryTagItem,
  ImageRepositoryTagList,
  ImageRepositoryTagQuery,
} from "../../../shared/contracts.ts";
import { parseImageRepository } from "../../../shared/validation.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { OperationProgress } from "../operations/index.ts";
import { MemoryImageRepositoryStore, type ImageRepositoryStore } from "./image-repository-store.ts";
import { getRegistryRepositoryTags, type RegistryRepositoryTags } from "./registry-tags.ts";

const TAG_PAGE_SIZE = 25;
const TAG_CACHE_TTL = 60_000;

export interface ImageRepositoryController {
  add(input: AddImageRepositoryInput): ImageRepositorySummary;
  get(id: string): ImageRepositoryDetail;
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
  private readonly tagCache = new Map<
    string,
    { expiresAt: number; tags: Promise<RegistryRepositoryTags> }
  >();

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
    return repository;
  }

  list(): ImageRepositorySummary[] {
    return this.store.list();
  }

  get(id: string): ImageRepositoryDetail {
    const repository = this.requireRepository(id);
    return { ...repository, favoriteCount: this.store.favoriteTags(id).length };
  }

  async getTags(
    id: string,
    page: number,
    query: ImageRepositoryTagQuery = {},
  ): Promise<ImageRepositoryTagList> {
    const repository = this.requireRepository(id);
    const remote = await this.remoteTags(repository);
    const tagFilter = query.filter?.tag?.trim().toLowerCase() ?? "";
    const digestFilter = query.filter?.digest?.trim().toLowerCase() ?? "";
    const search = query.filter?.search?.trim().toLowerCase() ?? "";
    let tags = remote.tags.filter(({ name }) => name.toLowerCase().includes(tagFilter));
    if (digestFilter || search) await remote.resolveDigests(tags);
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
    this.tagCache.delete(id);
  }

  setFavorite(id: string, tag: string, favorite: boolean): ImageRepositoryTagItem {
    this.requireRepository(id);
    this.store.setFavorite(id, tag, favorite, this.now());
    return { favorite, name: tag };
  }

  async sync(id: string, progress?: OperationProgress): Promise<void> {
    const repository = this.requireRepository(id);
    const parsed = parseImageRepository(repository.repository);
    if (!parsed) {
      throw new ExpectedError(
        "invalid_image_repository",
        "등록된 이미지 저장소 주소가 유효하지 않습니다.",
        409,
      );
    }
    progress?.step(`${parsed.registry} 태그 확인 중`);
    const tagCount = (await this.remoteTags(repository, true)).tags.length;
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

  private remoteTags(
    repository: ImageRepositorySummary,
    refresh = false,
  ): Promise<RegistryRepositoryTags> {
    const cached = this.tagCache.get(repository.id);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.tags;

    const entry = { expiresAt: Infinity, tags: this.loadRemoteTags(repository) };
    this.tagCache.set(repository.id, entry);
    void entry.tags.then(
      () => {
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
