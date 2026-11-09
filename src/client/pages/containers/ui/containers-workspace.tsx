import { apiRequest, useOperationClient } from "@/shared/api";
import {
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  type AppLocationPath,
} from "@/shared/routes";
import { LogsDialog, type LogsTarget } from "@/shared/ui/logs-dialog";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type {
  ContainerDetail,
  ContainerSpecInput,
  ContainerSummary,
  DashboardSnapshot,
  OperationAccepted,
} from "@contracts/contracts.ts";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ContainerDetailPage } from "./container-detail-page.tsx";
import { EditContainerDialog, RunContainerDialog } from "./container-dialog.tsx";
import { ContainersPage } from "./ContainersPage.tsx";

export function ContainersWorkspace({
  dashboard,
  runtimeRunning,
  runtimeBusy,
  refreshToken,
}: {
  dashboard: Pick<DashboardSnapshot, "containers" | "images" | "networks" | "volumes"> | undefined;
  runtimeRunning: boolean;
  runtimeBusy: boolean;
  refreshToken: string;
}) {
  const { mutate, submitting, targetBusy } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const currentContainer =
    currentDetail?.type === "container"
      ? dashboard?.containers.find(
          ({ id, name }) =>
            id === currentDetail.identifier ||
            name === currentDetail.identifier ||
            id.startsWith(currentDetail.identifier) ||
            currentDetail.identifier.startsWith(id),
        )
      : undefined;
  const detailRefreshToken = refreshToken;
  const [editContainer, setEditContainer] = useState<ContainerSummary>();
  const [logsTarget, setLogsTarget] = useState<LogsTarget>();
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };
  const runContainer = (spec: ContainerSpecInput) =>
    mutate({
      key: "container-run",
      request: () =>
        apiRequest<OperationAccepted>("/containers", {
          body: JSON.stringify(spec),
          method: "POST",
        }),
    });

  return (
    <>
      <PageHeaderSlot name="actions">
        {runtimeRunning && resourcePath === "/containers" ? (
          <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
            <RunContainerDialog
              disabled={Boolean(submitting) || runtimeBusy}
              images={dashboard?.images ?? []}
              networks={dashboard?.networks ?? []}
              onSubmit={runContainer}
              volumes={dashboard?.volumes ?? []}
            />
          </Suspense>
        ) : null}
      </PageHeaderSlot>
      {dashboard && runtimeRunning && currentDetail?.type === "container" ? (
        <ContainerDetailPage
          id={currentDetail.identifier}
          onOpenCompose={(name) => selectResourcePath(composeProjectDetailPath(name))}
          refreshToken={detailRefreshToken}
          summary={currentContainer}
        />
      ) : null}
      {resourcePath === "/containers" && dashboard && runtimeRunning ? (
        <section className="overseer-panel" id="containers">
          <ContainersPage
            containers={dashboard?.containers ?? []}
            isBusy={(container) => runtimeBusy || targetBusy("container", container.id)}
            onAction={(container, action) =>
              void mutate({
                key: `${container.id}-${action}`,
                request: () =>
                  apiRequest<OperationAccepted>(`/containers/${container.id}/actions/${action}`, {
                    method: "POST",
                  }),
              }).catch(() => undefined)
            }
            onEdit={setEditContainer}
            onInspect={(container) => selectResourcePath(containerDetailPath(container.id))}
            onLogs={(container) =>
              setLogsTarget({
                description: "최근 300줄을 시간 정보와 함께 표시합니다.",
                requestPath: `/containers/${container.id}/logs`,
                title: `${container.name} 로그`,
              })
            }
            onRemove={(container) =>
              void mutate({
                key: `${container.id}-remove`,
                request: () =>
                  apiRequest<OperationAccepted>(`/containers/${container.id}`, {
                    method: "DELETE",
                  }),
              }).catch(() => undefined)
            }
          />
        </section>
      ) : null}{" "}
      <Suspense fallback={null}>
        <EditContainerDialog
          container={editContainer}
          images={dashboard?.images ?? []}
          networks={dashboard?.networks ?? []}
          onClose={() => setEditContainer(undefined)}
          onSubmit={(detail: ContainerDetail, spec: ContainerSpecInput) =>
            mutate({
              key: `${detail.id}-update`,
              request: () =>
                apiRequest<OperationAccepted>(`/containers/${detail.id}`, {
                  body: JSON.stringify({ expectedConfigHash: detail.configHash, spec }),
                  method: "PATCH",
                }),
            })
          }
          volumes={dashboard?.volumes ?? []}
        />
      </Suspense>
      <LogsDialog onClose={() => setLogsTarget(undefined)} target={logsTarget} />
    </>
  );
}

export function ContainerLauncher({
  dashboard,
  image,
  onClose,
  busy,
}: {
  dashboard?: Pick<DashboardSnapshot, "images" | "networks" | "volumes">;
  image: string;
  onClose(): void;
  busy: boolean;
}) {
  const { mutate, submitting } = useOperationClient();
  const runContainer = (spec: ContainerSpecInput) =>
    mutate({
      key: "container-run",
      request: () =>
        apiRequest<OperationAccepted>("/containers", {
          body: JSON.stringify(spec),
          method: "POST",
        }),
    });
  return (
    <Suspense fallback={null}>
      <RunContainerDialog
        disabled={Boolean(submitting) || busy}
        images={dashboard?.images ?? []}
        initialImage={image}
        networks={dashboard?.networks ?? []}
        onOpenChange={(open) => !open && onClose()}
        onSubmit={runContainer}
        open
        volumes={dashboard?.volumes ?? []}
      />
    </Suspense>
  );
}
