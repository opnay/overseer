import { APP_OPERATION_ROUTES } from "@/shared/routes";
import type { ImageRepositoryDetail } from "@contracts/contracts.ts";
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
import { useAppSession } from "../runtime/AppSession.tsx";
import { PageLoadingBody } from "../ui/loading/LoadingScreen.tsx";
const ComposeWorkspace = lazy(() =>
  import("@/pages/compose").then((module) => ({ default: module.ComposeWorkspace })),
);
const ContainersWorkspace = lazy(() =>
  import("@/pages/containers").then((module) => ({ default: module.ContainersWorkspace })),
);
const ImagesWorkspace = lazy(() =>
  import("@/pages/images").then((module) => ({ default: module.ImagesWorkspace })),
);
const VolumesWorkspace = lazy(() =>
  import("@/pages/volumes").then((module) => ({ default: module.VolumesWorkspace })),
);
const NetworksWorkspace = lazy(() =>
  import("@/pages/networks").then((module) => ({ default: module.NetworksWorkspace })),
);
const InstancesWorkspace = lazy(() =>
  import("@/pages/instances").then((module) => ({ default: module.InstancesWorkspace })),
);
const SettingsWorkspace = lazy(() =>
  import("@/pages/settings").then((module) => ({ default: module.SettingsWorkspace })),
);
const OperationsWorkspace = lazy(() =>
  import("@/pages/operations").then((module) => ({ default: module.OperationsWorkspace })),
);
const ImageRepositoriesWorkspace = lazy(() =>
  import("@/pages/image-repositories").then((module) => ({
    default: module.ImageRepositoriesWorkspace,
  })),
);
const DockerPluginsWorkspace = lazy(() =>
  import("@/pages/docker-plugins").then((module) => ({ default: module.DockerPluginsWorkspace })),
);

export function AppRoutes({
  onCreateContainer,
  onRepositoryChange,
}: {
  onCreateContainer(image: string): void;
  onRepositoryChange(repository?: ImageRepositoryDetail): void;
}) {
  const {
    dashboard,
    operations,
    resourcePath,
    settingsRefreshToken,
    detailRefreshToken,
    settingsRefreshRevision,
    operationsRefreshToken,
    operationsRefreshRevision,
    pluginUpdates,
    imageView,
    setImageView,
  } = useAppSession();
  const runtimeRunning = dashboard?.runtime.phase === "running";
  const runtimeBusy = operations.some(
    ({ status, target }) =>
      (status === "queued" || status === "running") && target.resource === "runtime",
  );
  const dockerComposeAvailable = dashboard?.capabilities?.dockerCompose ?? true;
  const operationCategory = APP_OPERATION_ROUTES.find(
    ({ path }) => path === resourcePath,
  )?.category;
  return (
    <Routes>
      <Route
        path="/instances"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <InstancesWorkspace
              ready={dashboard !== undefined}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/instances/:name"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <InstancesWorkspace
              ready={dashboard !== undefined}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/settings"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <SettingsWorkspace
              dashboard={dashboard}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/operations/*"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <OperationsWorkspace
              refreshToken={`${operationsRefreshToken}:${operationsRefreshRevision}`}
              category={operationCategory ?? "all"}
            />
          </Suspense>
        }
      />
      <Route
        path="/docker-plugins"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <DockerPluginsWorkspace
              refreshToken={String(settingsRefreshRevision)}
              updates={pluginUpdates}
            />
          </Suspense>
        }
      />
      <Route
        path="/image-repositories"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ImageRepositoriesWorkspace
              runtimeRunning={runtimeRunning}
              refreshToken={settingsRefreshToken}
              onCreateContainer={onCreateContainer}
              onRepositoryChange={onRepositoryChange}
            />
          </Suspense>
        }
      />
      <Route
        path="/image-repositories/:id"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ImageRepositoriesWorkspace
              runtimeRunning={runtimeRunning}
              refreshToken={detailRefreshToken}
              onCreateContainer={onCreateContainer}
              onRepositoryChange={onRepositoryChange}
            />
          </Suspense>
        }
      />
      <Route
        path="/compose/:name"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ComposeWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
              composeAvailable={dockerComposeAvailable}
            />
          </Suspense>
        }
      />
      <Route
        path="/containers/:id"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ContainersWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/images/:id"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ImagesWorkspace
              imageView={imageView}
              setImageView={setImageView}
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/networks/:name"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <NetworksWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/volumes/:name"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <VolumesWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={detailRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/compose"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ComposeWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
              composeAvailable={dockerComposeAvailable}
            />
          </Suspense>
        }
      />
      <Route
        path="/containers"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ContainersWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/images"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <ImagesWorkspace
              imageView={imageView}
              setImageView={setImageView}
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/volumes"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <VolumesWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route
        path="/networks"
        element={
          <Suspense fallback={<PageLoadingBody path={resourcePath} />}>
            <NetworksWorkspace
              dashboard={dashboard}
              runtimeRunning={runtimeRunning}
              runtimeBusy={runtimeBusy}
              refreshToken={settingsRefreshToken}
            />
          </Suspense>
        }
      />
      <Route path="*" element={null} />
    </Routes>
  );
}
