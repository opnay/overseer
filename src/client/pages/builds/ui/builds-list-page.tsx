import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { FilterBar } from "@opnay/city-ds-react/filter-bar";
import { Pagination } from "@opnay/city-ds-react/pagination";
import { SearchInput } from "@opnay/city-ds-react/search-input";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { History, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, type SetURLSearchParams } from "react-router";
import type { BuildHistory, BuildStatus } from "@contracts/builds.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import {
  BUILD_HISTORY_PAGE_SIZE,
  buildDetailPath,
  buildListSearchParams,
  buildListRequestPath,
  buildNameFromSearch,
  buildPageFromSearch,
  buildRequestFailure,
  buildStatusFromSearch,
  buildStatusPresentation,
  formatBuildDuration,
  isAbortError,
  isBuildStatus,
  updateBuildListSearch,
  type BuildRequestState,
} from "../model/build-history.ts";

const paginationLabels = {
  first: "첫 페이지",
  last: "마지막 페이지",
  navigation: "빌드 이력 페이지",
  next: "다음 페이지",
  nextGroup: (count: number) => `다음 ${count}개 페이지`,
  page: (page: number) => `${page}페이지`,
  previous: "이전 페이지",
  previousGroup: (count: number) => `이전 ${count}개 페이지`,
};

const statusOptions: Array<{ label: string; value: BuildStatus | "all" }> = [
  { label: "모든 상태", value: "all" },
  ...Object.entries(buildStatusPresentation).map(([value, status]) => ({
    label: status.label,
    value: value as BuildStatus,
  })),
];

