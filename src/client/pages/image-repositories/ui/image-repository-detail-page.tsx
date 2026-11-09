import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Menu } from "@opnay/city-ds-react/menu";
import { Pagination } from "@opnay/city-ds-react/pagination";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { Download, Ellipsis, Play, Star, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ImageRepositoryDetail,
  ImageRepositoryTagItem,
  ImageRepositoryTagList,
  ImageRepositoryTagSort,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";

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

function TagActions({
  favoriteBusy,
  imageBusy,
  onCreateContainer,
  onDownload,
  onFavorite,
  runtimeAvailable,
  tag,
}: {
  favoriteBusy: boolean;
  imageBusy: boolean;
  onCreateContainer(): void;
  onDownload(): Promise<void>;
  onFavorite(): Promise<void>;
  runtimeAvailable: boolean;
  tag: ImageRepositoryTagItem;
}) {
  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              aria-label={`${tag.name} 이미지 다운로드`}
              disabled={!runtimeAvailable || imageBusy}
              iconOnly
              onClick={() => void onDownload().catch(() => undefined)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <Download aria-hidden="true" size={14} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6}>
            <Tooltip.Popup>이미지 다운로드</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              aria-label={`${tag.name} ${tag.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
              aria-pressed={tag.favorite}
              disabled={favoriteBusy}
              iconOnly
              onClick={() => void onFavorite().catch(() => undefined)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <Star aria-hidden="true" fill={tag.favorite ? "currentColor" : "none"} size={14} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6}>
            <Tooltip.Popup>{tag.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Menu.Root density="compact">
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Menu.Trigger
                render={
                  <Button aria-label={`${tag.name} 작업 메뉴`} iconOnly size="sm" variant="ghost" />
                }
              >
                <Ellipsis aria-hidden="true" size={16} />
              </Menu.Trigger>
            }
          />
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" sideOffset={6}>
              <Tooltip.Popup>작업 메뉴</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6}>
            <Menu.Popup>
              <Menu.Item disabled={!runtimeAvailable || imageBusy} onClick={onCreateContainer}>
                <Play aria-hidden="true" size={14} />
                컨테이너 생성
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
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
  const [actionError, setActionError] = useState<string>();
  const [error, setError] = useState<string>();
  const [favoritePending, setFavoritePending] = useState<string>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ImageRepositoryTagSort>();
  const [repository, setRepository] = useState<ImageRepositoryDetail>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [tagList, setTagList] = useState<ImageRepositoryTagList>();
  const [tagRevision, setTagRevision] = useState(0);
  const [tagsLoading, setTagsLoading] = useState(true);
  const supportsDateSort = repository?.repository.startsWith("docker.io/") ?? false;
  const activeSort = sort ?? (supportsDateSort ? "-lastUpdated" : "tag");

  useEffect(() => {
    setPage(1);
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
        onRepositoryChange(nextRepository);
      })
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)));
    return () => {
      active = false;
    };
  }, [id, onRepositoryChange, refreshToken, requestRevision]);

  useEffect(() => {
    if (!repository || repository.id !== id) return;
    let active = true;
    setError(undefined);
    setTagsLoading(true);
    const parameters = new URLSearchParams({ page: String(page), sort: activeSort });
    void apiRequest<{ tags: ImageRepositoryTagList }>(
      `/image-repositories/${encodeURIComponent(id)}/tags?${parameters}`,
    )
      .then(({ tags }) => active && setTagList(tags))
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)))
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
          favoriteCount: Math.max(0, repository.favoriteCount + (updated.favorite ? 1 : -1)),
        };
        setRepository(next);
        onRepositoryChange(next);
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
      <section aria-label="이미지 저장소 개요" className="overseer-detail-summary">
        <div>
          <span>태그</span>
          <strong>{tagList?.totalCount ?? repository.tagCount ?? 0}개</strong>
        </div>
        <div>
          <span>즐겨찾기</span>
          <strong>{repository.favoriteCount}개</strong>
        </div>
        <div>
          <span>마지막 동기화</span>
          <strong>
            {repository.lastSyncedAt ? formatDateTime(repository.lastSyncedAt) : "동기화 전"}
          </strong>
        </div>
      </section>

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

      <section className="overseer-panel">
        {!tagList ? (
          <section aria-label="이미지 저장소 태그 불러오는 중" className="overseer-detail-loading">
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
                          activeSort === "tag" ? "asc" : activeSort === "-tag" ? "desc" : undefined
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
                                    <Badge key={platform} size="sm" tone="neutral">
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
    </article>
  );
}
