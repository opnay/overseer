import { randomUUID } from "node:crypto";
import type { AddImageRepositoryInput, ImageRepositorySummary } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { getDockerHubRepositoryTags } from "../images/index.ts";
import type { OperationProgress } from "../operations/index.ts";
import { MemoryImageRepositoryStore, type ImageRepositoryStore } from "./image-repository-store.ts";

export interface ImageRepositoryController {
  add(input: AddImageRepositoryInput): ImageRepositorySummary;
  list(): ImageRepositorySummary[];
  remove(id: string): void;
  sync(id: string, progress?: OperationProgress): Promise<void>;
}

export class ImageRepositoryService implements ImageRepositoryController {
  private readonly fetcher: typeof fetch;
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly store: ImageRepositoryStore;

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
      provider: input.provider,
      repository: input.repository,
    };
    this.store.add(repository);
    return repository;
  }

  list(): ImageRepositorySummary[] {
    return this.store.list();
  }

  remove(id: string): void {
    if (!this.store.remove(id)) {
      throw new ExpectedError(
        "image_repository_not_found",
        "이미지 저장소를 찾을 수 없습니다.",
        404,
      );
    }
  }

  async sync(id: string, progress?: OperationProgress): Promise<void> {
    const repository = this.store.find(id);
    if (!repository) {
      throw new ExpectedError(
        "image_repository_not_found",
        "이미지 저장소를 찾을 수 없습니다.",
        404,
      );
    }
    progress?.step("Docker Hub 태그 확인 중");
    const tags = await getDockerHubRepositoryTags(repository.repository, 1, this.fetcher);
    const syncedAt = this.now();
    this.store.updateSync(id, syncedAt, tags.count);
    progress?.output(`${repository.repository}: 태그 ${tags.count}개`);
  }
}