function BuildStatusFilter({
  onChange,
  value,
}: {
  onChange(value: BuildStatus | "all"): void;
  value: BuildStatus | "all";
}) {
  return (
    <Select.Root
      items={Object.fromEntries(statusOptions.map(({ label, value }) => [value, label]))}
      onValueChange={(nextValue) => {
        if (nextValue === "all" || isBuildStatus(String(nextValue))) {
          onChange(String(nextValue) as BuildStatus | "all");
        }
      }}
      size="sm"
      value={value}
    >
      <Select.Trigger aria-label="빌드 상태">
        <Select.Value />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.List>
              {statusOptions.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  <Select.ItemIndicator />
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function BuildHistoryEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <EmptyState.Root className="overseer-table-empty-state" density="compact">
      <EmptyState.Icon>
        <History aria-hidden="true" />
      </EmptyState.Icon>
      <EmptyState.Title level={2}>
        {filtered ? "검색 결과가 없습니다." : "빌드 이력이 없습니다."}
      </EmptyState.Title>
      <EmptyState.Description>
        {filtered
          ? "이름이나 상태 필터를 바꿔 다시 확인해 주세요."
          : "활성 엔진의 기본 빌더에 저장된 기록이 없습니다."}
      </EmptyState.Description>
    </EmptyState.Root>
  );
}

function StatusBadge({ status }: { status: BuildStatus }) {
  const presentation = buildStatusPresentation[status];
  return (
    <Badge appearance="subtle" size="sm" tone={presentation.tone}>
      {presentation.label}
    </Badge>
  );
}

function LoadError({
  code,
  message,
  refreshing,
  onRetry,
}: {
  code?: string;
  message: string;
  refreshing: boolean;
  onRetry(): void;
}) {
  const unavailable = code === "buildx_unavailable";
  return (
    <Alert.Root className="m-4" tone="destructive">
      <Alert.Title level={2}>
        {unavailable
          ? "Buildx를 사용할 수 없습니다."
          : refreshing
            ? "빌드 이력을 새로 고치지 못했습니다."
            : "빌드 이력을 불러오지 못했습니다."}
      </Alert.Title>
      <Alert.Description>{message}</Alert.Description>
      <Alert.Action>
        {unavailable ? (
          <Button
            nativeButton={false}
            render={<Link to="/docker-plugins" />}
            size="sm"
            variant="outline"
          >
            CLI 도구 열기
          </Button>
        ) : (
          <Button onClick={onRetry} size="sm" variant="outline">
            다시 시도
          </Button>
        )}
      </Alert.Action>
    </Alert.Root>
  );
}

export function BuildsListPage({
  instance,
  refreshToken,
  searchParams,
  setSearchParams,
}: {
  instance: string;
  refreshToken: string;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const name = buildNameFromSearch(searchParams);
  const status = buildStatusFromSearch(searchParams);
  const page = buildPageFromSearch(searchParams);
  const requestKey = JSON.stringify([instance, name, status, page]);
  const searchString = buildListSearchParams(searchParams).toString();
  const [draftName, setDraftName] = useState(name);
  const [requestRevision, setRequestRevision] = useState(0);
  const [requestState, setRequestState] = useState<BuildRequestState<BuildHistory>>();
  const visibleState = requestState?.key === requestKey ? requestState : undefined;
  const history = visibleState?.data;
  const hasFilters = Boolean(name || status !== "all");

  useEffect(() => setDraftName(name), [name]);

  const updateSearch = (
    update: { name?: string; page?: number; status?: BuildStatus | "all" },
    replace = false,
  ) => {
    setSearchParams(updateBuildListSearch(searchParams, update), { replace });
  };

  useEffect(() => {
    const controller = new AbortController();
    if (!instance) {
      setRequestState({
        error: { message: "활성 엔진을 확인할 수 없습니다." },
        key: requestKey,
        loading: false,
      });
      return;
    }

    setRequestState((previous) => {
      const current = previous?.key === requestKey ? previous : undefined;
      return { data: current?.data, key: requestKey, loading: true };
    });
    void apiRequest<BuildHistory>(buildListRequestPath(instance, page, name, status), {
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.instance !== instance) {
          throw new Error("응답한 빌드 엔진이 현재 선택한 엔진과 다릅니다.");
        }
        setRequestState({ data: next, key: requestKey, loading: false });

        const pageSize =
          Number.isSafeInteger(next.pageSize) && next.pageSize > 0
            ? next.pageSize
            : BUILD_HISTORY_PAGE_SIZE;
        const totalPages = Math.max(1, Math.ceil(Math.max(0, next.count) / pageSize));
        const responsePage = Number.isSafeInteger(next.page) && next.page > 0 ? next.page : page;
        const boundedPage = Math.min(responsePage, totalPages);
        if (boundedPage !== page) {
          setSearchParams(
            updateBuildListSearch(new URLSearchParams(searchString), { page: boundedPage }),
            { replace: true },
          );
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setRequestState((previous) => {
          const current = previous?.key === requestKey ? previous : undefined;
          return {
            data: current?.data,
            error: buildRequestFailure(error, "빌드 이력을 불러오지 못했습니다."),
            key: requestKey,
            loading: false,
          };
        });
      });

    return () => controller.abort();
  }, [
    instance,
    name,
    page,
    refreshToken,
    requestKey,
    requestRevision,
    searchString,
    setSearchParams,
    status,
  ]);

  const retry = () => setRequestRevision((revision) => revision + 1);
  const totalPages = history
    ? Math.max(1, Math.ceil(Math.max(0, history.count) / Math.max(1, history.pageSize)))
    : 1;
  const displayPage = history ? Math.min(Math.max(1, history.page), totalPages) : page;
  return (
    <section className="overseer-panel" id="builds">
      <header className="overseer-table-context flex flex-col gap-3">
        <p className="city-text-supporting m-0">
          활성 엔진 <code>{instance || "없음"}</code> · 기본 빌더
        </p>
        <FilterBar
          actions={
            <Button
              disabled={!hasFilters}
              onClick={() => {
                setDraftName("");
                setSearchParams(new URLSearchParams());
              }}
              size="sm"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" size={14} />
              필터 초기화
            </Button>
          }
          density="compact"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateSearch({ name: draftName, page: 1 });
            }}
          >
            <SearchInput.Root onValueChange={setDraftName} size="sm" value={draftName}>
              <SearchInput.Group>
                <SearchInput.Input aria-label="빌드 이름 검색" placeholder="빌드 이름" />
                <SearchInput.Clear
                  aria-label="빌드 이름 지우기"
                  onClick={() => {
                    setDraftName("");
                    updateSearch({ name: "", page: 1 });
                  }}
                />
                <SearchInput.Submit aria-label="검색" iconOnly>
                  <Search aria-hidden="true" size={14} />
                </SearchInput.Submit>
              </SearchInput.Group>
            </SearchInput.Root>
          </form>
          <BuildStatusFilter
            onChange={(nextStatus) => updateSearch({ page: 1, status: nextStatus })}
            value={status}
          />
        </FilterBar>
      </header>

      {visibleState?.error ? (
        <LoadError
          code={visibleState.error.code}
          message={visibleState.error.message}
          onRetry={retry}
          refreshing={Boolean(history)}
        />
      ) : null}

      {!history && visibleState?.loading !== false ? (
        <section aria-label="빌드 이력 불러오는 중" className="overseer-detail-loading p-4">
          <Skeleton />
          <Skeleton />
          <Skeleton className="overseer-loading-table" />
        </section>
      ) : history ? (
        <>
          <DataTableRegion className="overseer-data-table-region" label="빌드 이력 표">
            <Table.Root
              aria-busy={visibleState?.loading || undefined}
              aria-label="빌드 이력 목록"
              className="overseer-table"
              size="sm"
            >
              <Table.Caption className="overseer-table-caption">
                {history.instance} 엔진의 기본 빌드 이력
              </Table.Caption>
              <Table.Header>
                <Table.Row>
                  <Table.Head className="overseer-table-column-wide">이름</Table.Head>
                  <Table.Head>상태</Table.Head>
                  <Table.Head>시작 시각</Table.Head>
                  <Table.Head>소요 시간</Table.Head>
                  <Table.Head>캐시 단계 / 전체</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {history.records.length === 0 ? (
                  <Table.StateRow colSpan={5}>
                    <BuildHistoryEmptyState filtered={hasFilters} />
                  </Table.StateRow>
                ) : (
                  history.records.map((record) => (
                    <Table.Row key={record.id}>
                      <Table.Cell className="overseer-table-column-wide">
                        <Link
                          className="overseer-detail-link"
                          to={buildDetailPath(record.id, instance, searchParams)}
                        >
                          {record.name || record.id}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <StatusBadge status={record.status} />
                      </Table.Cell>
                      <Table.Cell>
                        <time dateTime={record.startedAt}>{formatDateTime(record.startedAt)}</time>
                      </Table.Cell>
                      <Table.Cell>{formatBuildDuration(record)}</Table.Cell>
                      <Table.Cell>
                        {record.cachedSteps !== undefined && record.totalSteps !== undefined
                          ? `${record.cachedSteps} / ${record.totalSteps}`
                          : "—"}
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </DataTableRegion>
          <div className="overseer-table-pagination">
            <span>
              전체 {history.count}개 · {displayPage} / {totalPages}페이지
            </span>
            {totalPages > 1 ? (
              <Pagination.Root
                density="compact"
                labels={paginationLabels}
                onPageChange={(nextPage) => {
                  if (!visibleState?.loading)
                    updateSearch({ page: Math.min(Math.max(1, nextPage), totalPages) });
                }}
                page={displayPage}
                totalPages={totalPages}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
