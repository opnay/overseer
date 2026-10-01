import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Table } from "@opnay/city-ds-react/table";
import { Box, FileText, Play, RotateCcw, Settings2, Square, Trash2 } from "lucide-react";
import type { ContainerSummary } from "@contracts/contracts.ts";
import { followLink } from "@/shared/lib/follow-link";
import { containerDetailPath } from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";

export function ContainersPage({
  containers,
  isBusy,
  onAction,
  onEdit,
  onInspect,
  onLogs,
  onRemove,
}: {
  containers: ContainerSummary[];
  isBusy: (container: ContainerSummary) => boolean;
  onAction: (container: ContainerSummary, action: "restart" | "start" | "stop") => void;
  onEdit: (container: ContainerSummary) => void;
  onInspect: (container: ContainerSummary) => void;
  onLogs: (container: ContainerSummary) => void;
  onRemove: (container: ContainerSummary) => void;
}) {
  return (
    <DataTableRegion className="overseer-data-table-region" label="컨테이너 표">
      <Table.Root
        aria-label="컨테이너 목록"
        className="overseer-table overseer-table--containers"
        size="sm"
      >
        <Table.Caption className="overseer-table-caption">
          Lima overseer 인스턴스의 전체 컨테이너
        </Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head className="overseer-table-column-wide">이름</Table.Head>
            <Table.Head>상태</Table.Head>
            <Table.Head>포트</Table.Head>
            <Table.Head className="overseer-actions-column">작업</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {containers.length === 0 ? (
            <Table.StateRow colSpan={4}>
              <EmptyState.Root className="overseer-table-empty-state" density="compact">
                <EmptyState.Icon>
                  <Box aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>컨테이너가 없습니다.</EmptyState.Title>
                <EmptyState.Description>
                  이미지를 지정해 첫 컨테이너를 실행할 수 있습니다.
                </EmptyState.Description>
              </EmptyState.Root>
            </Table.StateRow>
          ) : (
            containers.map((container) => {
              const running = container.state === "running";
              const rowBusy = isBusy(container);
              return (
                <Table.Row key={container.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <div className="overseer-primary-cell">
                      <a
                        className="overseer-detail-link"
                        href={containerDetailPath(container.id)}
                        onClick={(event) => followLink(event, () => onInspect(container))}
                      >
                        {container.name}
                      </a>
                      <div className="overseer-primary-meta">
                        <code>{container.image}</code>
                        {container.composeProject ? (
                          <span
                            title={`Compose 프로젝트 ${container.composeProject}${
                              container.composeService
                                ? ` · 서비스 ${container.composeService}`
                                : ""
                            }`}
                          >
                            Compose · {container.composeProject}
                            {container.composeService &&
                            container.composeService !== container.composeProject
                              ? ` / ${container.composeService}`
                              : ""}
                          </span>
                        ) : null}
                        <code title={container.id}>{container.id.slice(0, 12)}</code>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="overseer-container-status">
                      <Badge
                        aria-label={running ? "실행 중" : "중지됨"}
                        dot
                        size="sm"
                        tone={running ? "success" : "neutral"}
                      />
                      <span>{container.status}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <code>{container.ports || "—"}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <Button
                        aria-label={`${container.name} 설정`}
                        disabled={rowBusy}
                        iconOnly
                        onClick={() => onEdit(container)}
                        size="sm"
                        variant="ghost"
                      >
                        <Settings2 aria-hidden="true" size={14} />
                      </Button>
                      {running ? (
                        <>
                          <Button
                            aria-label={`${container.name} 중지`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => onAction(container, "stop")}
                            size="sm"
                            variant="ghost"
                          >
                            <Square aria-hidden="true" size={14} />
                          </Button>
                          <Button
                            aria-label={`${container.name} 재시작`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => onAction(container, "restart")}
                            size="sm"
                            variant="ghost"
                          >
                            <RotateCcw aria-hidden="true" size={14} />
                          </Button>
                        </>
                      ) : (
                        <Button
                          aria-label={`${container.name} 시작`}
                          disabled={rowBusy}
                          iconOnly
                          onClick={() => onAction(container, "start")}
                          size="sm"
                          variant="ghost"
                        >
                          <Play aria-hidden="true" size={14} />
                        </Button>
                      )}
                      <Button
                        aria-label={`${container.name} 로그 보기`}
                        disabled={rowBusy}
                        iconOnly
                        onClick={() => onLogs(container)}
                        size="sm"
                        variant="ghost"
                      >
                        <FileText aria-hidden="true" size={14} />
                      </Button>
                      <ConfirmAction
                        actionLabel="컨테이너 삭제"
                        ariaLabel={`${container.name} 컨테이너 삭제`}
                        disabled={running || rowBusy}
                        description="컨테이너의 쓰기 레이어가 삭제됩니다. 연결된 named volume과 이미지는 유지됩니다."
                        onConfirm={() => onRemove(container)}
                        iconOnly
                        title={`${container.name} 컨테이너를 삭제하시겠습니까?`}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </ConfirmAction>
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table.Root>
    </DataTableRegion>
  );
}
