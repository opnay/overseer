import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { FileText, Layers3, ListTree, Play, RotateCcw, Square } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import type {
  ComposeBuilderInput,
  ComposeProjectAction,
  ComposeProjectSummary,
} from "@contracts/contracts.ts";
import { followLink } from "@/shared/lib/follow-link";
import { composeProjectDetailPath } from "@/shared/routes";
import {
  composeFileName,
  composeIsRunning,
  composeStatusLabel,
  composeStatusTone,
} from "../lib/compose-presentation.ts";

const ComposeProjectActions = lazy(() =>
  import("./compose-project-actions.tsx").then((module) => ({
    default: module.ComposeProjectActions,
  })),
);

function IconAction({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            iconOnly
            onClick={onClick}
            size="sm"
            variant="ghost"
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6}>
          <Tooltip.Popup>{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ComposePage({
  isBusy,
  onAction,
  onBuilderRemove,
  onBuilderUpdate,
  onInspect,
  onLogs,
  onRemoteCheck,
  onRemoteRemove,
  onRemoteUpdate,
  projects,
}: {
  isBusy: (project: ComposeProjectSummary) => boolean;
  onAction: (project: ComposeProjectSummary, action: ComposeProjectAction) => Promise<void>;
  onBuilderRemove: (project: ComposeProjectSummary) => Promise<void>;
  onBuilderUpdate: (
    project: ComposeProjectSummary,
    input: ComposeBuilderInput,
    expectedConfigHash: string,
  ) => Promise<void>;
  onInspect: (project: ComposeProjectSummary) => void;
  onLogs: (project: ComposeProjectSummary) => void;
  onRemoteCheck: (project: ComposeProjectSummary) => Promise<void>;
  onRemoteRemove: (project: ComposeProjectSummary) => Promise<void>;
  onRemoteUpdate: (project: ComposeProjectSummary) => Promise<void>;
  projects: ComposeProjectSummary[];
}) {
  return (
    <section className="overseer-panel" id="compose">
      <DataTableRegion
        className="overseer-data-table-region"
        hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
        label="Compose 프로젝트 표"
      >
        <Table.Root
          aria-label="Compose 프로젝트 목록"
          className="overseer-table overseer-table--compose-projects"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 Compose 프로젝트
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">프로젝트</Table.Head>
              <Table.Head>상태</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {projects.length === 0 ? (
              <Table.StateRow colSpan={3}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <Layers3 aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>Compose 프로젝트가 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    CLI 실행 이력이나 폼·raw compose.yaml URL 프로젝트를 등록하면 여기에 표시됩니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              projects.map((project) => {
                const running = composeIsRunning(project.status);
                const rowBusy = isBusy(project);
                const hasRemoteFlag = Boolean(
                  project.remote?.buildContext ||
                  project.remote?.updateAvailable ||
                  project.remote?.checkError,
                );
                return (
                  <Table.Row key={project.name}>
                    <Table.Cell className="overseer-table-column-wide">
                      <div className="overseer-primary-cell">
                        <a
                          className="overseer-detail-link"
                          href={composeProjectDetailPath(project.name)}
                          onClick={(event) => followLink(event, () => onInspect(project))}
                        >
                          {project.name}
                        </a>
                        <div className="overseer-primary-meta">
                          {project.remote ? (
                            <span>URL 등록</span>
                          ) : project.builder ? (
                            <span>{project.builder.mode === "yaml" ? "YAML 작성" : "폼 작성"}</span>
                          ) : null}
                          <code
                            className="overseer-compose-config"
                            title={project.remote?.url ?? project.configFiles.join(", ")}
                          >
                            {project.remote?.url ??
                              (project.builder
                                ? "SQLite 생성 compose.yaml"
                                : project.configFiles.map(composeFileName).join(" · "))}
                          </code>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="overseer-compose-status-stack">
                        <span className="overseer-container-status">
                          <Badge
                            aria-hidden="true"
                            dot
                            size="sm"
                            tone={composeStatusTone(project)}
                          />
                          <span>{composeStatusLabel(project.status)}</span>
                        </span>
                        {hasRemoteFlag ? (
                          <div className="overseer-compose-flags">
                            {project.remote?.buildContext ? (
                              <Badge appearance="outline" size="sm" tone="warning">
                                build context
                              </Badge>
                            ) : null}
                            {project.remote?.updateAvailable ? (
                              <Badge appearance="outline" size="sm" tone="info">
                                업데이트 있음
                              </Badge>
                            ) : null}
                            {project.remote?.checkError ? (
                              <Badge
                                appearance="outline"
                                size="sm"
                                title={project.remote.checkError}
                                tone="destructive"
                              >
                                확인 실패
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="overseer-row-actions">
                        <IconAction
                          disabled={rowBusy}
                          label={`${project.name} 서비스 보기`}
                          onClick={() => onInspect(project)}
                        >
                          <ListTree aria-hidden="true" size={14} />
                        </IconAction>
                        {running ? (
                          <IconAction
                            disabled={rowBusy}
                            label={`${project.name} 중지`}
                            onClick={() => void onAction(project, "stop").catch(() => undefined)}
                          >
                            <Square aria-hidden="true" size={14} />
                          </IconAction>
                        ) : (
                          <IconAction
                            disabled={rowBusy}
                            label={`${project.name} 실행`}
                            onClick={() => void onAction(project, "up").catch(() => undefined)}
                          >
                            <Play aria-hidden="true" size={14} />
                          </IconAction>
                        )}
                        {running ? (
                          <IconAction
                            disabled={rowBusy}
                            label={`${project.name} 재시작`}
                            onClick={() => void onAction(project, "restart").catch(() => undefined)}
                          >
                            <RotateCcw aria-hidden="true" size={14} />
                          </IconAction>
                        ) : null}
                        <IconAction
                          disabled={rowBusy}
                          label={`${project.name} 로그 보기`}
                          onClick={() => onLogs(project)}
                        >
                          <FileText aria-hidden="true" size={14} />
                        </IconAction>
                        <Suspense
                          fallback={<Skeleton className="overseer-loading-topbar-action" />}
                        >
                          <ComposeProjectActions
                            busy={rowBusy}
                            onApply={() => onAction(project, "up")}
                            onBuilderUpdate={(input, expectedConfigHash) =>
                              onBuilderUpdate(project, input, expectedConfigHash)
                            }
                            onCheck={() => onRemoteCheck(project)}
                            onDelete={() =>
                              project.remote
                                ? onRemoteRemove(project)
                                : project.builder
                                  ? onBuilderRemove(project)
                                  : Promise.resolve()
                            }
                            onDown={() => onAction(project, "down")}
                            onRemoteUpdate={() => onRemoteUpdate(project)}
                            project={project}
                          />
                        </Suspense>
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
  );
}
