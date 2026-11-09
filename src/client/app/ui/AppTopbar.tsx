import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ArrowLeft, ArrowRight, Moon, Sun } from "lucide-react";
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
  minimal = false,
}: {
  navigationMode: NavigationMode;
  currentPath: Parameters<typeof MobileNavigationDrawer>[0]["currentPath"];
  settingsSection: string;
  minimal?: boolean;
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
  const { canGoBack, canGoForward, goBack, goForward } = useAppSession();
  return (
    <header className="overseer-titlebar" aria-label="창 제목 표시줄">
      {!minimal ? (
        <nav className="overseer-history-navigation" aria-label="화면 이동">
          {[
            {
              label: "뒤로 가기",
              icon: ArrowLeft,
              disabled: !canGoBack,
              onClick: goBack,
              shortcut: "⌘[",
            },
            {
              label: "앞으로 가기",
              icon: ArrowRight,
              disabled: !canGoForward,
              onClick: goForward,
              shortcut: "⌘]",
            },
          ].map(({ label, icon: Icon, disabled, onClick, shortcut }) => (
            <Tooltip.Root key={label}>
              <Tooltip.Trigger
                render={
                  <Button
                    iconOnly
                    aria-label={label}
                    disabled={disabled}
                    onClick={onClick}
                    size="sm"
                    variant="ghost"
                  />
                }
              >
                <Icon aria-hidden="true" size={16} />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner>
                  <Tooltip.Popup>
                    {label} <span>{shortcut}</span>
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </nav>
      ) : null}
      <div className="overseer-titlebar-drag" data-tauri-drag-region="deep">
        <span>Overseer</span>
      </div>
      {!minimal ? (
        <div className="overseer-titlebar-actions">
          <span className="overseer-runtime-state">
            <Badge
              aria-label={`Lima ${runtimeStatus.label}`}
              dot
              size="sm"
              tone={runtimeStatus.tone}
            />
            {navigationMode !== "mobile" ? (
              <span>
                {runtimeRunning
                  ? `컨테이너 ${dashboard?.containers.filter(({ state }) => state.toLowerCase() === "running").length ?? 0}개 실행 중`
                  : runtimeStatus.label}
              </span>
            ) : null}
          </span>
          <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
            <OperationsDrawer
              compactTrigger={navigationMode === "mobile"}
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
          {navigationMode === "mobile" ? (
            <MobileNavigationDrawer
              currentPath={currentPath}
              onNavigate={selectNavigationHref}
              settingsSection={settingsSection}
            />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
