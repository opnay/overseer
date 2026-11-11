import { followLink } from "@/shared/lib/follow-link";
import { APP_OPERATION_ROUTES, type AppLocationPath } from "@/shared/routes";
import { PageHeaderSlotOutlet } from "@/shared/ui/page-header-slots";
import { Breadcrumbs } from "@opnay/city-ds-react/breadcrumbs";
import { Button } from "@opnay/city-ds-react/button";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { pagePresentation } from "../model/page-presentation.ts";
import type { NavigationMode } from "../model/use-navigation-mode.ts";
import { useAppSession } from "../runtime/AppSession.tsx";
export function PageHeader(
  props: ReturnType<typeof pagePresentation> & { navigationMode: NavigationMode },
) {
  const {
    resourcePath,
    dashboard,
    refreshStartup,
    refresh,
    loadOperations,
    setOperationsRefreshRevision,
    setSettingsRefreshRevision,
    setDetailRefreshRevision,
  } = useAppSession();
  const { navigationMode, ...presentation } = props;
  const {
    currentDetail,
    currentVolumeAnonymous,
    detailBreadcrumbs,
    pageEyebrow,
    pageLabel,
    pageDescription,
  } = presentation;
  const isOperationsPage = APP_OPERATION_ROUTES.some(({ path }) => path === resourcePath);
  const runtimeRunning = dashboard?.runtime.phase === "running";
  const navigate = useNavigate();
  const selectResourcePath = (path: AppLocationPath) => {
    void navigate(path);
  };
  return (
    <section className="overseer-page-header">
      <div>
        {currentDetail ? (
          <Breadcrumbs.Root aria-label="현재 위치">
            <Breadcrumbs.List>
              {detailBreadcrumbs.map((item, index) => {
                const path = item.path;
                const collapseOnMobile =
                  navigationMode === "mobile" && detailBreadcrumbs.length === 3 && index === 1;
                return (
                  <Breadcrumbs.Item key={`${item.label}-${index}`}>
                    {index > 0 ? <Breadcrumbs.Separator /> : null}
                    {collapseOnMobile ? (
                      <Breadcrumbs.Ellipsis aria-label={`${item.label} 경로 생략`} />
                    ) : !path ? (
                      <Breadcrumbs.Page>{item.label}</Breadcrumbs.Page>
                    ) : (
                      <Breadcrumbs.Link
                        href={path}
                        onClick={(event) => followLink(event, () => selectResourcePath(path))}
                      >
                        {item.label}
                      </Breadcrumbs.Link>
                    )}
                  </Breadcrumbs.Item>
                );
              })}
            </Breadcrumbs.List>
          </Breadcrumbs.Root>
        ) : (
          <p>{pageEyebrow}</p>
        )}
        <h1 className="city-text-page-title">{pageLabel}</h1>
        {pageDescription ? (
          <span
            className={
              currentVolumeAnonymous
                ? "city-text-caption text-city-muted-foreground font-mono"
                : "city-text-supporting"
            }
          >
            {pageDescription}
          </span>
        ) : null}
      </div>
      <div className="overseer-page-actions">
        <PageHeaderSlotOutlet name="utilities" className="overseer-page-utilities">
          <Button
            onClick={() => {
              if (isOperationsPage) {
                setOperationsRefreshRevision((value) => value + 1);
                void loadOperations();
                return;
              }
              if (
                resourcePath === "/settings" ||
                resourcePath === "/docker-plugins" ||
                resourcePath.startsWith("/builds") ||
                resourcePath.startsWith("/instances")
              ) {
                setSettingsRefreshRevision((value) => value + 1);
              }
              if (currentDetail) {
                setDetailRefreshRevision((value) => value + 1);
              }
              if (!runtimeRunning) void refreshStartup();
              void refresh();
            }}
            size="sm"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={14} />
            새로고침
          </Button>
        </PageHeaderSlotOutlet>
        <PageHeaderSlotOutlet name="actions" className="overseer-primary-action" />
      </div>
    </section>
  );
}
