import { apiRequest, useOperationClient } from "@/shared/api";
import {
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  networkDetailPath,
  type AppLocationPath,
} from "@/shared/routes";
import { NamedResourceDialog } from "@/shared/ui/named-resource-dialog";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type { DashboardSnapshot, OperationAccepted } from "@contracts/contracts.ts";
import { useLocation, useNavigate } from "react-router";
import { NetworkDetailPage } from "./network-detail-page.tsx";
import { NetworksPage } from "./NetworksPage.tsx";

export function NetworksWorkspace({
  dashboard,
  runtimeRunning,
  runtimeBusy,
  refreshToken,
}: {
  dashboard: Pick<DashboardSnapshot, "networks"> | undefined;
  runtimeRunning: boolean;
  runtimeBusy: boolean;
  refreshToken: string;
}) {
  const { mutate, submitting, targetBusy } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const detailRefreshToken = refreshToken;
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };

  return (
    <>
      <PageHeaderSlot name="actions">
        {runtimeRunning && resourcePath === "/networks" ? (
          <NamedResourceDialog
            busy={submitting === "network-create"}
            description="기본 bridge 드라이버를 사용하는 네트워크를 만듭니다."
            disabled={Boolean(submitting) || runtimeBusy}
            label="네트워크"
            onSubmit={(name) =>
              mutate({
                key: "network-create",
                request: () =>
                  apiRequest<OperationAccepted>("/networks", {
                    body: JSON.stringify({ name }),
                    method: "POST",
                  }),
              })
            }
            placeholder="app-network"
          />
        ) : null}
      </PageHeaderSlot>
      {dashboard && runtimeRunning && currentDetail?.type === "network" ? (
        <NetworkDetailPage
          name={currentDetail.identifier}
          onOpenContainer={(id) => selectResourcePath(containerDetailPath(id))}
          refreshToken={detailRefreshToken}
        />
      ) : null}
      {resourcePath === "/networks" && dashboard && runtimeRunning ? (
        <NetworksPage
          isBusy={(network) => runtimeBusy || targetBusy("network", network.name)}
          networks={dashboard?.networks ?? []}
          onInspect={(network) => selectResourcePath(networkDetailPath(network.name))}
          onRemove={(network) =>
            void mutate({
              key: `${network.name}-remove`,
              request: () =>
                apiRequest<OperationAccepted>(`/networks/${encodeURIComponent(network.name)}`, {
                  method: "DELETE",
                }),
            }).catch(() => undefined)
          }
        />
      ) : null}
    </>
  );
}
