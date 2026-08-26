import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Table } from "@opnay/city-ds-react/table";
import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { OperationSnapshot } from "@contracts/contracts.ts";
import { LogViewer } from "@/shared/ui/log-viewer";
import {
  operationElapsed,
  operationListTime,
  operationResourceLabel,
  operationStatusPresentation,
  operationTime,
} from "../lib/operation-presentation.ts";

export function OperationsPage({
  busyId,
  onRetry,
  operations,
}: {
  busyId?: string;
  onRetry: (id: string) => Promise<void>;
  operations: OperationSnapshot[];
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = operations.find(({ id }) => id === selectedId);

  const retry = async (operation: OperationSnapshot) => {
    await onRetry(operation.id);
    setSelectedId(undefined);
  };

  return (
    <>
      <section className="overseer-panel" id="operations">
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
                    <EmptyState.Title level={2}>작업 기록이 없습니다.</EmptyState.Title>
                    <EmptyState.Description>
                      Overseer에서 Docker 작업을 시작하면 여기에 계속 저장됩니다.
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
