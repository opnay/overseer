import { APP_ROUTE_GROUPS, getAppDetailLocation, type AppLocationPath } from "@/shared/routes";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { useNavigationMode } from "../../model/use-navigation-mode.ts";
const LOADING_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5"] as const;
const LOADING_SECTIONS = ["section-1", "section-2"] as const;
const LOADING_NAV_ITEMS = ["nav-1", "nav-2", "nav-3", "nav-4"] as const;

type PageLoadingPattern = "collection" | "detail" | "settings";

function pageLoadingPattern(path: AppLocationPath): PageLoadingPattern {
  if (path === "/settings") return "settings";
  const detail = getAppDetailLocation(path);
  return detail && detail.type !== "imageRepository" ? "detail" : "collection";
}

function CollectionLoadingBody() {
  return (
    <section
      aria-label="목록 불러오는 중"
      className="overseer-loading-collection"
      data-loading-pattern="collection"
    >
      <div aria-hidden="true" className="overseer-loading-table-row overseer-loading-table-head">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      {LOADING_ROWS.map((row) => (
        <div aria-hidden="true" className="overseer-loading-table-row" key={row}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ))}
    </section>
  );
}

function SectionedLoadingBody({ pattern }: { pattern: Exclude<PageLoadingPattern, "collection"> }) {
  if (pattern === "settings") {
    return (
      <section
        aria-label="설정 불러오는 중"
        className="overseer-settings-loading"
        data-loading-pattern="settings"
      >
        {LOADING_SECTIONS.map((item) => (
          <div aria-hidden="true" className="overseer-loading-form-section" key={item}>
            <Skeleton className="overseer-loading-form-title" />
            <Skeleton className="overseer-loading-form-field" />
            <Skeleton className="overseer-loading-form-field" />
          </div>
        ))}
      </section>
    );
  }
  return (
    <section
      aria-label="상세 정보 불러오는 중"
      className="overseer-sectioned-workspace overseer-loading-sectioned"
      data-loading-pattern={pattern}
    >
      <aside aria-hidden="true" className="overseer-sectioned-workspace-sidebar">
        <nav className="overseer-sectioned-workspace-desktop-navigation overseer-loading-section-navigation">
          <Skeleton className="overseer-loading-section-navigation-label" />
          {LOADING_NAV_ITEMS.map((item) => (
            <Skeleton className="overseer-loading-section-navigation-item" key={item} />
          ))}
        </nav>
        <div className="overseer-sectioned-workspace-mobile-navigation">
          <Skeleton className="overseer-loading-section-navigation-label" />
          <Skeleton className="overseer-loading-section-select" />
        </div>
      </aside>
      <div aria-hidden="true" className="overseer-sectioned-workspace-content">
        <header className="overseer-sectioned-workspace-header">
          <Skeleton className="overseer-loading-section-category" />
          <Skeleton className="overseer-loading-section-title" />
          <Skeleton className="overseer-loading-section-description" />
        </header>
        <div className="overseer-sectioned-workspace-body overseer-loading-section-body">
          {pattern === "detail" ? (
            <div className="overseer-detail-summary overseer-loading-summary">
              {["summary-1", "summary-2", "summary-3"].map((item) => (
                <div key={item}>
                  <Skeleton className="overseer-loading-summary-label" />
                  <Skeleton className="overseer-loading-summary-value" />
                </div>
              ))}
            </div>
          ) : null}
          {LOADING_SECTIONS.map((item) => (
            <div className="overseer-loading-form-section" key={item}>
              <Skeleton className="overseer-loading-form-title" />
              <Skeleton className="overseer-loading-form-field" />
              <Skeleton className="overseer-loading-form-field" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PageLoadingBody({ path }: { path: AppLocationPath }) {
  const pattern = pageLoadingPattern(path);
  return pattern === "collection" ? (
    <CollectionLoadingBody />
  ) : (
    <SectionedLoadingBody pattern={pattern} />
  );
}

function StartupLoadingScreen() {
  return (
    <div
      aria-busy="true"
      aria-label="시작 준비 화면 불러오는 중"
      className="overseer-startup-shell"
      data-loading-pattern="startup"
    >
      <main aria-hidden="true" className="overseer-startup overseer-loading-startup">
        <header className="overseer-startup-header">
          <Skeleton className="overseer-loading-startup-brand" />
          <Skeleton className="overseer-loading-eyebrow" />
          <Skeleton className="overseer-loading-title" />
        </header>
        <div className="overseer-startup-workflow">
          <aside className="overseer-startup-step-panel">
            <Skeleton className="overseer-loading-startup-step-label" />
            <ol className="overseer-startup-steps">
              {LOADING_NAV_ITEMS.map((item) => (
                <li key={item}>
                  <Skeleton className="overseer-loading-startup-step-number" />
                  <div className="overseer-startup-step-copy">
                    <Skeleton className="overseer-loading-startup-step-title" />
                    <Skeleton className="overseer-loading-startup-step-status" />
                  </div>
                </li>
              ))}
            </ol>
          </aside>
          <section className="overseer-startup-content">
            <header className="overseer-startup-content-header">
              <div>
                <Skeleton className="overseer-loading-eyebrow" />
                <Skeleton className="overseer-loading-section-title" />
                <Skeleton className="overseer-loading-section-description" />
              </div>
            </header>
            <Skeleton className="overseer-loading-startup-guidance" />
            <Skeleton className="overseer-loading-startup-action" />
          </section>
        </div>
      </main>
    </div>
  );
}

export function LoadingScreen({
  path,
  startup = false,
}: {
  path: AppLocationPath;
  startup?: boolean;
}) {
  const mode = useNavigationMode();

  if (startup) return <StartupLoadingScreen />;

  return (
    <div
      aria-busy="true"
      aria-label="화면 준비 중"
      className="overseer-shell"
      data-navigation-mode={mode}
    >
      {mode !== "mobile" ? (
        <aside
          aria-hidden="true"
          className="overseer-sidebar overseer-loading-sidebar"
          data-navigation-mode={mode}
        >
          <div className="overseer-category-rail">
            <Skeleton className="overseer-loading-rail-icon" />
            <div className="overseer-category-navigation">
              {APP_ROUTE_GROUPS.map((group) => (
                <Skeleton className="overseer-loading-rail-icon" key={group.id} />
              ))}
            </div>
          </div>
          <div className="overseer-secondary-sidebar">
            <Skeleton className="overseer-loading-nav-label" />
            <div className="overseer-loading-nav-items">
              {LOADING_NAV_ITEMS.map((item) => (
                <Skeleton className="overseer-loading-nav-item" key={item} />
              ))}
            </div>
          </div>
        </aside>
      ) : null}
      <div className="overseer-workspace">
        <main className="overseer-main">
          <div aria-hidden="true" className="overseer-loading-heading">
            <Skeleton className="overseer-loading-eyebrow" />
            <Skeleton className="overseer-loading-title" />
            <Skeleton className="overseer-loading-description" />
          </div>
          <PageLoadingBody path={path} />
        </main>
      </div>
    </div>
  );
}
