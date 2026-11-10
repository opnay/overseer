import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Pagination } from "@opnay/city-ds-react/pagination";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { LoaderCircle, Tags } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import type {
  ImageRepositoryDetail,
  ImageRepositoryMetadata,
  ImageRepositoryTagItem,
  ImageRepositoryTagList,
  ImageRepositoryTagSort,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { IMAGE_REPOSITORY_FAVORITE_LIMIT } from "@contracts/contracts.ts";
import { useUrlSection } from "@/shared/lib/url-section";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";
import { ImageRepositoryOverview } from "./image-repository-overview.tsx";
import { TagActions } from "./image-repository-tag-actions.tsx";

const loadDescriptionDrawer = () =>
  import("./repository-description-drawer.tsx").then((module) => ({
    default: module.RepositoryDescriptionDrawer,
  }));
const RepositoryDescriptionDrawer = lazy(loadDescriptionDrawer);

const sections = ["overview", "tags"] as const;
const navigation = [
  {
    label: "이미지 저장소",
    items: [
      { value: "overview", label: "개요" },
      { value: "tags", label: "태그" },
    ],
  },
] as const;

const paginationLabels = {
  first: "첫 페이지",
  last: "마지막 페이지",
  navigation: "이미지 태그 페이지",
  next: "다음 페이지",
  nextGroup: (count: number) => `다음 ${count}개 페이지`,
  page: (page: number) => `${page}페이지`,
  previous: "이전 페이지",
  previousGroup: (count: number) => `이전 ${count}개 페이지`,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function ImageRepositoryDetailPage({
  id,
  isBusy,
  onCreateContainer,
  onDownload,
  onRepositoryChange,
  refreshToken,
  runtimeAvailable,
}: {
  id: string;
  isBusy(reference: string): boolean;
  onCreateContainer(reference: string): void;
  onDownload(reference: string): Promise<void>;
  onRepositoryChange(repository?: ImageRepositoryDetail): void;
  refreshToken: string;
  runtimeAvailable: boolean;
}) {
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: "overview",
    values: sections,
  });
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionMounted, setDescriptionMounted] = useState(false);
  const [descriptionLoading, setDescriptionLoading] = useState(false);
  const [metadata, setMetadata] = useState<ImageRepositoryMetadata>();
  const [metadataError, setMetadataError] = useState<string>();
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [actionError, setActionError] = useState<string>();
  const [error, setError] = useState<string>();
  const [favoritePending, setFavoritePending] = useState<string>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ImageRepositoryTagSort>();
  const [repository, setRepository] = useState<ImageRepositoryDetail>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [tagList, setTagList] = useState<ImageRepositoryTagList>();
  const [tagRevision, setTagRevision] = useState(0);
  const [tagsError, setTagsError] = useState<string>();
  const [tagsLoading, setTagsLoading] = useState(true);
  const supportsDateSort = repository?.repository.startsWith("docker.io/") ?? false;
  const activeSort = sort ?? (supportsDateSort ? "-lastUpdated" : "tag");

  useEffect(() => {
    setPage(1);
    setDescriptionOpen(false);
    setDescriptionMounted(false);
    setSort(undefined);
    setTagList(undefined);
    return () => onRepositoryChange(undefined);
  }, [id, onRepositoryChange]);

  useEffect(() => {
    let active = true;
    setError(undefined);
    setRepository(undefined);
    void apiRequest<{ repository: ImageRepositoryDetail }>(
      `/image-repositories/${encodeURIComponent(id)}`,
    )
      .then(({ repository: nextRepository }) => {
        if (!active) return;
        setRepository(nextRepository);
      })
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)));
    return () => {
      active = false;
    };
  }, [id, refreshToken, requestRevision]);

  useEffect(() => {
    if (repository?.id === id) onRepositoryChange(repository);
  }, [id, repository, onRepositoryChange]);

  useEffect(() => {
    if (repository?.id !== id) return;
    let active = true;
    setMetadata(undefined);
    setMetadataError(undefined);
    setMetadataLoading(true);
    void apiRequest<{ metadata: ImageRepositoryMetadata }>(
      `/image-repositories/${encodeURIComponent(id)}/metadata`,
    )
      .then(({ metadata: nextMetadata }) => {
        if (!active) return;
        if (!nextMetadata || typeof nextMetadata !== "object")
          throw new Error("저장소 설명 응답을 해석하지 못했습니다.");
        setMetadata(nextMetadata);
        setRepository((current) =>
          current?.id === id ? { ...current, description: nextMetadata.description } : current,
        );
      })
      .catch((loadError: unknown) => active && setMetadataError(errorMessage(loadError)))
      .finally(() => active && setMetadataLoading(false));
    return () => {
      active = false;
    };
  }, [id, repository?.id, refreshToken, requestRevision, metadataRevision]);

  useEffect(() => {
    if (!repository || repository.id !== id) return;
    let active = true;
    setTagsError(undefined);
    setTagsLoading(true);
    const parameters = new URLSearchParams({ page: String(page), sort: activeSort });
    void apiRequest<{ tags: ImageRepositoryTagList }>(
      `/image-repositories/${encodeURIComponent(id)}/tags?${parameters}`,
    )
      .then(({ tags }) => active && setTagList(tags))
      .catch((loadError: unknown) => active && setTagsError(errorMessage(loadError)))
      .finally(() => active && setTagsLoading(false));
    return () => {
      active = false;
    };
  }, [id, page, activeSort, repository?.id, refreshToken, requestRevision, tagRevision]);

  const setFavorite = async (tag: ImageRepositoryTagItem) => {
    setFavoritePending(tag.name);
    setActionError(undefined);
    try {
      const { tag: updated } = await apiRequest<{ tag: ImageRepositoryTagItem }>(
        `/image-repositories/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag.name)}/favorite`,
        { body: JSON.stringify({ favorite: !tag.favorite }), method: "PATCH" },
      );
      setTagList((current) =>
        current
          ? {
              ...current,
              tags: current.tags.map((candidate) =>
                candidate.name === updated.name ? { ...candidate, ...updated } : candidate,
              ),
            }
          : current,
      );
      if (repository) {
        const next = {
          ...repository,
          favoriteTags: updated.favorite
            ? [...new Set([...(repository.favoriteTags ?? []), updated.name])].sort()
            : (repository.favoriteTags ?? []).filter((name) => name !== updated.name),
          favoriteCount: Math.max(0, repository.favoriteCount + (updated.favorite ? 1 : -1)),
        };
        setRepository(next);
      }
      setPage(1);
      setTagRevision((value) => value + 1);
    } catch (favoriteError) {
      setActionError(errorMessage(favoriteError));
      throw favoriteError;
    } finally {
      setFavoritePending(undefined);
    }
  };

  if (error) {
    return (
      <Alert.Root appearance="subtle" tone="destructive">
        <Alert.Title level={2}>이미지 저장소 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
        <Alert.Action>
          <Button onClick={() => setRequestRevision((value) => value + 1)} size="sm">
            다시 시도
          </Button>
        </Alert.Action>
      </Alert.Root>
    );
  }

  if (!repository) {
    return (
      <section aria-label="이미지 저장소 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const totalPages = tagList ? Math.max(1, Math.ceil(tagList.count / tagList.pageSize)) : 1;

  return (
    <article className="overseer-detail-page">
      <PageHeaderSlot name="actions">
        {metadata?.fullDescription ? (
          <Button
            aria-busy={descriptionLoading}
            disabled={descriptionLoading}
            onClick={async () => {
              setDescriptionLoading(true);
              try {
                await loadDescriptionDrawer();
                setDescriptionMounted(true);
                setDescriptionOpen(true);
              } catch (loadError) {
                setActionError(errorMessage(loadError));
              } finally {
                setDescriptionLoading(false);
              }
            }}
            size="sm"
            variant="outline"
          >
            {descriptionLoading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
            ) : null}
            상세 설명 열기
          </Button>
        ) : null}
      </PageHeaderSlot>
      {descriptionMounted && metadata?.fullDescription ? (
        <Suspense fallback={null}>
          <RepositoryDescriptionDrawer
            key={repository.id}
            repository={repository.repository}
            description={metadata.fullDescription}
            open={descriptionOpen}
            onOpenChange={setDescriptionOpen}
          />
        </Suspense>
      ) : null}
      <SectionedWorkspace
        hideHeader
        category="이미지 저장소"
        description={
          section === "overview"
            ? "원본 이미지 페이지와 즐겨찾기 태그를 확인합니다."
            : "원격 태그를 조회하고 이미지 다운로드와 즐겨찾기를 관리합니다."
        }
        getSectionHref={getSectionHref}
        groups={navigation}
        navigationLabel="이미지 저장소 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={section === "overview" ? "개요" : "태그"}
      >
        {!runtimeAvailable ? (
          <Alert.Root appearance="subtle" tone="warning">
            <Alert.Title level={2}>Docker Engine이 실행 중이 아닙니다.</Alert.Title>
            <Alert.Description>
              태그 조회와 즐겨찾기는 사용할 수 있지만 이미지 다운로드와 컨테이너 생성은 실행할 수
              없습니다.
            </Alert.Description>
          </Alert.Root>
        ) : null}

        {actionError ? (
          <Alert.Root appearance="subtle" tone="destructive">
            <Alert.Title level={2}>태그 작업을 완료하지 못했습니다.</Alert.Title>
            <Alert.Description>{actionError}</Alert.Description>
          </Alert.Root>
        ) : null}

        {section === "overview" ? (
          <ImageRepositoryOverview
            repository={repository}
            metadata={metadata}
            metadataError={metadataError}
            metadataLoading={metadataLoading}
            onRetryMetadata={() => setMetadataRevision((value) => value + 1)}
            tagCount={tagList?.totalCount ?? repository.tagCount}
            countUnavailable={Boolean(tagsError)}
            favoriteBusy={Boolean(favoritePending)}
            isBusy={isBusy}
            onCreateContainer={onCreateContainer}
            onDownload={onDownload}
            onFavorite={setFavorite}
            runtimeAvailable={runtimeAvailable}
          />
        ) : tagsError ? (
          <Alert.Root tone="destructive">
            <Alert.Title level={3}>태그를 불러오지 못했습니다.</Alert.Title>
            <Alert.Description>{tagsError}</Alert.Description>
            <Alert.Action>
              <Button size="sm" onClick={() => setTagRevision((value) => value + 1)}>
                다시 시도
              </Button>
            </Alert.Action>
          </Alert.Root>
        ) : (
          <section className="overseer-panel">
            {!tagList ? (
              <section
                aria-label="이미지 저장소 태그 불러오는 중"
                className="overseer-detail-loading"
              >
                <Skeleton className="overseer-loading-table" />
              </section>
            ) : (
              <>
                <DataTableRegion label="이미지 저장소 태그 표">
                  <Table.Root
                    aria-busy={tagsLoading}
                    aria-label={`${repository.repository} 태그 목록`}
                    className="overseer-table"
                    size="sm"
                  >
                    <Table.Header>
                      <Table.Row>
                        <Table.Head
                          aria-sort={
                            activeSort === "tag"
                              ? "ascending"
                              : activeSort === "-tag"
                                ? "descending"
                                : "none"
                          }
                          className="overseer-table-column-wide"
                        >
                          <Table.SortButton
                            aria-label={`태그 ${activeSort === "tag" ? "내림차순" : "오름차순"} 정렬`}
                            direction={
                              activeSort === "tag"
                                ? "asc"
                                : activeSort === "-tag"
                                  ? "desc"
                                  : undefined
                            }
                            disabled={tagsLoading || Boolean(favoritePending)}
                            onDirectionChange={(nextOrder) => {
                              setSort(nextOrder === "asc" ? "tag" : "-tag");
                              setPage(1);
                            }}
                          >
                            태그
                          </Table.SortButton>
                        </Table.Head>
                        <Table.Head
                          aria-sort={
                            activeSort === "lastUpdated"
                              ? "ascending"
                              : activeSort === "-lastUpdated"
                                ? "descending"
                                : "none"
                          }
                        >
                          <Table.SortButton
                            aria-label={`갱신일 ${activeSort === "-lastUpdated" ? "오름차순" : "내림차순"} 정렬`}
                            disabled={!supportsDateSort || tagsLoading || Boolean(favoritePending)}
                            direction={
                              activeSort === "lastUpdated"
                                ? "asc"
                                : activeSort === "-lastUpdated"
                                  ? "desc"
                                  : undefined
                            }
                            onDirectionChange={(nextOrder) => {
                              setSort(
                                activeSort === "lastUpdated" || activeSort === "-lastUpdated"
                                  ? nextOrder === "asc"
                                    ? "lastUpdated"
                                    : "-lastUpdated"
                                  : "-lastUpdated",
                              );
                              setPage(1);
                            }}
                          >
                            갱신일
                          </Table.SortButton>
                        </Table.Head>
                        <Table.Head className="overseer-actions-column">작업</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {tagList.tags.length === 0 ? (
                        <Table.StateRow colSpan={3}>
                          <EmptyState.Root density="compact">
                            <EmptyState.Icon>
                              <Tags aria-hidden="true" />
                            </EmptyState.Icon>
                            <EmptyState.Title level={2}>표시할 태그가 없습니다.</EmptyState.Title>
                            <EmptyState.Description>
                              원격 저장소에 공개된 태그가 없거나 현재 페이지에 결과가 없습니다.
                            </EmptyState.Description>
                          </EmptyState.Root>
                        </Table.StateRow>
                      ) : (
                        tagList.tags.map((tag) => {
                          const reference = `${repository.repository}:${tag.name}`;
                          const favoriteBusy = tagsLoading || Boolean(favoritePending);
                          const imageBusy = isBusy(reference);
                          return (
                            <Table.Row key={tag.name}>
                              <Table.Cell className="overseer-table-column-wide">
                                <div className="overseer-primary-cell">
                                  <strong>{tag.name}</strong>
                                  <div className="overseer-primary-meta">
                                    {tag.platforms?.length ? (
                                      tag.platforms.map((platform) => (
                                        <Badge
                                          appearance="subtle"
                                          key={platform}
                                          size="sm"
                                          tone="neutral"
                                        >
                                          {platform}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span>플랫폼 정보 없음</span>
                                    )}
                                  </div>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                {tag.lastUpdated ? (
                                  <time dateTime={tag.lastUpdated}>
                                    {formatDateTime(tag.lastUpdated)}
                                  </time>
                                ) : (
                                  <span aria-label="갱신일 정보 없음">—</span>
                                )}
                              </Table.Cell>
                              <Table.Cell>
                                <div className="overseer-row-actions">
                                  <TagActions
                                    favoriteBusy={favoriteBusy}
                                    favoriteLimitReached={
                                      repository.favoriteCount >= IMAGE_REPOSITORY_FAVORITE_LIMIT
                                    }
                                    imageBusy={imageBusy}
                                    onCreateContainer={() => onCreateContainer(reference)}
                                    onDownload={() => onDownload(reference)}
                                    onFavorite={() => setFavorite(tag)}
                                    runtimeAvailable={runtimeAvailable}
                                    tag={tag}
                                  />
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          );
                        })
                      )}
                    </Table.Body>
                  </Table.Root>
                </DataTableRegion>
                <div className="overseer-table-pagination">
                  <span>
                    전체 {tagList.count}개 · {tagList.page} / {totalPages}페이지
                  </span>
                  {totalPages > 1 ? (
                    <Pagination.Root
                      density="compact"
                      labels={paginationLabels}
                      onPageChange={(nextPage) => {
                        if (!tagsLoading && !favoritePending) setPage(nextPage);
                      }}
                      page={page}
                      totalPages={totalPages}
                    />
                  ) : null}
                </div>
              </>
            )}
          </section>
        )}
      </SectionedWorkspace>
    </article>
  );
}
