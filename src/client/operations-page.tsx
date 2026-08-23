import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Table } from "@opnay/city-ds-react/table";
import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { OperationSnapshot } from "../shared/contracts.ts";
import {
  operationElapsed,
  operationResourceLabel,
  operationStatusPresentation,
  operationTime,
} from "./operation-presentation.ts";

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
          label="작업 히스토리 표"
        >
          <Table.Root
            aria-label="전체 작업 히스토리"
            className="overseer-table overseer-table--operations"
            size="sm"
          >
            <Table.Caption className="overseer-table-caption">
              Overseer에서 요청한 전체 작업 히스토리
            </Table.Caption>
            <Table.Header>
              <Table.Row>
                <Table.Head>요청 시각</Table.Head>
                <Table.Head>작업</Table.Head>
                <Table.Head>대상</Table.Head>
                <Table.Head>상태</Table.Head>
                <Table.Head>소요</Table.Head>
                <Table.Head className="overseer-actions-column">작업</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {operations.length === 0 ? (
                <Table.StateRow colSpan={6}>
                  <EmptyState.Root className="overseer-table-empty-state" density="compact">
                    <EmptyState.Icon>
                      <History aria-hidden="true" />
                    </EmptyState.Icon>
                    <EmptyState.Title level={2}>작업 히스토리가 없습니다.</EmptyState.Title>
                    <EmptyState.Description>
                      Overseer에서 Docker 작업을 시작하면 여기에 계속 저장됩니다.
                    </EmptyState.Description>
                  </EmptyState.Root>
                </Table.StateRow>
              ) : (
                operations.map((operation) => {
                  const presentation = operationStatusPresentation[operation.status];
                  return (
                    <Table.Row key={operation.id}>
                      <Table.Cell>
                        <time dateTime={operation.createdAt}>
                          {operationTime(operation.createdAt)}
                        </time>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="overseer-operation-summary">
                          <strong>{operation.title}</strong>
                          <span>
                            {operation.step}
                            {operation.retriedFromId ? " · 재시도 작업" : ""}
                          </span>
                          {operation.error ? (
                            <span className="overseer-operation-summary-error">
                              {operation.error.message}
                            </span>
                          ) : null}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="overseer-primary-cell">
                          <strong>{operation.target.name}</strong>
                          <span className="overseer-primary-meta">
                            {operationResourceLabel[operation.target.resource]}
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge size="sm" tone={presentation.tone}>
                          {presentation.label}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{operationElapsed(operation)}</Table.Cell>
                      <Table.Cell>
                        <div className="overseer-row-actions">
                          <Button
                            onClick={() => setSelectedId(operation.id)}
                            size="sm"
                            variant="ghost"
                          >
                            상세
                          </Button>
                          {operation.retryable ? (
                            <Button
                              disabled={busyId === operation.id}
                              onClick={() => void retry(operation).catch(() => undefined)}
                              size="sm"
                              variant="outline"
                            >
                              <RotateCcw aria-hidden="true" size={14} />
                              재시도
                            </Button>
                          ) : null}
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
                        <dd>{operationStatusPresentation[selected.status].label}</dd>
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
                      <pre className="overseer-operation-output overseer-operation-output--detail">
                        <code>{selected.output.join("\n")}</code>
                      </pre>
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
