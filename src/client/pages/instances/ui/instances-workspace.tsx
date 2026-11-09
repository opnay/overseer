import { apiRequest, useOperationClient } from "@/shared/api";
import {
  getAppDetailLocation,
  getAppLocation,
  runtimeInstanceDetailPath,
  type AppLocationPath,
} from "@/shared/routes";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type {
  CreateRuntimeInstanceInput,
  DeleteRuntimeInstanceInput,
  OperationAccepted,
  RuntimeInstanceSummary,
  UpdateRuntimeInstanceInput,
} from "@contracts/contracts.ts";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { RuntimeInstanceCreateDialog } from "./runtime-instance-create-dialog.tsx";
import { RuntimeInstanceDetailPage } from "./runtime-instance-detail-page.tsx";
import { RuntimeInstanceHeaderActions } from "./runtime-instance-header-actions.tsx";
import { RuntimeInstancesPage } from "./runtime-instances-page.tsx";

export function InstancesWorkspace({
  ready,
  runtimeBusy,
  refreshToken,
}: {
  ready: boolean;
  runtimeBusy: boolean;
  refreshToken: string;
}) {
  const { mutate, submitting } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const detailRefreshToken = refreshToken;
  const settingsRefreshToken = refreshToken;
  const [runtimeInstanceHeaderState, setRuntimeInstanceHeaderState] = useState<{
    instance: RuntimeInstanceSummary;
    selectionLocked: boolean;
  }>();
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };
  const createRuntimeInstance = (input: CreateRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-create-${input.name}`,
      request: () =>
        apiRequest<OperationAccepted>("/runtime/instances", {
          body: JSON.stringify(input),
          method: "POST",
        }),
    });

  const updateRuntimeInstance = (name: string, input: UpdateRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-update-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}`, {
          body: JSON.stringify(input),
          method: "PATCH",
        }),
    });

  const deleteRuntimeInstance = (name: string, input: DeleteRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-delete-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}`, {
          body: JSON.stringify(input),
          method: "DELETE",
        }),
    });

  const mutateRuntimeInstance = (
    name: string,
    action: "force-stop" | "prepare" | "select" | "start" | "stop",
  ) =>
    mutate({
      key: `runtime-instance-${action}-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}/${action}`, {
          method: "POST",
        }),
    });

  return (
    <>
      <PageHeaderSlot name="actions">
        {resourcePath === "/instances" ? (
          <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
            <RuntimeInstanceCreateDialog
              busy={runtimeBusy || Boolean(submitting)}
              onSubmit={createRuntimeInstance}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        ) : currentDetail?.type === "instance" &&
          runtimeInstanceHeaderState?.instance.name === currentDetail.identifier ? (
          <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
            <RuntimeInstanceHeaderActions
              busy={runtimeBusy || Boolean(submitting)}
              instance={runtimeInstanceHeaderState.instance}
              onDelete={deleteRuntimeInstance}
              onForceStop={(name) => mutateRuntimeInstance(name, "force-stop")}
              onPrepare={(name) => mutateRuntimeInstance(name, "prepare")}
              onSelect={(name) => mutateRuntimeInstance(name, "select")}
              onStart={(name) => mutateRuntimeInstance(name, "start")}
              onStop={(name) => mutateRuntimeInstance(name, "stop")}
              onUpdate={updateRuntimeInstance}
              selectionLocked={runtimeInstanceHeaderState.selectionLocked}
            />
          </Suspense>
        ) : null}
      </PageHeaderSlot>
      {resourcePath === "/instances" && ready ? (
        <RuntimeInstancesPage
          busy={runtimeBusy || Boolean(submitting)}
          onDelete={deleteRuntimeInstance}
          onForceStop={(name) => mutateRuntimeInstance(name, "force-stop")}
          onOpenDetail={(name) => selectResourcePath(runtimeInstanceDetailPath(name))}
          onPrepare={(name) => mutateRuntimeInstance(name, "prepare")}
          onSelect={(name) => mutateRuntimeInstance(name, "select")}
          onStart={(name) => mutateRuntimeInstance(name, "start")}
          onStop={(name) => mutateRuntimeInstance(name, "stop")}
          onUpdate={updateRuntimeInstance}
          refreshToken={settingsRefreshToken}
        />
      ) : null}
      {ready && currentDetail?.type === "instance" ? (
        <RuntimeInstanceDetailPage
          name={currentDetail.identifier}
          onHeaderStateChange={setRuntimeInstanceHeaderState}
          refreshToken={detailRefreshToken}
        />
      ) : null}
    </>
  );
}
