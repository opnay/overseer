import { apiRequest, useOperationClient } from "@/shared/api";
import {
  getAppDetailLocation,
  getAppLocation,
  imageDetailPath,
  type AppLocationPath,
} from "@/shared/routes";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type { DashboardSnapshot, OperationAccepted } from "@contracts/contracts.ts";
import { useLocation, useNavigate } from "react-router";
import { ImageDetailPage } from "./image-detail-page.tsx";
import { ImagesPage, ImageViewToggle, PullImageDialog } from "./ImagesPage.tsx";

export function ImagesWorkspace({
  dashboard,
  runtimeRunning,
  runtimeBusy,
  refreshToken,
  imageView,
  setImageView,
}: {
  dashboard: Pick<DashboardSnapshot, "images"> | undefined;
  runtimeRunning: boolean;
  runtimeBusy: boolean;
  refreshToken: string;
  imageView: "id" | "tag";
  setImageView(value: "id" | "tag"): void;
}) {
  const { mutate, submitting, targetBusy } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const currentImage =
    currentDetail?.type === "image"
      ? dashboard?.images.find(({ id }) => id === currentDetail.identifier)
      : undefined;
  const detailRefreshToken = refreshToken;
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };
  const pullImage = (image: string, key = "image-pull") =>
    mutate({
      key,
      request: () =>
        apiRequest<OperationAccepted>("/images/pull", {
          body: JSON.stringify({ image }),
          method: "POST",
        }),
    });

  return (
    <>
      <PageHeaderSlot name="actions">
        {runtimeRunning && resourcePath === "/images" ? (
          <PullImageDialog
            busy={submitting === "image-pull"}
            disabled={Boolean(submitting) || runtimeBusy}
            onSubmit={pullImage}
          />
        ) : null}
      </PageHeaderSlot>
      {dashboard && runtimeRunning && currentDetail?.type === "image" ? (
        <ImageDetailPage
          id={currentDetail.identifier}
          refreshToken={detailRefreshToken}
          summary={currentImage}
        />
      ) : null}
      {resourcePath === "/images" && dashboard && runtimeRunning ? (
        <section className="overseer-panel" id="images">
          <ImagesPage
            images={dashboard?.images ?? []}
            isBusy={(image) => runtimeBusy || targetBusy("image", image.id)}
            onInspect={(image) => selectResourcePath(imageDetailPath(image.id))}
            onRemoveImage={(id) =>
              void mutate({
                key: `${id}-remove`,
                request: () =>
                  apiRequest<OperationAccepted>(`/images/${id}`, {
                    method: "DELETE",
                  }),
              }).catch(() => undefined)
            }
            onRemoveTag={(image) =>
              void mutate({
                key: `${image.id}-${image.url}-remove-tag`,
                request: () =>
                  apiRequest<OperationAccepted>("/images/tags/remove", {
                    body: JSON.stringify({ id: image.id, reference: image.url }),
                    method: "POST",
                  }),
              }).catch(() => undefined)
            }
            view={imageView}
          />
        </section>
      ) : null}
      <PageHeaderSlot name="utilities">
        {resourcePath === "/images" ? (
          <ImageViewToggle onChange={setImageView} value={imageView} />
        ) : null}
      </PageHeaderSlot>
    </>
  );
}
