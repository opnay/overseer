import { PageHeaderSlotsProvider } from "@/shared/ui/page-header-slots";
import { WorkspaceNavigationProvider } from "@/shared/ui/sectioned-workspace";
import type { ImageRepositoryDetail } from "@contracts/contracts.ts";
import { Suspense, lazy, useEffect, useState } from "react";
import { pagePresentation } from "../model/page-presentation.ts";
import { useNavigationMode } from "../model/use-navigation-mode.ts";
import { AppRoutes } from "../routing/AppRoutes.tsx";
import { useAppSession } from "../runtime/AppSession.tsx";
import { AppSidebar } from "./AppNavigation.tsx";
import { PageHeader } from "./PageHeader.tsx";
import { RuntimeFeedback } from "./RuntimeFeedback.tsx";
const ContainerLauncher = lazy(() =>
  import("@/pages/containers").then((module) => ({ default: module.ContainerLauncher })),
);
export function AppShell() {
  const { dashboard, operations, resourcePath, navigationSearch, selectNavigationHref } =
    useAppSession();

  const navigationMode = useNavigationMode();
  const [runContainerImage, setRunContainerImage] = useState<string>();

  const [imageRepositoryHeader, setImageRepositoryHeader] = useState<ImageRepositoryDetail>();

  useEffect(() => {
    setImageRepositoryHeader(undefined);
  }, [resourcePath]);
  const presentation = pagePresentation(
    resourcePath,
    navigationSearch,
    dashboard,
    imageRepositoryHeader,
  );
  const { currentRoute, currentDetail, pageLabel, settingsSection } = presentation;

  const runtimeBusy = operations.some(
    ({ status, target }) =>
      (status === "queued" || status === "running") && target.resource === "runtime",
  );

  return (
    <WorkspaceNavigationProvider enabled={navigationMode !== "mobile"}>
      <PageHeaderSlotsProvider>
        <div className="overseer-shell" data-navigation-mode={navigationMode}>
          <a className="overseer-skip-link" href="#main-content">
            본문으로 건너뛰기
          </a>
          {navigationMode !== "mobile" ? (
            <AppSidebar
              currentPath={currentRoute.path}
              detail={currentDetail}
              detailLabel={pageLabel}
              mode={navigationMode}
              onNavigate={selectNavigationHref}
              settingsSection={settingsSection}
            />
          ) : null}

          <div className="overseer-workspace">
            <main className="overseer-main" id="main-content">
              <PageHeader {...presentation} navigationMode={navigationMode} />

              <RuntimeFeedback />
              <AppRoutes
                onCreateContainer={setRunContainerImage}
                onRepositoryChange={setImageRepositoryHeader}
              />
            </main>
          </div>
          {runContainerImage ? (
            <Suspense fallback={null}>
              <ContainerLauncher
                dashboard={dashboard}
                busy={runtimeBusy}
                image={runContainerImage}
                onClose={() => setRunContainerImage(undefined)}
              />
            </Suspense>
          ) : null}
        </div>
      </PageHeaderSlotsProvider>
    </WorkspaceNavigationProvider>
  );
}
