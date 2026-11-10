import { apiRequest, useOperationClient } from "@/shared/api";
import {
  getAppDetailLocation,
  getAppLocation,
  imageRepositoryDetailPath,
  type AppLocationPath,
} from "@/shared/routes";
import { PageHeaderSlot } from "@/shared/ui/page-header-slots";
import type {
  ImageRepositoryDetail,
  ImageRepositorySummary,
  OperationAccepted,
} from "@contracts/contracts.ts";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AddImageRepositoryDialog, ImageRepositoriesPage } from "./image-repositories-page.tsx";
import { ImageRepositoryDetailPage } from "./image-repository-detail-page.tsx";

export function ImageRepositoriesWorkspace({
  runtimeRunning,
  refreshToken,
  onCreateContainer,
  onRepositoryChange,
}: {
  runtimeRunning: boolean;
  refreshToken: string;
  onCreateContainer(image: string): void;
  onRepositoryChange(repository?: ImageRepositoryDetail): void;
}) {
  const {
    mutate,
    submitting,
    operations,
    targetBusy,
    setSubmitting,
    setError: setOperationError,
  } = useOperationClient();
  const resourcePath = getAppLocation(useLocation().pathname);
  const currentDetail = getAppDetailLocation(useLocation().pathname);
  const detailRefreshToken = refreshToken;
  const finished = operations.find(
    ({ target, status }) =>
      target.resource === "imageRepository" && status !== "queued" && status !== "running",
  );
  const imageRepositoryOperationRefreshToken = finished ? `${finished.id}:${finished.status}` : "";
  const [imageRepositoryRefreshRevision, setImageRepositoryRefreshRevision] = useState(0);
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
      {resourcePath === "/image-repositories" ? (
        <PageHeaderSlot name="actions">
          <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
            <AddImageRepositoryDialog
              busy={submitting === "image-repository-add"}
              onSubmit={async (input) => {
                setSubmitting("image-repository-add");
                setOperationError(undefined);
                try {
                  await apiRequest<{ repository: ImageRepositorySummary }>("/image-repositories", {
                    body: JSON.stringify(input),
                    method: "POST",
                  });
                  setImageRepositoryRefreshRevision((value) => value + 1);
                } catch (error) {
                  setOperationError(actionError(error));
                  throw error;
                } finally {
                  setSubmitting(undefined);
                }
              }}
            />
          </Suspense>
        </PageHeaderSlot>
      ) : null}
      {resourcePath === "/image-repositories" ? (
        <ImageRepositoriesPage
          isBusy={(repository) =>
            targetBusy("imageRepository", repository.id) ||
            submitting === `image-repository-remove-${repository.id}`
          }
          onInspect={(repository) => selectResourcePath(imageRepositoryDetailPath(repository.id))}
          onRemove={async (repository) => {
            setSubmitting(`image-repository-remove-${repository.id}`);
            setOperationError(undefined);
            try {
              await apiRequest(`/image-repositories/${encodeURIComponent(repository.id)}`, {
                method: "DELETE",
              });
              setImageRepositoryRefreshRevision((value) => value + 1);
            } catch (error) {
              setOperationError(actionError(error));
              throw error;
            } finally {
              setSubmitting(undefined);
            }
          }}
          onSync={(repository) =>
            mutate({
              key: `image-repository-sync-${repository.id}`,
              request: () =>
                apiRequest<OperationAccepted>(
                  `/image-repositories/${encodeURIComponent(repository.id)}/sync`,
                  { method: "POST" },
                ),
            })
          }
          refreshToken={`${imageRepositoryRefreshRevision}:${imageRepositoryOperationRefreshToken}`}
        />
      ) : null}
      {currentDetail?.type === "imageRepository" ? (
        <ImageRepositoryDetailPage
          id={currentDetail.identifier}
          isBusy={(reference) =>
            submitting === `image-repository-pull-${reference}` || targetBusy("image", reference)
          }
          onCreateContainer={onCreateContainer}
          onDownload={(reference) => pullImage(reference, `image-repository-pull-${reference}`)}
          onRepositoryChange={onRepositoryChange}
          refreshToken={detailRefreshToken}
          runtimeAvailable={runtimeRunning}
        />
      ) : null}
    </>
  );
}
function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}
