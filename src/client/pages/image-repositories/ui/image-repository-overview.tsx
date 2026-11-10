import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { formatDateTime, formatRelativeDateTime } from "@/shared/lib/date-time";
import { DataList } from "@opnay/city-ds-react/data-list";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Item } from "@opnay/city-ds-react/item";
import { ExternalLink, Star } from "lucide-react";
import {
  IMAGE_REPOSITORY_FAVORITE_LIMIT,
  type ImageRepositoryDetail,
  type ImageRepositoryMetadata,
  type ImageRepositoryTagItem,
} from "@contracts/contracts.ts";
import { parseImageRepository } from "@contracts/validation.ts";
import { TagActions } from "./image-repository-tag-actions.tsx";

function repositoryWebPage(repository: string): string | undefined {
  const parsed = parseImageRepository(repository);
  if (!parsed) return undefined;
  const name = parsed.name.split("/").map(encodeURIComponent).join("/");
  if (parsed.registry === "docker.io") {
    return parsed.name.startsWith("library/")
      ? `https://hub.docker.com/_/${name.slice("library/".length)}`
      : `https://hub.docker.com/r/${name}`;
  }
  if (parsed.registry === "ghcr.io") {
    const [owner, ...image] = parsed.name.split("/");
    return `https://github.com/users/${encodeURIComponent(owner!)}/packages/container/package/${encodeURIComponent(image.join("/"))}`;
  }
  if (parsed.registry === "quay.io") return `https://quay.io/repository/${name}`;
  return undefined;
}

export function ImageRepositoryOverview({
  repository,
  metadata,
  metadataError,
  metadataLoading,
  onRetryMetadata,
  tagCount,
  countUnavailable,
  favoriteBusy,
  isBusy,
  onCreateContainer,
  onDownload,
  onFavorite,
  runtimeAvailable,
}: {
  repository: ImageRepositoryDetail;
  metadata?: ImageRepositoryMetadata;
  metadataError?: string;
  metadataLoading: boolean;
  onRetryMetadata(): void;
  tagCount?: number;
  countUnavailable: boolean;
  favoriteBusy: boolean;
  isBusy(reference: string): boolean;
  onCreateContainer(reference: string): void;
  onDownload(reference: string): Promise<void>;
  onFavorite(tag: ImageRepositoryTagItem): Promise<void>;
  runtimeAvailable: boolean;
}) {
  const href = repositoryWebPage(repository.repository);
  const favorites = repository.favoriteTags ?? [];
  const relativeUpdated = metadata?.lastUpdated
    ? formatRelativeDateTime(metadata.lastUpdated)
    : undefined;
  return (
    <>
      {metadataError ? (
        <Alert.Root appearance="subtle" tone="warning">
          <Alert.Title level={3}>저장소 설명을 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>{metadataError}</Alert.Description>
          <Alert.Action>
            <Button onClick={onRetryMetadata} size="sm" variant="outline">
              설명 다시 불러오기
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}
      <DataList.Root aria-label="이미지 저장소 개요" density="compact">
        <DataList.Item>
          <DataList.Label>태그</DataList.Label>
          <DataList.Value>
            {tagCount === undefined
              ? countUnavailable
                ? "확인 불가"
                : "확인 중"
              : `${tagCount}개`}
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>갱신일</DataList.Label>
          <DataList.Value>
            {metadataLoading ? (
              <Skeleton className="overseer-loading-eyebrow" />
            ) : metadata?.lastUpdated ? (
              <time dateTime={metadata.lastUpdated}>
                {formatDateTime(metadata.lastUpdated)}
                {relativeUpdated ? (
                  <span className="overseer-repository-updated-relative"> ({relativeUpdated})</span>
                ) : null}
              </time>
            ) : (
              "—"
            )}
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>원본 이미지 페이지</DataList.Label>
          <DataList.Value>
            {href ? (
              <a
                aria-label={`원본 이미지 페이지: ${repository.repository}`}
                className="overseer-detail-link overseer-repository-source-link"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                <span title={repository.repository}>{repository.repository}</span>
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            ) : (
              "이 레지스트리의 이미지 페이지 링크는 아직 지원하지 않습니다."
            )}
          </DataList.Value>
        </DataList.Item>
      </DataList.Root>
      <section className="overseer-detail-section">
        <header className="overseer-repository-favorites-header">
          <h3 className="city-text-subsection-title">즐겨찾기 태그</h3>
          <span
            className="overseer-repository-favorites-count"
            aria-label={`즐겨찾기 ${repository.favoriteCount}개, 최대 ${IMAGE_REPOSITORY_FAVORITE_LIMIT}개`}
          >
            {repository.favoriteCount} / {IMAGE_REPOSITORY_FAVORITE_LIMIT}
          </span>
        </header>
        {favorites.length === 0 ? (
          <EmptyState.Root density="compact">
            <EmptyState.Icon>
              <Star aria-hidden="true" />
            </EmptyState.Icon>
            <EmptyState.Title level={3}>즐겨찾기한 태그가 없습니다.</EmptyState.Title>
            <EmptyState.Description>
              태그 메뉴에서 자주 사용하는 태그를 즐겨찾기에 추가하세요.
            </EmptyState.Description>
          </EmptyState.Root>
        ) : (
          <Item.Group aria-label={`${repository.repository} 즐겨찾기 태그 목록`}>
            {favorites.map((name) => {
              const tag = { name, favorite: true };
              const reference = `${repository.repository}:${name}`;
              return (
                <Item.Root key={name} appearance="outline" density="compact">
                  <Item.Content>
                    <Item.Title>{name}</Item.Title>
                  </Item.Content>
                  <Item.Actions>
                    <TagActions
                      favoriteBusy={favoriteBusy}
                      favoriteLimitReached={
                        repository.favoriteCount >= IMAGE_REPOSITORY_FAVORITE_LIMIT
                      }
                      imageBusy={isBusy(reference)}
                      onCreateContainer={() => onCreateContainer(reference)}
                      onDownload={() => onDownload(reference)}
                      onFavorite={() => onFavorite(tag)}
                      runtimeAvailable={runtimeAvailable}
                      tag={tag}
                    />
                  </Item.Actions>
                </Item.Root>
              );
            })}
          </Item.Group>
        )}
      </section>
    </>
  );
}
