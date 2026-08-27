import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { FilterBar } from "@opnay/city-ds-react/filter-bar";
import { Pagination } from "@opnay/city-ds-react/pagination";
import { SearchField } from "@opnay/city-ds-react/search-field";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { History, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  OperationListResponse,
  OperationResource,
  OperationSnapshot,
  OperationStatus,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { LogViewer } from "@/shared/ui/log-viewer";
import {
  operationElapsed,
  operationListTime,
  operationResourceLabel,
  operationStatusPresentation,
  operationTime,
} from "../lib/operation-presentation.ts";

const OPERATION_PAGE_SIZE = 20;
const paginationLabels = {
  first: "첫 페이지",
  last: "마지막 페이지",
  navigation: "작업 기록 페이지",
  next: "다음 페이지",
  nextGroup: (count: number) => `다음 ${count}개 페이지`,
  page: (page: number) => `${page}페이지`,
  previous: "이전 페이지",
  previousGroup: (count: number) => `이전 ${count}개 페이지`,
};
const resourceOptions: Array<{ label: string; value: "all" | OperationResource }> = [
  { label: "전체 리소스", value: "all" },
  ...Object.entries(operationResourceLabel).map(([value, label]) => ({
    label,
    value: value as OperationResource,
  })),
];
const statusOptions: Array<{ label: string; value: "all" | OperationStatus }> = [
  { label: "전체 상태", value: "all" },
  ...Object.entries(operationStatusPresentation).map(([value, presentation]) => ({
    label: presentation.label,
    value: value as OperationStatus,
  })),
];

function OperationFilterSelect<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: Value): void;
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  return (
    <div className="overseer-operation-select-filter">
      <Select.Root
        items={Object.fromEntries(options.map((option) => [option.value, option.label]))}
        onValueChange={(nextValue) => nextValue && onChange(String(nextValue) as Value)}
        size="sm"
        value={value}
      >
        <Select.Trigger aria-label={label}>
          <Select.Value />
          <Select.Icon />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup>
              <Select.List>
                {options.map((option) => (
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
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export function OperationsPage({
  busyId,
  onRetry,
  refreshToken,
}: {
  busyId?: string;
  onRetry: (id: string) => Promise<void>;
  refreshToken: string;
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [requestRevision, setRequestRevision] = useState(0);
  const [resource, setResource] = useState<"all" | OperationResource>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [snapshot, setSnapshot] = useState<OperationListResponse>();
  const [status, setStatus] = useState<"all" | OperationStatus>("all");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(OPERATION_PAGE_SIZE),
    });
    if (query) params.set("query", query);
    if (resource !== "all") params.set("resource", resource);
    if (status !== "all") params.set("status", status);
    setLoading(true);
    setLoadError(undefined);
    void apiRequest<OperationListResponse>(`/operations?${params}`, {
      signal: controller.signal,
    })
      .then((next) => {
        const operations = Array.isArray(next.operations) ? next.operations : [];
        const pagination = next.pagination ?? {
          page: 1,
          pageSize: Math.max(operations.length, 1),
          total: operations.length,
          totalPages: 1,
        };
        setSnapshot({ operations, pagination });
        if (pagination.page !== page) setPage(pagination.page);
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setLoadError(error instanceof Error ? error.message : "작업 기록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, refreshToken, requestRevision, resource, status]);

  const operations = snapshot?.operations ?? [];
  const selected = operations.find(({ id }) => id === selectedId);
  const hasFilters = Boolean(query || resource !== "all" || status !== "all");

  const retry = async (operation: OperationSnapshot) => {
    await onRetry(operation.id);
    setSelectedId(undefined);
    setRequestRevision((value) => value + 1);
  };

  const resetFilters = () => {
    setDraftQuery("");
    setQuery("");
    setResource("all");
    setStatus("all");
    setPage(1);
  };

  return (
    <>
      <section className="overseer-panel" id="operations">
        <FilterBar
          actions={
            <Button disabled={!hasFilters} onClick={resetFilters} size="sm" variant="outline">
              <RotateCcw aria-hidden="true" size={14} />
              필터 초기화
            </Button>
          }
          appearance="band"
          className="overseer-operation-filters"
          density="compact"
        >
          <div className="overseer-operation-search-filter">
            <SearchField.Root
              loading={loading}
              onSubmit={(value) => {
                setQuery(value.trim());
                setPage(1);
              }}
              onValueChange={setDraftQuery}
              size="sm"
              value={draftQuery}
            >
              <SearchField.Group>
                <SearchField.Input aria-label="작업 검색" placeholder="작업명 또는 대상" />
                <SearchField.Clear
                  aria-label="검색어 지우기"
                  onClick={() => {
                    setDraftQuery("");
                    setQuery("");
                    setPage(1);
                  }}
                />
                <SearchField.Submit aria-label="검색" iconOnly>
                  <Search aria-hidden="true" size={14} />
                </SearchField.Submit>
              </SearchField.Group>
            </SearchField.Root>
          </div>
          <OperationFilterSelect
            label="상태"
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={statusOptions}
            value={status}
          />
          <OperationFilterSelect
            label="리소스"
            onChange={(value) => {
              setResource(value);
              setPage(1);
            }}
            options={resourceOptions}
            value={resource}
          />
        </FilterBar>

        {loadError ? (
          <Alert.Root className="overseer-operation-load-state" tone="destructive">
            <Alert.Title level={2}>작업 기록을 불러오지 못했습니다.</Alert.Title>
            <Alert.Description>{loadError}</Alert.Description>
            <Alert.Action>
              <Button
                onClick={() => setRequestRevision((value) => value + 1)}
                size="sm"
                variant="outline"
              >
                다시 시도
              </Button>
            </Alert.Action>
          </Alert.Root>
        ) : null}

        {!snapshot && loading ? <Skeleton className="overseer-loading-table" /> : null}

        {snapshot ? (
          <>
            <DataTableRegion
              className="overseer-data-table-region"
              hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
              label="작업 기록 표"
            >
              <Table.Root
                aria-label="전체 작업 기록"
                className="overseer-table overseer-table--operations"
                size="sm"
              >
                <Table.Caption className="overseer-table-caption">
                  Overseer에서 요청한 전체 작업 기록
                </Table.Caption>
                <Table.Header>
                  <Table.Row>
                    <Table.Head className="overseer-operation-time-column">요청 시각</Table.Head>
                    <Table.Head className="overseer-table-column-wide">작업</Table.Head>
                    <Table.Head className="overseer-operation-status-column">상태</Table.Head>
                    <Table.Head className="overseer-operation-duration-column">소요</Table.Head>
                    <Table.Head className="overseer-actions-column">상세</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {operations.length === 0 ? (
                    <Table.StateRow colSpan={5}>
                      <EmptyState.Root className="overseer-table-empty-state" density="compact">
                        <EmptyState.Icon>
                          <History aria-hidden="true" />
                        </EmptyState.Icon>
                        <EmptyState.Title level={2}>
                          {hasFilters ? "조건에 맞는 작업이 없습니다." : "작업 기록이 없습니다."}
                        </EmptyState.Title>
                        <EmptyState.Description>
                          {hasFilters
                            ? "검색어나 필터를 바꾸어 다시 확인하십시오."
                            : "Overseer에서 Docker 작업을 시작하면 여기에 계속 저장됩니다."}
                        </EmptyState.Description>
                      </EmptyState.Root>
                    </Table.StateRow>
                  ) : (
                    operations.map((operation) => {
                      const presentation = operationStatusPresentation[operation.status];
                      const showStep =
                        operation.status === "queued" ||
                        operation.status === "running" ||
                        Boolean(operation.retriedFromId);
                      return (
                        <Table.Row key={operation.id}>
                          <Table.Cell className="overseer-operation-time-column">
                            <time
                              aria-label={operationTime(operation.createdAt)}
                              className="overseer-operation-time"
                              dateTime={operation.createdAt}
                              title={operationTime(operation.createdAt)}
                            >
                              {operationListTime(operation.createdAt)}
                            </time>
                          </Table.Cell>
                          <Table.Cell className="overseer-table-column-wide">
                            <div className="overseer-operation-summary">
                              <strong>{operation.title}</strong>
                              <span className="overseer-operation-context">
                                {operationResourceLabel[operation.target.resource]} ·{" "}
                                {operation.target.name}
                              </span>
                              {showStep ? (
                                <span>
                                  {operation.step}
                                  {operation.retriedFromId ? " · 재시도 작업" : ""}
                                </span>
                              ) : null}
                              {operation.error ? (
                                <span className="overseer-operation-summary-error">
                                  {operation.error.message}
                                </span>
                              ) : null}
                            </div>
                          </Table.Cell>
                          <Table.Cell className="overseer-operation-status-column">
                            <Badge appearance="subtle" size="lg" tone={presentation.tone}>
                              {presentation.label}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell className="overseer-operation-duration-column">
                            <span className="overseer-operation-duration">
                              {operationElapsed(operation)}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="overseer-row-actions">
                              <Button
                                onClick={() => setSelectedId(operation.id)}
                                size="sm"
                                variant="ghost"
                              >
                                상세
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table.Root>
            </DataTableRegion>
            <div className="overseer-operation-pagination">
              <span>
                전체 {snapshot.pagination.total}개 · {snapshot.pagination.page} /{" "}
                {snapshot.pagination.totalPages}페이지
              </span>
              {snapshot.pagination.totalPages > 1 ? (
                <Pagination.Root
                  density="compact"
                  labels={paginationLabels}
                  onPageChange={setPage}
                  page={snapshot.pagination.page}
                  totalPages={snapshot.pagination.totalPages}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      <Dialog.Root
        onOpenChange={(open) => !open && setSelectedId(undefined)}
        open={Boolean(selected)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup size="lg">
              <Dialog.Header>
                <div>
                  <Dialog.Title>{selected?.title}</Dialog.Title>
                  <Dialog.Description>
                    {selected
                      ? `${operationResourceLabel[selected.target.resource]} · ${selected.target.name}`
                      : "작업 상세"}
                  </Dialog.Description>
                </div>
              </Dialog.Header>
              <Dialog.Body className="overseer-operation-detail">
                {selected ? (
                  <>
                    <dl className="overseer-operation-detail-meta">
                      <div>
                        <dt>상태</dt>
                        <dd>
                          <Badge
                            appearance="subtle"
                            size="lg"
                            tone={operationStatusPresentation[selected.status].tone}
                          >
                            {operationStatusPresentation[selected.status].label}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt>요청 시각</dt>
                        <dd>{operationTime(selected.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>소요 시간</dt>
                        <dd>{operationElapsed(selected)}</dd>
                      </div>
                    </dl>
                    {selected.error ? (
                      <Alert.Root tone="destructive">
                        <Alert.Title level={3}>작업이 실패했습니다.</Alert.Title>
                        <Alert.Description>{selected.error.message}</Alert.Description>
                      </Alert.Root>
                    ) : null}
                    {selected.output.length > 0 ? (
                      <LogViewer
                        ariaLabel={`${selected.title} 명령 출력`}
                        key={selected.id}
                        value={selected.output.join("\n")}
                      />
                    ) : (
                      <p className="overseer-primary-meta">기록된 명령 출력이 없습니다.</p>
                    )}
                  </>
                ) : null}
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button variant="outline" />}>닫기</Dialog.Close>
                {selected?.retryable ? (
                  <Button
                    disabled={busyId === selected.id}
                    onClick={() => void retry(selected).catch(() => undefined)}
                  >
                    <RotateCcw aria-hidden="true" size={14} />
                    작업 재시도
                  </Button>
                ) : null}
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
