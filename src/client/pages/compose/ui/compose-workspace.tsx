import { apiRequest, useOperationClient } from "@/shared/api";
import {
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  type AppLocationPath,
} from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { LogsDialog, type LogsTarget } from "@/shared/ui/logs-dialog";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type {
  ComposeBuilderInput,
  ComposeProjectAction,
  DashboardSnapshot,
  OperationAccepted,
  RegisterRemoteComposeInput,
} from "@contracts/contracts.ts";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ArrowDownToLine, Play, RotateCcw, Square } from "lucide-react";
import { Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { CreateBuilderComposeDialog } from "./builder-compose-dialog.tsx";
import { ComposeProjectDetailPage } from "./compose-project-detail-page.tsx";
import { ComposePage } from "./ComposePage.tsx";
import { RemoteComposeDialog } from "./remote-compose-dialog.tsx";

export function ComposeWorkspace({
  dashboard,
  runtimeRunning,
  runtimeBusy,
  refreshToken,
  composeAvailable,
}: {
  dashboard: Pick<DashboardSnapshot, "composeProjects"> | undefined;
  runtimeRunning: boolean;
  runtimeBusy: boolean;
  refreshToken: string;
  composeAvailable: boolean;
}) {
  const { mutate, submitting, targetBusy } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const currentCompose =
    currentDetail?.type === "compose"
      ? dashboard?.composeProjects.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const detailRefreshToken = refreshToken;
  const dockerComposeAvailable = composeAvailable;
  const [logsTarget, setLogsTarget] = useState<LogsTarget>();
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };
  const runComposeAction = (name: string, action: ComposeProjectAction) =>
    mutate({
      key: `compose-${name}-${action}`,
      request: () =>
        apiRequest<OperationAccepted>(
          `/compose/projects/${encodeURIComponent(name)}/actions/${action}`,
          { method: "POST" },
        ),
    });

  return (
    <>
      <PageHeaderSlot name="actions">
        {!runtimeRunning ? null : currentCompose ? (
          <div className="overseer-compose-create-actions">
            {currentCompose.status.startsWith("running") ? (
              <>
                <Button
                  disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
                  onClick={() =>
                    void runComposeAction(currentCompose.name, "stop").catch(() => undefined)
                  }
                  size="sm"
                  variant="outline"
                >
                  <Square aria-hidden="true" size={14} />
                  중지
                </Button>
                <Button
                  disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
                  onClick={() =>
                    void runComposeAction(currentCompose.name, "restart").catch(() => undefined)
                  }
                  size="sm"
                  variant="outline"
                >
                  <RotateCcw aria-hidden="true" size={14} />
                  재시작
                </Button>
              </>
            ) : (
              <Button
                disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
                onClick={() =>
                  void runComposeAction(currentCompose.name, "up").catch(() => undefined)
                }
                size="sm"
              >
                <Play aria-hidden="true" size={14} />
                실행
              </Button>
            )}
            <ConfirmAction
              actionLabel="프로젝트 내리기"
              disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
              description="컨테이너와 네트워크를 제거합니다. named volume과 Compose 등록 정보는 유지됩니다."
              onConfirm={() =>
                void runComposeAction(currentCompose.name, "down").catch(() => undefined)
              }
              title={`${currentCompose.name} 프로젝트를 내리시겠습니까?`}
            >
              <ArrowDownToLine aria-hidden="true" size={14} />
              내리기
            </ConfirmAction>
          </div>
        ) : resourcePath === "/compose" && dockerComposeAvailable ? (
          <div className="overseer-compose-create-actions">
            <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
              <CreateBuilderComposeDialog
                disabled={Boolean(submitting) || runtimeBusy}
                onSubmit={(input: ComposeBuilderInput) =>
                  mutate({
                    key: "compose-builder-register",
                    request: () =>
                      apiRequest<OperationAccepted>("/compose/builder", {
                        body: JSON.stringify(input),
                        method: "POST",
                      }),
                  })
                }
              />
            </Suspense>
            <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
              <RemoteComposeDialog
                disabled={Boolean(submitting) || runtimeBusy}
                onSubmit={(input: RegisterRemoteComposeInput) =>
                  mutate({
                    key: "compose-remote-register",
                    request: () =>
                      apiRequest<OperationAccepted>("/compose/remote", {
                        body: JSON.stringify(input),
                        method: "POST",
                      }),
                  })
                }
              />
            </Suspense>
          </div>
        ) : null}
      </PageHeaderSlot>
      {dashboard &&
      runtimeRunning &&
      dockerComposeAvailable &&
      currentDetail?.type === "compose" ? (
        <ComposeProjectDetailPage
          busy={runtimeBusy || targetBusy("compose", currentDetail.identifier)}
          name={currentDetail.identifier}
          onBuilderUpdate={(input, expectedConfigHash) =>
            mutate({
              key: `compose-${currentDetail.identifier}-builder-update`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/builder`,
                  {
                    body: JSON.stringify({ expectedConfigHash, input }),
                    method: "PATCH",
                  },
                ),
            })
          }
          onOpenContainer={(id) => selectResourcePath(containerDetailPath(id))}
          onRemoteCheck={() =>
            mutate({
              key: `compose-${currentDetail.identifier}-remote-check`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/remote/check`,
                  { method: "POST" },
                ),
            })
          }
          onRemoteUpdate={() =>
            mutate({
              key: `compose-${currentDetail.identifier}-remote-update`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/remote/update`,
                  { method: "POST" },
                ),
            })
          }
          refreshToken={detailRefreshToken}
        />
      ) : null}
      {resourcePath === "/compose" && dashboard && runtimeRunning && dockerComposeAvailable ? (
        <ComposePage
          isBusy={(project) => runtimeBusy || targetBusy("compose", project.name)}
          onAction={(project, action) => runComposeAction(project.name, action)}
          onBuilderRemove={(project) =>
            mutate({
              key: `compose-${project.name}-builder-remove`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(project.name)}/builder`,
                  { method: "DELETE" },
                ),
            })
          }
          onBuilderUpdate={(project, input, expectedConfigHash) =>
            mutate({
              key: `compose-${project.name}-builder-update`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(project.name)}/builder`,
                  {
                    body: JSON.stringify({ expectedConfigHash, input }),
                    method: "PATCH",
                  },
                ),
            })
          }
          onInspect={(project) => selectResourcePath(composeProjectDetailPath(project.name))}
          onLogs={(project) =>
            setLogsTarget({
              description: "프로젝트 전체 서비스의 최근 300줄을 표시합니다.",
              requestPath: `/compose/projects/${encodeURIComponent(project.name)}/logs`,
              title: `${project.name} 로그`,
            })
          }
          onRemoteCheck={(project) =>
            mutate({
              key: `compose-${project.name}-remote-check`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(project.name)}/remote/check`,
                  { method: "POST" },
                ),
            })
          }
          onRemoteRemove={(project) =>
            mutate({
              key: `compose-${project.name}-remote-remove`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(project.name)}/remote`,
                  { method: "DELETE" },
                ),
            })
          }
          onRemoteUpdate={(project) =>
            mutate({
              key: `compose-${project.name}-remote-update`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/compose/projects/${encodeURIComponent(project.name)}/remote/update`,
                  { method: "POST" },
                ),
            })
          }
          projects={dashboard.composeProjects}
        />
      ) : null}
      <LogsDialog onClose={() => setLogsTarget(undefined)} target={logsTarget} />
    </>
  );
}
