import { apiRequest, useOperationClient } from "@/shared/api";
import {
  getAppDetailLocation,
  getAppLocation,
  volumeDetailPath,
  type AppLocationPath,
} from "@/shared/routes";
import { NamedResourceDialog } from "@/shared/ui/named-resource-dialog";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type { DashboardSnapshot, OperationAccepted } from "@contracts/contracts.ts";
import { useLocation, useNavigate } from "react-router";
import { VolumeDetailPage } from "./volume-detail-page.tsx";
import { VolumesPage } from "./VolumesPage.tsx";

export function VolumesWorkspace({
  dashboard,
  runtimeRunning,
  runtimeBusy,
  refreshToken,
}: {
  dashboard: Pick<DashboardSnapshot, "volumes"> | undefined;
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
        {runtimeRunning && resourcePath === "/volumes" ? (
          <NamedResourceDialog
            busy={submitting === "volume-create"}
            description="local 드라이버를 사용하는 named volume을 만듭니다."
            disabled={Boolean(submitting) || runtimeBusy}
            label="볼륨"
            onSubmit={(name) =>
              mutate({
                key: "volume-create",
                request: () =>
                  apiRequest<OperationAccepted>("/volumes", {
                    body: JSON.stringify({ name }),
                    method: "POST",
                  }),
              })
            }
            placeholder="app-data"
          />
        ) : null}
      </PageHeaderSlot>
      {dashboard && runtimeRunning && currentDetail?.type === "volume" ? (
        <VolumeDetailPage name={currentDetail.identifier} refreshToken={detailRefreshToken} />
      ) : null}
      {resourcePath === "/volumes" && dashboard && runtimeRunning ? (
        <VolumesPage
          isBusy={(volume) => runtimeBusy || targetBusy("volume", volume.name)}
          onRemove={(volume) =>
            void mutate({
              key: `${volume.name}-remove`,
              request: () =>
                apiRequest<OperationAccepted>(`/volumes/${encodeURIComponent(volume.name)}`, {
                  method: "DELETE",
                }),
            }).catch(() => undefined)
          }
          onInspect={(volume) => selectResourcePath(volumeDetailPath(volume.name))}
          volumes={dashboard?.volumes ?? []}
        />
      ) : null}
    </>
  );
}
