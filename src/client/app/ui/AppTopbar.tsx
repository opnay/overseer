import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Container, Moon, Sun } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { runtimePresentation } from "../model/runtime-presentation.ts";
import type { NavigationMode } from "../model/use-navigation-mode.ts";
import { useAppSession } from "../runtime/AppSession.tsx";
import { MobileNavigationDrawer } from "./AppNavigation.tsx";
const OperationsDrawer = lazy(() =>
  import("@/pages/operations").then((module) => ({ default: module.OperationsDrawer })),
);
export function AppTopbar({
  navigationMode,
  currentPath,
  settingsSection,
}: {
  navigationMode: NavigationMode;
  currentPath: Parameters<typeof MobileNavigationDrawer>[0]["currentPath"];
  settingsSection: string;
}) {
  const {
    dashboard,
    operations,
    cancelOperation,
    retryOperation,
    selectResourcePath,
    selectNavigationHref,
  } = useAppSession();
  const runtime = dashboard?.runtime;
  const runtimeRunning = runtime?.phase === "running";
  const runtimeStatus = runtime ? runtimePresentation[runtime.phase] : runtimePresentation.error;
  const [dark, setDark] = useState(() => window.localStorage.getItem("overseer-theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("overseer-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <>
      {navigationMode === "mobile" ? (
        <header className="overseer-mobile-header">
          <div className="overseer-mobile-brand">
            <span aria-hidden="true">
              <Container size={17} strokeWidth={1.8} />
            </span>
            <strong>Overseer</strong>
          </div>
          <div className="overseer-mobile-header-actions">
            <Badge
              aria-label={`Lima ${runtimeStatus.label}`}
              dot
              size="sm"
              tone={runtimeStatus.tone}
            />
            <Suspense fallback={<Skeleton className="overseer-loading-mobile-action" />}>
              <OperationsDrawer
                compactTrigger
                onCancel={cancelOperation}
                onRetry={retryOperation}
                onViewAll={() => selectResourcePath("/operations")}
                operations={operations}
              />
            </Suspense>
            <Button
              aria-label={dark ? "라이트 테마 사용" : "다크 테마 사용"}
              iconOnly
              onClick={() => setDark((value) => !value)}
              size="sm"
              variant="ghost"
            >
              {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            </Button>
            <MobileNavigationDrawer
              currentPath={currentPath}
              onNavigate={selectNavigationHref}
              settingsSection={settingsSection}
            />
          </div>
        </header>
      ) : (
        <header className="overseer-topbar">
          <div>
            <span>로컬 컨테이너 콘솔</span>
            <strong>127.0.0.1 전용</strong>
          </div>
          <div className="overseer-topbar-actions">
            <span className="overseer-runtime-state">
              <Badge
                aria-label={`Lima ${runtimeStatus.label}`}
                dot
                size="sm"
                tone={runtimeStatus.tone}
              />
              <span>
                {runtimeRunning
                  ? `컨테이너 ${dashboard?.containers.filter(({ state }) => state.toLowerCase() === "running").length ?? 0}개 실행 중`
                  : runtimeStatus.label}
              </span>
            </span>
            <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
              <OperationsDrawer
                onCancel={cancelOperation}
                onRetry={retryOperation}
                onViewAll={() => selectResourcePath("/operations")}
                operations={operations}
              />
            </Suspense>
            <Button
              aria-label={dark ? "라이트 테마 사용" : "다크 테마 사용"}
              iconOnly
              onClick={() => setDark((value) => !value)}
              size="sm"
              variant="ghost"
            >
              {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            </Button>
          </div>
        </header>
      )}
    </>
  );
}
