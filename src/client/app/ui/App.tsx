import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Breadcrumbs } from "@opnay/city-ds-react/breadcrumbs";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Toolbar } from "@opnay/city-ds-react/toolbar";
import { Toaster, toast } from "@opnay/city-ds-react/toast";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import {
  ArrowDownToLine,
  Boxes,
  Check,
  Cloud,
  Container,
  Copy,
  Database,
  Download,
  HardDrive,
  Layers3,
  ListChecks,
  Menu,
  Moon,
  Network as NetworkIcon,
  Play,
  Puzzle,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Server,
  Square,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  ComposeProjectAction,
  ComposeBuilderInput,
  ComposeProjectSummary,
  ContainerDetail,
  ContainerSpecInput,
  ContainerSummary,
  CreateRuntimeInstanceInput,
  DashboardSnapshot,
  DeleteRuntimeInstanceInput,
  DockerCliPluginId,
  DockerEngineConfiguration,
  ImageRepositorySummary,
  ImageRepositoryDetail,
  ImageSummary,
  NetworkSummary,
  OperationAccepted,
  OperationSnapshot,
  OperationResource,
  RegisterRemoteComposeInput,
  RuntimeInstanceSummary,
  RuntimePhase,
  StartupInstallTarget,
  StartupPrerequisiteId,
  StartupSnapshot,
  StartupStepId,
  ToolUpdateId,
  UpdateRuntimeInstanceInput,
  UpdateDockerDaemonConfigurationSectionInput,
  VolumeSummary,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { followLink } from "@/shared/lib/follow-link";
import { LogViewer } from "@/shared/ui/log-viewer";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { NamedResourceDialog } from "@/shared/ui/named-resource-dialog";
import {
  APP_ROUTES,
  APP_ROUTE_GROUPS,
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  getAppRoute,
  imageDetailPath,
  imageRepositoryDetailPath,
  networkDetailPath,
  runtimeInstanceDetailPath,
  type AppLocationPath,
  type AppPath,
  volumeDetailPath,
} from "@/shared/routes";

const RunContainerDialog = lazy(() =>
  import("@/pages/containers").then((module) => ({ default: module.RunContainerDialog })),
);
const ContainersPage = lazy(() =>
  import("@/pages/containers").then((module) => ({ default: module.ContainersPage })),
);
const ComposePage = lazy(() =>
  import("@/pages/compose").then((module) => ({ default: module.ComposePage })),
);
const ImagesPage = lazy(() =>
  import("@/pages/images").then((module) => ({ default: module.ImagesPage })),
);
const PullImageDialog = lazy(() =>
  import("@/pages/images").then((module) => ({ default: module.PullImageDialog })),
);
const ImageViewToggle = lazy(() =>
  import("@/pages/images").then((module) => ({ default: module.ImageViewToggle })),
);
const ImageRepositoriesPage = lazy(() =>
  import("@/pages/image-repositories").then((module) => ({
    default: module.ImageRepositoriesPage,
  })),
);
const DockerCliPluginsPage = lazy(() =>
  import("@/pages/docker-plugins").then((module) => ({
    default: module.DockerCliPluginsPage,
  })),
);
const ImageRepositoryDetailPage = lazy(() =>
  import("@/pages/image-repositories").then((module) => ({
    default: module.ImageRepositoryDetailPage,
  })),
);
const AddImageRepositoryDialog = lazy(() =>
  import("@/pages/image-repositories").then((module) => ({
    default: module.AddImageRepositoryDialog,
  })),
);
const NetworksPage = lazy(() =>
  import("@/pages/networks").then((module) => ({ default: module.NetworksPage })),
);
const VolumesPage = lazy(() =>
  import("@/pages/volumes").then((module) => ({ default: module.VolumesPage })),
);
const EditContainerDialog = lazy(() =>
  import("@/pages/containers").then((module) => ({ default: module.EditContainerDialog })),
);
const OperationsDrawer = lazy(() =>
  import("@/pages/operations").then((module) => ({ default: module.OperationsDrawer })),
);
const RemoteComposeDialog = lazy(() =>
  import("@/pages/compose").then((module) => ({
    default: module.RemoteComposeDialog,
  })),
);
const OperationsPage = lazy(() =>
  import("@/pages/operations").then((module) => ({ default: module.OperationsPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings").then((module) => ({ default: module.SettingsPage })),
);
const RuntimeInstancesPage = lazy(() =>
  import("@/pages/instances").then((module) => ({
    default: module.RuntimeInstancesPage,
  })),
);
const RuntimeInstanceCreateDialog = lazy(() =>
  import("@/pages/instances").then((module) => ({
    default: module.RuntimeInstanceCreateDialog,
  })),
);
const RuntimeInstanceDetailPage = lazy(() =>
  import("@/pages/instances").then((module) => ({
    default: module.RuntimeInstanceDetailPage,
  })),
);
const RuntimeInstanceHeaderActions = lazy(() =>
  import("@/pages/instances").then((module) => ({
    default: module.RuntimeInstanceHeaderActions,
  })),
);
const StartupPage = lazy(() =>
  import("@/pages/startup").then((module) => ({ default: module.StartupPage })),
);
const ComposeProjectDetailPage = lazy(() =>
  import("@/pages/compose").then((module) => ({
    default: module.ComposeProjectDetailPage,
  })),
);
const ContainerDetailPage = lazy(() =>
  import("@/pages/containers").then((module) => ({
    default: module.ContainerDetailPage,
  })),
);
const ImageDetailPage = lazy(() =>
  import("@/pages/images").then((module) => ({
    default: module.ImageDetailPage,
  })),
);
const NetworkDetailPage = lazy(() =>
  import("@/pages/networks").then((module) => ({
    default: module.NetworkDetailPage,
  })),
);
const VolumeDetailPage = lazy(() =>
  import("@/pages/volumes").then((module) => ({
    default: module.VolumeDetailPage,
  })),
);
const CreateBuilderComposeDialog = lazy(() =>
  import("@/pages/compose").then((module) => ({
    default: module.CreateBuilderComposeDialog,
  })),
);

const resourceRouteIcon = {
  "/compose": Layers3,
  "/containers": Boxes,
  "/docker-plugins": Puzzle,
  "/images": HardDrive,
  "/image-repositories": Cloud,
  "/instances": Server,
  "/networks": NetworkIcon,
  "/operations": ListChecks,
  "/settings": Settings2,
  "/volumes": Database,
} satisfies Record<AppPath, typeof Layers3>;

const STARTUP_REFRESH_FEEDBACK_MS = 500;

type NavigationMode = "desktop" | "mobile" | "rail";

function navigationMode(): NavigationMode {
  if (window.matchMedia("(max-width: 42rem)").matches) return "mobile";
  if (window.matchMedia("(max-width: 52rem)").matches) return "rail";
  return "desktop";
}

function useNavigationMode(): NavigationMode {
  const [mode, setMode] = useState(navigationMode);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 42rem)");
    const rail = window.matchMedia("(max-width: 52rem)");
    const sync = () => setMode(mobile.matches ? "mobile" : rail.matches ? "rail" : "desktop");
    sync();
    mobile.addEventListener("change", sync);
    rail.addEventListener("change", sync);
    return () => {
      mobile.removeEventListener("change", sync);
      rail.removeEventListener("change", sync);
    };
  }, []);

  return mode;
}

function AppBrand() {
  return (
    <div className="overseer-brand">
      <span aria-hidden="true">
        <Container size={20} strokeWidth={1.8} />
      </span>
      <div>
        <strong>Overseer</strong>
        <small>Lima 제어판</small>
      </div>
    </div>
  );
}

function PrimaryNavigation({
  currentPath,
  mode,
  onSelect,
}: {
  currentPath: AppPath;
  mode: Exclude<NavigationMode, "mobile"> | "drawer";
  onSelect(path: AppPath): void;
}) {
  return (
    <nav aria-label="주요 메뉴" className="overseer-navigation">
      {APP_ROUTE_GROUPS.map((group) => {
        const labelId = `overseer-nav-${mode}-${group.id}`;
        return (
          <div aria-labelledby={labelId} className="overseer-nav-group" key={group.id} role="group">
            <span className="overseer-nav-group-label" id={labelId}>
              {group.label}
            </span>
            <div className="overseer-nav-group-items">
              {APP_ROUTES.filter((route) => route.group === group.id).map((route) => {
                const Icon = resourceRouteIcon[route.path];
                const link = (
                  <a
                    aria-current={currentPath === route.path ? "page" : undefined}
                    aria-label={mode === "rail" ? route.label : undefined}
                    href={route.path}
                    key={route.path}
                    onClick={(event) => followLink(event, () => onSelect(route.path))}
                  >
                    <Icon aria-hidden="true" size={16} />
                    <span className="overseer-nav-link-label">{route.label}</span>
                  </a>
                );
                if (mode !== "rail") return link;
                return (
                  <Tooltip.Root key={route.path}>
                    <Tooltip.Trigger render={link} />
                    <Tooltip.Portal>
                      <Tooltip.Positioner side="right" sideOffset={8}>
                        <Tooltip.Popup>{route.label}</Tooltip.Popup>
                      </Tooltip.Positioner>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function UtilityNavigation({
  currentPath,
  mode,
  onSelect,
}: {
  currentPath: AppPath;
  mode: Exclude<NavigationMode, "mobile"> | "drawer";
  onSelect(path: AppPath): void;
}) {
  const route = APP_ROUTES.find(({ path }) => path === "/settings")!;
  const link = (
    <a
      aria-current={currentPath === route.path ? "page" : undefined}
      aria-label={mode === "rail" ? route.label : undefined}
      href={route.path}
      onClick={(event) => followLink(event, () => onSelect(route.path))}
    >
      <Settings2 aria-hidden="true" size={16} />
      <span className="overseer-nav-link-label">{route.label}</span>
    </a>
  );
  if (mode !== "rail") {
    return (
      <nav aria-label="유틸리티 메뉴" className="overseer-sidebar-utility">
        {link}
      </nav>
    );
  }
  return (
    <nav aria-label="유틸리티 메뉴" className="overseer-sidebar-utility">
      <Tooltip.Root>
        <Tooltip.Trigger render={link} />
        <Tooltip.Portal>
          <Tooltip.Positioner side="right" sideOffset={8}>
            <Tooltip.Popup>{route.label}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </nav>
  );
}

const runtimePresentation: Record<
  RuntimePhase,
  { label: string; tone: "destructive" | "info" | "neutral" | "success" | "warning" }
> = {
  error: { label: "오류", tone: "destructive" },
  missing: { label: "설정 필요", tone: "neutral" },
  running: { label: "실행 중", tone: "success" },
  starting: { label: "준비 중", tone: "info" },
  stopped: { label: "중지됨", tone: "warning" },
  stopping: { label: "중지 중", tone: "info" },
};

function MobileNavigationDrawer({
  currentPath,
  onSelect,
}: {
  currentPath: AppPath;
  onSelect(path: AppPath): void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root modal onOpenChange={setOpen} open={open} swipeDirection="left">
      <Drawer.Trigger
        render={<Button aria-label="주요 메뉴 열기" iconOnly size="sm" variant="ghost" />}
      >
        <Menu aria-hidden="true" size={17} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport side="left">
          <Drawer.Popup side="left" size="sm">
            <Drawer.Header>
              <div>
                <Drawer.Title>주요 메뉴</Drawer.Title>
                <Drawer.Description>Overseer 전역 화면으로 이동합니다.</Drawer.Description>
              </div>
              <Drawer.Close
                render={<Button aria-label="주요 메뉴 닫기" iconOnly size="sm" variant="ghost" />}
              >
                <X aria-hidden="true" size={16} />
              </Drawer.Close>
            </Drawer.Header>
            <Drawer.Content className="overseer-mobile-navigation-body">
              <PrimaryNavigation
                currentPath={currentPath}
                mode="drawer"
                onSelect={(path) => {
                  setOpen(false);
                  onSelect(path);
                }}
              />
              <UtilityNavigation
                currentPath={currentPath}
                mode="drawer"
                onSelect={(path) => {
                  setOpen(false);
                  onSelect(path);
                }}
              />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

function LoadingScreen() {
  const mode = useNavigationMode();

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
          <Skeleton className="overseer-loading-brand" />
          <div className="overseer-loading-nav">
            {APP_ROUTE_GROUPS.map((group) => (
              <div className="overseer-loading-nav-group" key={group.id}>
                <Skeleton className="overseer-loading-nav-label" />
                <div className="overseer-loading-nav-items">
                  {APP_ROUTES.filter((route) => route.group === group.id).map((route) => (
                    <Skeleton className="overseer-loading-nav-item" key={route.path} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="overseer-workspace">
        {mode === "mobile" ? (
          <header aria-hidden="true" className="overseer-mobile-header">
            <Skeleton className="overseer-loading-mobile-brand" />
            <Skeleton className="overseer-loading-mobile-actions" />
          </header>
        ) : (
          <header aria-hidden="true" className="overseer-topbar">
            <Skeleton className="overseer-loading-topbar-context" />
            <Skeleton className="overseer-loading-topbar-action" />
          </header>
        )}
        <main className="overseer-main">
          <div aria-hidden="true" className="overseer-loading-heading">
            <Skeleton className="overseer-loading-eyebrow" />
            <Skeleton className="overseer-loading-title" />
            <Skeleton className="overseer-loading-description" />
          </div>
          <Skeleton className="overseer-loading-table" />
        </main>
      </div>
    </div>
  );
}

interface LogsTarget {
  description: string;
  requestPath: string;
  title: string;
}

function LogsDialog({ onClose, target }: { onClose: () => void; target?: LogsTarget }) {
  const [logs, setLogs] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!target) return;
      if (!quiet) setLoading(true);
      setError(undefined);
      try {
        const result = await apiRequest<{ logs: string }>(target.requestPath);
        setLogs(result.logs);
      } catch (loadError) {
        setError(actionError(loadError));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [target],
  );

  useEffect(() => {
    setLogs("");
    setError(undefined);
    setFollowing(true);
    setCopied(false);
    if (target) void load();
  }, [target, load]);

  useEffect(() => {
    if (!target || !following) return;
    const interval = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(interval);
  }, [following, load, target]);

  useEffect(() => {
    if (!following || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [following, logs]);

  const copyLogs = async () => {
    if (!logs || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const lines = logs ? logs.split(/\r?\n/) : [];

  return (
    <Dialog.Root onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="xl">
            <Dialog.Header>
              <div>
                <Dialog.Title>{target?.title}</Dialog.Title>
                <Dialog.Description>{target?.description}</Dialog.Description>
              </div>
            </Dialog.Header>
            <Dialog.Body className="overseer-log-stack">
              {error ? (
                <Alert.Root tone="destructive">
                  <Alert.Title level={3}>로그를 불러오지 못했습니다.</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
              <LogViewer
                actions={
                  <Toolbar.Root appearance="plain" aria-label="로그 명령" size="sm">
                    <Toolbar.Button
                      disabled={!logs}
                      onClick={() => void copyLogs()}
                      variant="ghost"
                    >
                      {copied ? (
                        <Check aria-hidden="true" size={14} />
                      ) : (
                        <Copy aria-hidden="true" size={14} />
                      )}
                      {copied ? "복사됨" : "복사"}
                    </Toolbar.Button>
                    <Toolbar.Button
                      disabled={!logs}
                      onClick={() => {
                        if (scrollRef.current) {
                          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }
                      }}
                      variant="ghost"
                    >
                      <ArrowDownToLine aria-hidden="true" size={14} />
                      맨 아래
                    </Toolbar.Button>
                    <Toolbar.Toggle
                      aria-label={following ? "자동 갱신 켜짐" : "자동 갱신 꺼짐"}
                      onPressedChange={setFollowing}
                      pressed={following}
                      variant="ghost"
                    >
                      <Radio aria-hidden="true" size={14} />
                      자동 갱신
                    </Toolbar.Toggle>
                    <Toolbar.Button disabled={loading} onClick={() => void load()} variant="ghost">
                      <RefreshCw aria-hidden="true" size={14} />
                      새로고침
                    </Toolbar.Button>
                  </Toolbar.Root>
                }
                ariaLabel={`${target?.title} 터미널`}
                context={
                  <>
                    <Terminal aria-hidden="true" size={14} />
                    <code>tail -n 300</code>
                    <span aria-live="polite">{loading ? "동기화 중…" : `${lines.length}줄`}</span>
                  </>
                }
                emptyMessage="출력된 로그가 없습니다."
                height="expanded"
                key={target?.requestPath ?? "empty-log"}
                loading={loading}
                loadingMessage="로그를 불러오는 중…"
                scrollRef={scrollRef}
                value={logs}
              />
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.Close render={<Button variant="outline" />}>닫기</Dialog.Close>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface MutationOptions {
  key: string;
  onAccepted?: (operation: OperationSnapshot) => void;
  request: () => Promise<OperationAccepted>;
}

function resourcePathFromLocation(): AppLocationPath {
  return getAppLocation(window.location.pathname);
}

function startupRouteFromLocation(): boolean {
  return window.location.pathname === "/startup";
}

type StartupPreview = Exclude<StartupPrerequisiteId, "compose">;

function startupPreviewFromLocation(): StartupPreview | undefined {
  const value = new URLSearchParams(window.location.search).get("startup-preview");
  return value === "homebrew" || value === "docker" || value === "lima" ? value : undefined;
}

const startupPreviewStates: Record<StartupPreview, Record<StartupPrerequisiteId, boolean>> = {
  docker: { compose: false, docker: false, homebrew: true, lima: false },
  homebrew: { compose: false, docker: false, homebrew: false, lima: false },
  lima: { compose: true, docker: true, homebrew: true, lima: false },
};

const startupMissingReasons: Record<StartupPrerequisiteId, string> = {
  compose: "Docker Compose 플러그인을 찾을 수 없습니다.",
  docker: "Docker CLI를 찾을 수 없습니다.",
  homebrew: "Homebrew 실행 파일을 찾을 수 없습니다.",
  lima: "Lima 실행 파일을 찾을 수 없습니다.",
};

function withStartupPreview(snapshot: StartupSnapshot, preview: StartupPreview): StartupSnapshot {
  return {
    prerequisites: snapshot.prerequisites.map((prerequisite) => {
      const installed = startupPreviewStates[preview][prerequisite.id];
      const { missingReason: _missingReason, version, ...rest } = prerequisite;
      return {
        ...rest,
        automaticInstall: prerequisite.id === "homebrew" ? false : preview !== "homebrew",
        ...(preview === "homebrew" && prerequisite.id !== "homebrew"
          ? {
              automaticInstallUnavailableReason: "Homebrew를 먼저 설치해야 합니다.",
            }
          : {}),
        installed,
        ...(installed && version ? { version } : {}),
        ...(!installed ? { missingReason: startupMissingReasons[prerequisite.id] } : {}),
      };
    }),
    ready: false,
  };
}

export function App() {
  return (
    <>
      <AppContent />
      <Toaster
        duration={5_000}
        toastOptions={{ closeButtonAriaLabel: "알림 닫기" }}
        visibleToasts={3}
      />
    </>
  );
}

function AppContent() {
  const navigationMode = useNavigationMode();
  const [startupPreview] = useState(startupPreviewFromLocation);
  const [startupRoute, setStartupRoute] = useState(startupRouteFromLocation);
  const [startupReviewMode, setStartupReviewMode] = useState(startupRouteFromLocation);
  const [dashboard, setDashboard] = useState<DashboardSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [startup, setStartup] = useState<StartupSnapshot>();
  const [startupError, setStartupError] = useState<string>();
  const [startupOperationId, setStartupOperationId] = useState<string>();
  const [startupRefreshing, setStartupRefreshing] = useState(false);
  const [startupStep, setStartupStep] = useState<StartupStepId>();
  const [composeSkipped, setComposeSkipped] = useState(
    () =>
      startupPreview !== "docker" &&
      window.localStorage.getItem("overseer-compose-setup") === "skipped",
  );
  const [engineSetupSkipped, setEngineSetupSkipped] = useState(
    () => window.sessionStorage.getItem("overseer-engine-setup") === "skipped",
  );
  const [operationError, setOperationError] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);
  const [editContainer, setEditContainer] = useState<ContainerSummary>();
  const [runContainerImage, setRunContainerImage] = useState<string>();
  const [logsTarget, setLogsTarget] = useState<LogsTarget>();
  const [dark, setDark] = useState(() => window.localStorage.getItem("overseer-theme") === "dark");
  const [resourcePath, setResourcePath] = useState<AppLocationPath>(resourcePathFromLocation);
  const [detailRefreshRevision, setDetailRefreshRevision] = useState(0);
  const [settingsRefreshRevision, setSettingsRefreshRevision] = useState(0);
  const [imageRepositoryRefreshRevision, setImageRepositoryRefreshRevision] = useState(0);
  const [imageView, setImageView] = useState<"id" | "tag">("tag");
  const [imageRepositoryHeader, setImageRepositoryHeader] = useState<ImageRepositoryDetail>();
  const [runtimeInstanceHeaderState, setRuntimeInstanceHeaderState] = useState<{
    instance: RuntimeInstanceSummary;
    selectionLocked: boolean;
  }>();
  const notifiedOperations = useRef(new Set<string>());
  const operationsInitialized = useRef(false);
  const startupLoaded = useRef(false);
  const startupRefreshQueued = useRef(false);
  const startupRefreshInFlight = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoadError(undefined);
    try {
      setDashboard(await apiRequest<DashboardSnapshot>("/dashboard"));
    } catch (error) {
      setLoadError(actionError(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setRuntimeInstanceHeaderState(undefined);
    setImageRepositoryHeader(undefined);
  }, [resourcePath]);

  const refreshStartup = useCallback(async () => {
    if (startupRefreshInFlight.current) {
      startupRefreshQueued.current = true;
      return;
    }
    do {
      startupRefreshQueued.current = false;
      startupRefreshInFlight.current = true;
      const showFeedback = startupLoaded.current;
      if (showFeedback) setStartupRefreshing(true);
      setStartupError(undefined);
      const startedAt = Date.now();
      try {
        setStartup(await apiRequest<StartupSnapshot>("/startup"));
      } catch (error) {
        setStartupError(actionError(error));
      } finally {
        const remaining = STARTUP_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
        if (showFeedback && remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        startupLoaded.current = true;
        startupRefreshInFlight.current = false;
        if (showFeedback) setStartupRefreshing(false);
      }
    } while (startupRefreshQueued.current);
  }, []);

  const displayedStartup =
    startup && startupPreview ? withStartupPreview(startup, startupPreview) : startup;
  const firstMissingRequiredPrerequisite = displayedStartup?.prerequisites.find(
    ({ installed, required }) => required && !installed,
  );
  const composePrerequisite = displayedStartup?.prerequisites.find(({ id }) => id === "compose");
  const dockerInstalled = displayedStartup?.prerequisites.find(
    ({ id }) => id === "docker",
  )?.installed;
  const composeDecisionPending = Boolean(
    composePrerequisite &&
    !composePrerequisite.installed &&
    !composeSkipped &&
    dockerInstalled &&
    firstMissingRequiredPrerequisite?.id !== "homebrew" &&
    firstMissingRequiredPrerequisite?.id !== "docker",
  );
  const prerequisiteStartupStep = composeDecisionPending
    ? "compose"
    : firstMissingRequiredPrerequisite?.id;
  const detectedStartupStep: StartupStepId | undefined =
    prerequisiteStartupStep ??
    (displayedStartup?.ready && dashboard?.runtime.phase !== "running" ? "engine" : undefined);
  const requiredStartupStep =
    detectedStartupStep === "engine" && engineSetupSkipped && !startupRoute
      ? undefined
      : detectedStartupStep;
  const engineManagementRoute =
    requiredStartupStep === "engine" &&
    (resourcePath === "/settings" ||
      resourcePath === "/docker-plugins" ||
      resourcePath.startsWith("/image-repositories") ||
      resourcePath.startsWith("/instances"));
  const entryStartupStep =
    startupReviewMode && !startupPreview
      ? "homebrew"
      : engineManagementRoute
        ? undefined
        : requiredStartupStep;
  const currentStartupStep = startupStep ?? entryStartupStep;
  const startupVisible = Boolean(displayedStartup && currentStartupStep);
  const startupCheckPending = Boolean(
    dashboard &&
    (dashboard.runtime.phase !== "running" || startupPreview || startupRoute) &&
    !startup &&
    !startupError,
  );

  useEffect(() => {
    if (!startupVisible) return;
    const interval = window.setInterval(() => {
      if (currentStartupStep === "engine") {
        void Promise.all([refreshStartup(), refresh(true)]);
        return;
      }
      void refreshStartup();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [currentStartupStep, refresh, refreshStartup, startupVisible]);

  useEffect(() => {
    if (startupStep || !entryStartupStep) return;
    setStartupStep(entryStartupStep);
  }, [entryStartupStep, startupStep]);

  useEffect(() => {
    if (
      !displayedStartup ||
      startupRoute ||
      !requiredStartupStep ||
      (requiredStartupStep === "engine" &&
        (resourcePath === "/settings" ||
          resourcePath === "/docker-plugins" ||
          resourcePath.startsWith("/image-repositories") ||
          resourcePath.startsWith("/instances")))
    ) {
      return;
    }
    setStartupReviewMode(false);
    setStartupRoute(true);
    window.history.replaceState(null, "", `/startup${window.location.search}`);
  }, [displayedStartup, requiredStartupStep, resourcePath, startupRoute]);

  useEffect(() => {
    if (!dashboard || (dashboard.runtime.phase === "running" && !startupPreview && !startupRoute)) {
      return;
    }
    void refreshStartup();
  }, [dashboard?.runtime.phase, refreshStartup, startupPreview, startupRoute]);

  const refreshResource = useCallback(
    async (resource: OperationResource) => {
      try {
        if (resource === "startup") {
          await Promise.all([refreshStartup(), refresh(true)]);
          return;
        }
        if (resource === "runtime") {
          await refresh(true);
          return;
        }
        if (resource === "dockerPlugin" || resource === "imageRepository") return;
        if (resource === "compose") {
          const { projects } = await apiRequest<{ projects: ComposeProjectSummary[] }>(
            "/compose/projects",
          );
          setDashboard((current) =>
            current ? { ...current, composeProjects: projects } : current,
          );
          return;
        }
        if (resource === "container") {
          const { containers } = await apiRequest<{ containers: ContainerSummary[] }>(
            "/containers",
          );
          setDashboard((current) => (current ? { ...current, containers } : current));
          return;
        }
        if (resource === "image") {
          const { images } = await apiRequest<{ images: ImageSummary[] }>("/images");
          setDashboard((current) => (current ? { ...current, images } : current));
          return;
        }
        if (resource === "volume") {
          const { volumes } = await apiRequest<{ volumes: VolumeSummary[] }>("/volumes");
          setDashboard((current) => (current ? { ...current, volumes } : current));
          return;
        }
        const { networks } = await apiRequest<{ networks: NetworkSummary[] }>("/networks");
        setDashboard((current) => (current ? { ...current, networks } : current));
      } catch (error) {
        setLoadError(actionError(error));
      }
    },
    [refresh, refreshStartup],
  );

  const loadOperations = useCallback(async () => {
    try {
      const result = await apiRequest<{ operations: OperationSnapshot[] }>("/operations");
      const nextOperations = Array.isArray(result.operations) ? result.operations : [];
      if (!operationsInitialized.current) {
        for (const operation of nextOperations) {
          if (operation.status !== "queued" && operation.status !== "running") {
            notifiedOperations.current.add(operation.id);
          }
        }
        operationsInitialized.current = true;
      }
      setOperations(nextOperations);
    } catch (error) {
      setOperationError(actionError(error));
    }
  }, []);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const hasActiveOperations = operations.some(
    ({ status }) => status === "queued" || status === "running",
  );
  const operationsRefreshToken = operations
    .map(({ id, status, step }) => `${id}:${status}:${step}`)
    .join("|");
  const latestFinishedImageRepositoryOperation = operations.find(
    ({ status, target }) =>
      target.resource === "imageRepository" && status !== "queued" && status !== "running",
  );
  const imageRepositoryOperationRefreshToken = latestFinishedImageRepositoryOperation
    ? `${latestFinishedImageRepositoryOperation.id}:${latestFinishedImageRepositoryOperation.status}`
    : "";
  const dockerPluginOperationRefreshToken = operations
    .filter(({ target }) => target.resource === "dockerPlugin")
    .map(({ id, status }) => `${id}:${status}`)
    .join("|");

  useEffect(() => {
    if (!hasActiveOperations) return;
    const interval = window.setInterval(() => void loadOperations(), 1_000);
    return () => window.clearInterval(interval);
  }, [hasActiveOperations, loadOperations]);

  useEffect(() => {
    for (const operation of operations) {
      if (
        operation.status === "queued" ||
        operation.status === "running" ||
        notifiedOperations.current.has(operation.id)
      ) {
        continue;
      }
      notifiedOperations.current.add(operation.id);
      if (operation.status === "succeeded") {
        toast.success("작업을 완료했습니다.", {
          description: operation.successMessage,
          id: `operation-${operation.id}-succeeded`,
          testId: `operation-${operation.id}-succeeded`,
        });
        const resources = new Set<OperationResource>([operation.target.resource]);
        if (operation.kind === "container.create" || operation.kind === "container.update") {
          resources.add("image");
        }
        if (operation.target.resource === "compose") {
          resources.add("container");
          resources.add("image");
          resources.add("network");
        }
        for (const resource of resources) void refreshResource(resource);
      } else if (operation.status === "failed") {
        toast.warning("작업이 실패했습니다.", {
          description: operation.error?.message ?? "작업을 완료하지 못했습니다.",
          id: `operation-${operation.id}-failed`,
          testId: `operation-${operation.id}-failed`,
        });
        if (operation.target.resource === "runtime" || operation.target.resource === "startup") {
          void refreshResource(operation.target.resource);
        }
      }
    }
  }, [operations, refreshResource]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("overseer-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!startupRoute && window.location.pathname !== resourcePath) {
      window.history.replaceState(null, "", resourcePath);
    }
    const syncResourcePath = () => {
      const nextStartupRoute = startupRouteFromLocation();
      setStartupRoute(nextStartupRoute);
      setStartupReviewMode(nextStartupRoute);
      setStartupOperationId(undefined);
      setStartupStep(nextStartupRoute ? "homebrew" : undefined);
      if (!nextStartupRoute) setResourcePath(resourcePathFromLocation());
    };
    window.addEventListener("popstate", syncResourcePath);
    return () => window.removeEventListener("popstate", syncResourcePath);
  }, []);

  const selectResourcePath = useCallback((nextPath: AppLocationPath) => {
    setStartupRoute(false);
    setStartupReviewMode(false);
    setResourcePath(nextPath);
    if (window.location.pathname !== nextPath) window.history.pushState(null, "", nextPath);
  }, []);

  const mutate = async ({ key, onAccepted, request }: MutationOptions) => {
    setSubmitting(key);
    setOperationError(undefined);
    try {
      const { operation } = await request();
      if (!operation) throw new Error("작업 응답을 확인하지 못했습니다.");
      setOperations((current) => [operation, ...current.filter(({ id }) => id !== operation.id)]);
      onAccepted?.(operation);
      toast.info("작업을 시작했습니다.", {
        description: operation.title,
        id: `operation-${operation.id}-started`,
        testId: `operation-${operation.id}-started`,
      });
    } catch (error) {
      const message = actionError(error);
      setOperationError(message);
      throw error;
    } finally {
      setSubmitting(undefined);
    }
  };

  const cancelOperation = async (id: string) => {
    try {
      const { operation } = await apiRequest<{ operation: OperationSnapshot }>(
        `/operations/${id}`,
        { method: "DELETE" },
      );
      setOperations((current) =>
        current.map((candidate) => (candidate.id === operation.id ? operation : candidate)),
      );
    } catch (error) {
      setOperationError(actionError(error));
      await loadOperations();
    }
  };

  const retryOperation = (id: string) =>
    mutate({
      key: `operation-retry-${id}`,
      request: () =>
        apiRequest<OperationAccepted>(`/operations/${encodeURIComponent(id)}/retry`, {
          method: "POST",
        }),
    });

  const installStartupTarget = (target: StartupInstallTarget) => {
    if (target === "compose" || target === "docker-with-compose") {
      window.localStorage.removeItem("overseer-compose-setup");
      setComposeSkipped(false);
    }
    return mutate({
      key: `startup-install-${target}`,
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>(`/startup/prerequisites/${target}/install`, {
          method: "POST",
        }),
    });
  };

  const checkToolUpdates = () =>
    mutate({
      key: "startup-update-check",
      request: () =>
        apiRequest<OperationAccepted>("/startup/updates/check", {
          method: "POST",
        }),
    });

  const updateTool = (target: ToolUpdateId) =>
    mutate({
      key: `startup-update-${target}`,
      request: () =>
        apiRequest<OperationAccepted>(`/startup/prerequisites/${target}/update`, {
          method: "POST",
        }),
    });

  const installDockerPlugin = (id: DockerCliPluginId) =>
    mutate({
      key: `docker-plugin-install-${id}`,
      request: () =>
        apiRequest<OperationAccepted>(`/docker-cli/plugins/${id}/install`, {
          method: "POST",
        }),
    });

  const startDockerEngineForStartup = (configuration?: DockerEngineConfiguration) =>
    mutate({
      key: "runtime-start",
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>("/runtime/start", {
          ...(configuration ? { body: JSON.stringify({ configuration }) } : {}),
          method: "POST",
        }),
    });

  const forceRestartDockerEngineForStartup = () =>
    mutate({
      key: "runtime-force-restart",
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>("/runtime/force-restart", {
          method: "POST",
        }),
    });

  const createRuntimeInstance = (input: CreateRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-create-${input.name}`,
      request: () =>
        apiRequest<OperationAccepted>("/runtime/instances", {
          body: JSON.stringify(input),
          method: "POST",
        }),
    });

  const updateRuntimeInstance = (name: string, input: UpdateRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-update-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}`, {
          body: JSON.stringify(input),
          method: "PATCH",
        }),
    });

  const deleteRuntimeInstance = (name: string, input: DeleteRuntimeInstanceInput) =>
    mutate({
      key: `runtime-instance-delete-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}`, {
          body: JSON.stringify(input),
          method: "DELETE",
        }),
    });

  const mutateRuntimeInstance = (
    name: string,
    action: "force-stop" | "prepare" | "select" | "start" | "stop",
  ) =>
    mutate({
      key: `runtime-instance-${action}-${name}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/instances/${encodeURIComponent(name)}/${action}`, {
          method: "POST",
        }),
    });

  const applyDockerDaemonConfiguration = (input: UpdateDockerDaemonConfigurationSectionInput) => {
    const { section, ...body } = input;
    return mutate({
      key: `runtime-daemon-configure-${section}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/engine/configuration/${section}`, {
          body: JSON.stringify(body),
          method: "PATCH",
        }),
    });
  };

  if ((!dashboard && !loadError) || startupCheckPending) return <LoadingScreen />;

  if (dashboard && displayedStartup && currentStartupStep) {
    const startupOperation = startupOperationId
      ? operations.find(({ id }) => id === startupOperationId)
      : undefined;
    const continueStartup = () => {
      if (!currentStartupStep) return;
      setOperationError(undefined);
      setStartupOperationId(undefined);
      if (currentStartupStep === "homebrew") {
        setStartupStep("docker");
        return;
      }
      if (currentStartupStep === "docker") {
        setStartupStep(
          composePrerequisite && !composePrerequisite.installed && !composeSkipped
            ? "compose"
            : "lima",
        );
        return;
      }
      if (currentStartupStep === "compose") {
        setStartupStep("lima");
        return;
      }
      if (currentStartupStep === "lima") {
        setStartupStep("engine");
        return;
      }
      setStartupStep(undefined);
      if (startupRoute) selectResourcePath(resourcePath);
    };
    return (
      <Suspense fallback={<LoadingScreen />}>
        <StartupPage
          composeSkipped={composeSkipped}
          engineBusy={submitting === "runtime-start" || submitting === "runtime-force-restart"}
          error={startupError ?? operationError}
          onContinue={continueStartup}
          onForceRestartEngine={forceRestartDockerEngineForStartup}
          onInstall={installStartupTarget}
          onRefresh={async () => {
            setOperationError(undefined);
            if (currentStartupStep === "engine") {
              await Promise.all([refreshStartup(), refresh(true)]);
              return;
            }
            await refreshStartup();
          }}
          onSkipCompose={() => {
            window.localStorage.setItem("overseer-compose-setup", "skipped");
            setComposeSkipped(true);
          }}
          onSkipEngine={() => {
            window.sessionStorage.setItem("overseer-engine-setup", "skipped");
            setEngineSetupSkipped(true);
            setStartupStep(undefined);
            if (startupRoute) selectResourcePath(resourcePath);
          }}
          operation={startupOperation}
          preview={Boolean(startupPreview)}
          refreshing={startupRefreshing}
          runtime={dashboard.runtime}
          snapshot={displayedStartup}
          onStartEngine={startDockerEngineForStartup}
          step={currentStartupStep}
        />
      </Suspense>
    );
  }

  const runtime = dashboard?.runtime;
  const runtimeStatus = runtime ? runtimePresentation[runtime.phase] : runtimePresentation.error;
  const runtimeRunning = runtime?.phase === "running";
  const dockerComposeAvailable = dashboard?.capabilities?.dockerCompose ?? true;
  const activeOperations = operations.filter(
    ({ status }) => status === "queued" || status === "running",
  );
  const targetBusy = (resource: OperationResource, identifier: string) =>
    activeOperations.some(
      ({ target }) =>
        target.resource === resource && (target.id === identifier || target.name === identifier),
    );
  const runtimeBusy = activeOperations.some(({ target }) => target.resource === "runtime");
  const latestFinishedRuntimeOperation = operations.find(
    ({ status, target }) =>
      target.resource === "runtime" && status !== "queued" && status !== "running",
  );
  const latestToolUpdateOperation = operations.find(
    ({ kind }) => kind === "startup.update" || kind === "startup.update.check",
  );
  const latestFinishedToolUpdateOperation = operations.find(
    ({ kind, status }) =>
      (kind === "startup.update" || kind === "startup.update.check") &&
      status !== "queued" &&
      status !== "running",
  );
  const settingsRefreshToken = `${settingsRefreshRevision}:${latestFinishedRuntimeOperation?.id ?? ""}:${latestFinishedRuntimeOperation?.status ?? ""}:${latestFinishedToolUpdateOperation?.id ?? ""}:${latestFinishedToolUpdateOperation?.status ?? ""}`;
  const currentDetail = getAppDetailLocation(resourcePath);
  const currentRoute = getAppRoute(resourcePath);
  const currentContainer =
    currentDetail?.type === "container"
      ? dashboard?.containers.find(
          ({ id, name }) =>
            id === currentDetail.identifier ||
            name === currentDetail.identifier ||
            id.startsWith(currentDetail.identifier) ||
            currentDetail.identifier.startsWith(id),
        )
      : undefined;
  const currentCompose =
    currentDetail?.type === "compose"
      ? dashboard?.composeProjects.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const currentImage =
    currentDetail?.type === "image"
      ? dashboard?.images.find(({ id }) => id === currentDetail.identifier)
      : undefined;
  const currentNetwork =
    currentDetail?.type === "network"
      ? dashboard?.networks.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const currentVolume =
    currentDetail?.type === "volume"
      ? dashboard?.volumes.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const detailOperationResource =
    currentDetail?.type === "instance" ? "runtime" : currentDetail?.type;
  const latestFinishedDetailOperation = currentDetail
    ? operations.find(
        ({ status, target }) =>
          target.resource === detailOperationResource &&
          status !== "queued" &&
          status !== "running" &&
          (target.id === currentDetail.identifier || target.name === currentDetail.identifier),
      )
    : undefined;
  const detailRefreshToken = `${detailRefreshRevision}:${latestFinishedDetailOperation?.id ?? ""}:${latestFinishedDetailOperation?.status ?? ""}`;
  const pageEyebrow = currentDetail
    ? currentDetail.type === "compose"
      ? "COMPOSE 프로젝트"
      : currentDetail.type === "container"
        ? "컨테이너 상세"
        : currentDetail.type === "image"
          ? "이미지 상세"
          : currentDetail.type === "imageRepository"
            ? "이미지 저장소 상세"
            : currentDetail.type === "instance"
              ? "VM 인스턴스 상세"
              : currentDetail.type === "network"
                ? "네트워크 상세"
                : "볼륨 상세"
    : currentRoute.eyebrow;
  const pageLabel = currentDetail
    ? currentDetail.type === "compose"
      ? currentDetail.identifier
      : currentDetail.type === "container"
        ? (currentContainer?.name ?? currentDetail.identifier)
        : currentDetail.type === "image" && currentImage
          ? currentImage.tag === "<none>"
            ? currentImage.repository
            : `${currentImage.repository}:${currentImage.tag}`
          : currentDetail.type === "imageRepository"
            ? (imageRepositoryHeader?.repository ?? currentDetail.identifier)
            : currentDetail.type === "instance"
              ? currentDetail.identifier
              : currentDetail.type === "network"
                ? (currentNetwork?.name ?? currentDetail.identifier)
                : currentDetail.type === "volume"
                  ? (currentVolume?.name ?? currentDetail.identifier)
                  : currentDetail.identifier
    : currentRoute.label;
  const pageDescription = currentDetail
    ? currentDetail.type === "compose"
      ? "서비스 운영과 Compose 구성을 한곳에서 관리합니다."
      : currentDetail.type === "container"
        ? "실행 중인 컨테이너의 운영·진단 정보를 관리합니다."
        : currentDetail.type === "image"
          ? "이미지의 출처, 실행 기본값과 레이어를 탐색합니다."
          : currentDetail.type === "imageRepository"
            ? "원격 태그를 탐색하고 이미지 다운로드·즐겨찾기·컨테이너 생성을 관리합니다."
            : currentDetail.type === "instance"
              ? "Lima VM과 Docker Engine 연결을 관리합니다."
              : currentDetail.type === "network"
                ? "Docker 네트워크의 연결 관계와 원본 구성을 탐색합니다."
                : "Docker 볼륨의 저장 위치와 원본 구성을 탐색합니다."
    : currentRoute.description;
  const detailBreadcrumbs: Array<{ label: string; path?: AppLocationPath }> = currentDetail
    ? currentDetail.type === "container" && currentContainer?.composeProject
      ? [
          { label: "Compose", path: "/compose" as const },
          {
            label: currentContainer.composeProject,
            path: composeProjectDetailPath(currentContainer.composeProject),
          },
          { label: pageLabel },
        ]
      : [{ label: currentRoute.label, path: currentDetail.parentPath }, { label: pageLabel }]
    : [];
  const runComposeAction = (name: string, action: ComposeProjectAction) =>
    mutate({
      key: `compose-${name}-${action}`,
      request: () =>
        apiRequest<OperationAccepted>(
          `/compose/projects/${encodeURIComponent(name)}/actions/${action}`,
          { method: "POST" },
        ),
    });
  const pullImage = (image: string, key = "image-pull") =>
    mutate({
      key,
      request: () =>
        apiRequest<OperationAccepted>("/images/pull", {
          body: JSON.stringify({ image }),
          method: "POST",
        }),
    });
  const runContainer = (spec: ContainerSpecInput) =>
    mutate({
      key: "container-run",
      request: () =>
        apiRequest<OperationAccepted>("/containers", {
          body: JSON.stringify(spec),
          method: "POST",
        }),
    });
  const runtimePagePrimaryAction = !runtimeRunning ? null : currentCompose ? (
    <div className="overseer-compose-create-actions">
      {currentCompose.status.startsWith("running") ? (
        <>
          <Button
            disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
            onClick={() =>
              void runComposeAction(currentCompose.name, "stop").catch(() => undefined)
            }
            size="sm"
            variant="outline"
          >
            <Square aria-hidden="true" size={14} />
            중지
          </Button>
          <Button
            disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
            onClick={() =>
              void runComposeAction(currentCompose.name, "restart").catch(() => undefined)
            }
            size="sm"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" size={14} />
            재시작
          </Button>
        </>
      ) : (
        <Button
          disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
          onClick={() => void runComposeAction(currentCompose.name, "up").catch(() => undefined)}
          size="sm"
        >
          <Play aria-hidden="true" size={14} />
          실행
        </Button>
      )}
      <ConfirmAction
        actionLabel="프로젝트 내리기"
        disabled={runtimeBusy || targetBusy("compose", currentCompose.name)}
        description="컨테이너와 네트워크를 제거합니다. named volume과 Compose 등록 정보는 유지됩니다."
        onConfirm={() => void runComposeAction(currentCompose.name, "down").catch(() => undefined)}
        title={`${currentCompose.name} 프로젝트를 내리시겠습니까?`}
      >
        <ArrowDownToLine aria-hidden="true" size={14} />
        내리기
      </ConfirmAction>
    </div>
  ) : resourcePath === "/compose" && dockerComposeAvailable ? (
    <div className="overseer-compose-create-actions">
      <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
        <CreateBuilderComposeDialog
          disabled={Boolean(submitting) || runtimeBusy}
          onSubmit={(input: ComposeBuilderInput) =>
            mutate({
              key: "compose-builder-register",
              request: () =>
                apiRequest<OperationAccepted>("/compose/builder", {
                  body: JSON.stringify(input),
                  method: "POST",
                }),
            })
          }
        />
      </Suspense>
      <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
        <RemoteComposeDialog
          disabled={Boolean(submitting) || runtimeBusy}
          onSubmit={(input: RegisterRemoteComposeInput) =>
            mutate({
              key: "compose-remote-register",
              request: () =>
                apiRequest<OperationAccepted>("/compose/remote", {
                  body: JSON.stringify(input),
                  method: "POST",
                }),
            })
          }
        />
      </Suspense>
    </div>
  ) : resourcePath === "/containers" ? (
    <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
      <RunContainerDialog
        disabled={Boolean(submitting) || runtimeBusy}
        images={dashboard?.images ?? []}
        networks={dashboard?.networks ?? []}
        onSubmit={runContainer}
        volumes={dashboard?.volumes ?? []}
      />
    </Suspense>
  ) : resourcePath === "/images" ? (
    <PullImageDialog
      busy={submitting === "image-pull"}
      disabled={Boolean(submitting) || runtimeBusy}
      onSubmit={pullImage}
    />
  ) : resourcePath === "/volumes" ? (
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
  ) : resourcePath === "/networks" ? (
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
  ) : null;
  const pagePrimaryAction =
    resourcePath === "/image-repositories" ? (
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
    ) : resourcePath === "/instances" ? (
      <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
        <RuntimeInstanceCreateDialog
          busy={runtimeBusy || Boolean(submitting)}
          onSubmit={createRuntimeInstance}
          refreshToken={settingsRefreshToken}
        />
      </Suspense>
    ) : currentDetail?.type === "instance" &&
      runtimeInstanceHeaderState?.instance.name === currentDetail.identifier ? (
      <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
        <RuntimeInstanceHeaderActions
          busy={runtimeBusy || Boolean(submitting)}
          instance={runtimeInstanceHeaderState.instance}
          onDelete={deleteRuntimeInstance}
          onForceStop={(name) => mutateRuntimeInstance(name, "force-stop")}
          onPrepare={(name) => mutateRuntimeInstance(name, "prepare")}
          onSelect={(name) => mutateRuntimeInstance(name, "select")}
          onStart={(name) => mutateRuntimeInstance(name, "start")}
          onStop={(name) => mutateRuntimeInstance(name, "stop")}
          onUpdate={updateRuntimeInstance}
          selectionLocked={runtimeInstanceHeaderState.selectionLocked}
        />
      </Suspense>
    ) : (
      runtimePagePrimaryAction
    );

  return (
    <div className="overseer-shell" data-navigation-mode={navigationMode}>
      <a className="overseer-skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      {navigationMode !== "mobile" ? (
        <aside
          aria-label="Overseer 주요 탐색"
          className="overseer-sidebar"
          data-navigation-mode={navigationMode}
        >
          <AppBrand />
          <PrimaryNavigation
            currentPath={currentRoute.path}
            mode={navigationMode}
            onSelect={selectResourcePath}
          />
          <UtilityNavigation
            currentPath={currentRoute.path}
            mode={navigationMode}
            onSelect={selectResourcePath}
          />
        </aside>
      ) : null}

      <div className="overseer-workspace">
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
                {dark ? (
                  <Sun aria-hidden="true" size={16} />
                ) : (
                  <Moon aria-hidden="true" size={16} />
                )}
              </Button>
              <MobileNavigationDrawer
                currentPath={currentRoute.path}
                onSelect={selectResourcePath}
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
                {dark ? (
                  <Sun aria-hidden="true" size={16} />
                ) : (
                  <Moon aria-hidden="true" size={16} />
                )}
              </Button>
            </div>
          </header>
        )}

        <main className="overseer-main" id="main-content">
          <section className="overseer-page-header">
            <div>
              {currentDetail ? (
                <Breadcrumbs.Root aria-label="현재 위치">
                  <Breadcrumbs.List>
                    {detailBreadcrumbs.map((item, index) => {
                      const path = item.path;
                      const collapseOnMobile =
                        navigationMode === "mobile" &&
                        detailBreadcrumbs.length === 3 &&
                        index === 1;
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
              <span className="city-text-supporting">{pageDescription}</span>
            </div>
            <div className="overseer-page-actions">
              <div className="overseer-page-utilities">
                <Button
                  onClick={() => {
                    if (resourcePath === "/operations") {
                      void loadOperations();
                      return;
                    }
                    if (
                      resourcePath === "/settings" ||
                      resourcePath === "/docker-plugins" ||
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
                {resourcePath === "/images" ? (
                  <Suspense fallback={<Skeleton className="overseer-loading-topbar-action" />}>
                    <ImageViewToggle onChange={setImageView} value={imageView} />
                  </Suspense>
                ) : null}
              </div>
              {pagePrimaryAction ? (
                <div className="overseer-primary-action">{pagePrimaryAction}</div>
              ) : null}
            </div>
          </section>

          {loadError ? (
            <Alert.Root tone="destructive">
              <Alert.Title level={2}>Overseer에 연결하지 못했습니다.</Alert.Title>
              <Alert.Description>{loadError}</Alert.Description>
              <Alert.Action>
                <Button onClick={() => void refresh()} size="sm" variant="outline">
                  다시 시도
                </Button>
              </Alert.Action>
            </Alert.Root>
          ) : null}

          {operationError ? (
            <Alert.Root appearance="subtle" tone="destructive">
              <Alert.Title level={2}>작업을 완료하지 못했습니다.</Alert.Title>
              <Alert.Description>{operationError}</Alert.Description>
            </Alert.Root>
          ) : null}

          {startupError && !runtimeRunning ? (
            <Alert.Root appearance="subtle" tone="destructive">
              <Alert.Title level={2}>필수 도구 상태를 확인하지 못했습니다.</Alert.Title>
              <Alert.Description>{startupError}</Alert.Description>
              <Alert.Action>
                <Button onClick={() => void refreshStartup()} size="sm" variant="outline">
                  다시 확인
                </Button>
              </Alert.Action>
            </Alert.Root>
          ) : null}

          {runtime &&
          !runtimeRunning &&
          resourcePath !== "/settings" &&
          resourcePath !== "/docker-plugins" &&
          !resourcePath.startsWith("/image-repositories") &&
          !resourcePath.startsWith("/instances") ? (
            <Alert.Root appearance="subtle" tone={runtimeStatus.tone}>
              <Alert.Title level={2}>Lima · {runtimeStatus.label}</Alert.Title>
              <Alert.Description>
                {runtime.message}
                {runtime.dockerVersion ? ` Docker ${runtime.dockerVersion}` : ""}
              </Alert.Description>
            </Alert.Root>
          ) : null}

          {dashboard &&
          !runtimeRunning &&
          resourcePath !== "/operations" &&
          resourcePath !== "/settings" &&
          resourcePath !== "/docker-plugins" &&
          !resourcePath.startsWith("/image-repositories") &&
          !resourcePath.startsWith("/instances") ? (
            <section className="overseer-runtime-empty">
              <EmptyState.Root>
                <EmptyState.Icon>
                  <Container aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>
                  {runtime?.phase === "missing"
                    ? "Lima 환경을 먼저 만드십시오."
                    : "Lima 런타임이 준비되지 않았습니다."}
                </EmptyState.Title>
                <EmptyState.Description>
                  {runtime?.phase === "missing"
                    ? "인스턴스 페이지에서 사용할 Lima VM을 만드십시오."
                    : "인스턴스 페이지에서 중지된 VM을 다시 시작할 수 있습니다."}
                </EmptyState.Description>
                <EmptyState.Actions>
                  <Button onClick={() => selectResourcePath("/instances")} size="sm">
                    <Server aria-hidden="true" size={14} />
                    인스턴스 열기
                  </Button>
                </EmptyState.Actions>
              </EmptyState.Root>
            </section>
          ) : null}

          {dashboard && resourcePath === "/instances" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <RuntimeInstancesPage
                busy={runtimeBusy || Boolean(submitting)}
                onDelete={deleteRuntimeInstance}
                onForceStop={(name) => mutateRuntimeInstance(name, "force-stop")}
                onOpenDetail={(name) => selectResourcePath(runtimeInstanceDetailPath(name))}
                onPrepare={(name) => mutateRuntimeInstance(name, "prepare")}
                onSelect={(name) => mutateRuntimeInstance(name, "select")}
                onStart={(name) => mutateRuntimeInstance(name, "start")}
                onStop={(name) => mutateRuntimeInstance(name, "stop")}
                onUpdate={updateRuntimeInstance}
                refreshToken={settingsRefreshToken}
              />
            </Suspense>
          ) : null}

          {dashboard && currentDetail?.type === "instance" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <RuntimeInstanceDetailPage
                name={currentDetail.identifier}
                onHeaderStateChange={setRuntimeInstanceHeaderState}
                refreshToken={detailRefreshToken}
              />
            </Suspense>
          ) : null}

          {dashboard && resourcePath === "/settings" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <SettingsPage
                busy={runtimeBusy || Boolean(submitting)}
                dashboard={dashboard}
                onApplyDaemonConfiguration={applyDockerDaemonConfiguration}
                onCheckToolUpdates={checkToolUpdates}
                onUpdateTool={updateTool}
                refreshToken={settingsRefreshToken}
                toolOperation={latestToolUpdateOperation}
                toolRequestPending={Boolean(submitting?.startsWith("startup-update"))}
              />
            </Suspense>
          ) : null}

          {resourcePath === "/operations" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <OperationsPage
                busyId={
                  submitting?.startsWith("operation-retry-") ? submitting.slice(16) : undefined
                }
                onRetry={retryOperation}
                refreshToken={operationsRefreshToken}
              />
            </Suspense>
          ) : null}

          {resourcePath === "/docker-plugins" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <DockerCliPluginsPage
                isBusy={(plugin) => targetBusy("dockerPlugin", plugin.id)}
                onInstall={installDockerPlugin}
                refreshToken={`${settingsRefreshRevision}:${dockerPluginOperationRefreshToken}`}
              />
            </Suspense>
          ) : null}

          {resourcePath === "/image-repositories" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <ImageRepositoriesPage
                isBusy={(repository) =>
                  targetBusy("imageRepository", repository.id) ||
                  submitting === `image-repository-remove-${repository.id}`
                }
                onInspect={(repository) =>
                  selectResourcePath(imageRepositoryDetailPath(repository.id))
                }
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
            </Suspense>
          ) : null}

          {currentDetail?.type === "imageRepository" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <ImageRepositoryDetailPage
                id={currentDetail.identifier}
                isBusy={(reference) =>
                  submitting === `image-repository-pull-${reference}` ||
                  targetBusy("image", reference)
                }
                onCreateContainer={setRunContainerImage}
                onDownload={(reference) =>
                  pullImage(reference, `image-repository-pull-${reference}`)
                }
                onRepositoryChange={setImageRepositoryHeader}
                refreshToken={detailRefreshToken}
                runtimeAvailable={runtimeRunning}
              />
            </Suspense>
          ) : null}

          {dashboard &&
          runtimeRunning &&
          dockerComposeAvailable &&
          currentDetail?.type === "compose" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <ComposeProjectDetailPage
                busy={runtimeBusy || targetBusy("compose", currentDetail.identifier)}
                name={currentDetail.identifier}
                onBuilderUpdate={(input, expectedConfigHash) =>
                  mutate({
                    key: `compose-${currentDetail.identifier}-builder-update`,
                    request: () =>
                      apiRequest<OperationAccepted>(
                        `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/builder`,
                        {
                          body: JSON.stringify({ expectedConfigHash, input }),
                          method: "PATCH",
                        },
                      ),
                  })
                }
                onOpenContainer={(id) => selectResourcePath(containerDetailPath(id))}
                onRemoteCheck={() =>
                  mutate({
                    key: `compose-${currentDetail.identifier}-remote-check`,
                    request: () =>
                      apiRequest<OperationAccepted>(
                        `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/remote/check`,
                        { method: "POST" },
                      ),
                  })
                }
                onRemoteUpdate={() =>
                  mutate({
                    key: `compose-${currentDetail.identifier}-remote-update`,
                    request: () =>
                      apiRequest<OperationAccepted>(
                        `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/remote/update`,
                        { method: "POST" },
                      ),
                  })
                }
                refreshToken={detailRefreshToken}
              />
            </Suspense>
          ) : null}

          {dashboard &&
          runtimeRunning &&
          !dockerComposeAvailable &&
          currentRoute.path === "/compose" ? (
            <section className="overseer-runtime-empty">
              <EmptyState.Root>
                <EmptyState.Icon>
                  <Layers3 aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>Docker Compose가 설치되지 않았습니다.</EmptyState.Title>
                <EmptyState.Description>
                  Compose 기능은 선택 사항입니다. 사용하려면 Docker Compose 플러그인을 설치하십시오.
                </EmptyState.Description>
                <EmptyState.Actions>
                  <Button
                    disabled={targetBusy("startup", "compose")}
                    onClick={() => void installStartupTarget("compose").catch(() => undefined)}
                    size="sm"
                  >
                    <Download aria-hidden="true" size={14} />
                    {targetBusy("startup", "compose") ? "설치 중…" : "Docker Compose 설치"}
                  </Button>
                </EmptyState.Actions>
              </EmptyState.Root>
            </section>
          ) : null}

          {dashboard && runtimeRunning && currentDetail?.type === "container" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <ContainerDetailPage
                id={currentDetail.identifier}
                onOpenCompose={(name) => selectResourcePath(composeProjectDetailPath(name))}
                refreshToken={detailRefreshToken}
                summary={currentContainer}
              />
            </Suspense>
          ) : null}

          {dashboard && runtimeRunning && currentDetail?.type === "image" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <ImageDetailPage
                id={currentDetail.identifier}
                refreshToken={detailRefreshToken}
                summary={currentImage}
              />
            </Suspense>
          ) : null}

          {dashboard && runtimeRunning && currentDetail?.type === "network" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <NetworkDetailPage
                name={currentDetail.identifier}
                onOpenContainer={(id) => selectResourcePath(containerDetailPath(id))}
                refreshToken={detailRefreshToken}
              />
            </Suspense>
          ) : null}

          {dashboard && runtimeRunning && currentDetail?.type === "volume" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <VolumeDetailPage name={currentDetail.identifier} refreshToken={detailRefreshToken} />
            </Suspense>
          ) : null}

          {dashboard &&
          runtimeRunning &&
          !currentDetail &&
          resourcePath !== "/operations" &&
          resourcePath !== "/image-repositories" &&
          resourcePath !== "/settings" ? (
            <>
              {resourcePath === "/compose" && dockerComposeAvailable ? (
                <ComposePage
                  isBusy={(project) => runtimeBusy || targetBusy("compose", project.name)}
                  onAction={(project, action) => runComposeAction(project.name, action)}
                  onBuilderRemove={(project) =>
                    mutate({
                      key: `compose-${project.name}-builder-remove`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/builder`,
                          { method: "DELETE" },
                        ),
                    })
                  }
                  onBuilderUpdate={(project, input, expectedConfigHash) =>
                    mutate({
                      key: `compose-${project.name}-builder-update`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/builder`,
                          {
                            body: JSON.stringify({ expectedConfigHash, input }),
                            method: "PATCH",
                          },
                        ),
                    })
                  }
                  onInspect={(project) =>
                    selectResourcePath(composeProjectDetailPath(project.name))
                  }
                  onLogs={(project) =>
                    setLogsTarget({
                      description: "프로젝트 전체 서비스의 최근 300줄을 표시합니다.",
                      requestPath: `/compose/projects/${encodeURIComponent(project.name)}/logs`,
                      title: `${project.name} 로그`,
                    })
                  }
                  onRemoteCheck={(project) =>
                    mutate({
                      key: `compose-${project.name}-remote-check`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/remote/check`,
                          { method: "POST" },
                        ),
                    })
                  }
                  onRemoteRemove={(project) =>
                    mutate({
                      key: `compose-${project.name}-remote-remove`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/remote`,
                          { method: "DELETE" },
                        ),
                    })
                  }
                  onRemoteUpdate={(project) =>
                    mutate({
                      key: `compose-${project.name}-remote-update`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/remote/update`,
                          { method: "POST" },
                        ),
                    })
                  }
                  projects={dashboard.composeProjects}
                />
              ) : null}

              {resourcePath === "/containers" ? (
                <section className="overseer-panel" id="containers">
                  <ContainersPage
                    containers={dashboard?.containers ?? []}
                    isBusy={(container) => runtimeBusy || targetBusy("container", container.id)}
                    onAction={(container, action) =>
                      void mutate({
                        key: `${container.id}-${action}`,
                        request: () =>
                          apiRequest<OperationAccepted>(
                            `/containers/${container.id}/actions/${action}`,
                            { method: "POST" },
                          ),
                      }).catch(() => undefined)
                    }
                    onEdit={setEditContainer}
                    onInspect={(container) => selectResourcePath(containerDetailPath(container.id))}
                    onLogs={(container) =>
                      setLogsTarget({
                        description: "최근 300줄을 시간 정보와 함께 표시합니다.",
                        requestPath: `/containers/${container.id}/logs`,
                        title: `${container.name} 로그`,
                      })
                    }
                    onRemove={(container) =>
                      void mutate({
                        key: `${container.id}-remove`,
                        request: () =>
                          apiRequest<OperationAccepted>(`/containers/${container.id}`, {
                            method: "DELETE",
                          }),
                      }).catch(() => undefined)
                    }
                  />
                </section>
              ) : null}

              {resourcePath === "/images" ? (
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

              {resourcePath === "/volumes" ? (
                <VolumesPage
                  isBusy={(volume) => runtimeBusy || targetBusy("volume", volume.name)}
                  onRemove={(volume) =>
                    void mutate({
                      key: `${volume.name}-remove`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/volumes/${encodeURIComponent(volume.name)}`,
                          { method: "DELETE" },
                        ),
                    }).catch(() => undefined)
                  }
                  onInspect={(volume) => selectResourcePath(volumeDetailPath(volume.name))}
                  volumes={dashboard?.volumes ?? []}
                />
              ) : null}

              {resourcePath === "/networks" ? (
                <NetworksPage
                  isBusy={(network) => runtimeBusy || targetBusy("network", network.name)}
                  networks={dashboard?.networks ?? []}
                  onInspect={(network) => selectResourcePath(networkDetailPath(network.name))}
                  onRemove={(network) =>
                    void mutate({
                      key: `${network.name}-remove`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/networks/${encodeURIComponent(network.name)}`,
                          { method: "DELETE" },
                        ),
                    }).catch(() => undefined)
                  }
                />
              ) : null}
            </>
          ) : null}
        </main>
      </div>
      <Suspense fallback={null}>
        <EditContainerDialog
          container={editContainer}
          images={dashboard?.images ?? []}
          networks={dashboard?.networks ?? []}
          onClose={() => setEditContainer(undefined)}
          onSubmit={(detail: ContainerDetail, spec: ContainerSpecInput) =>
            mutate({
              key: `${detail.id}-update`,
              request: () =>
                apiRequest<OperationAccepted>(`/containers/${detail.id}`, {
                  body: JSON.stringify({ expectedConfigHash: detail.configHash, spec }),
                  method: "PATCH",
                }),
            })
          }
          volumes={dashboard?.volumes ?? []}
        />
      </Suspense>
      {runContainerImage ? (
        <Suspense fallback={null}>
          <RunContainerDialog
            disabled={Boolean(submitting) || runtimeBusy}
            images={dashboard?.images ?? []}
            initialImage={runContainerImage}
            networks={dashboard?.networks ?? []}
            onOpenChange={(open) => !open && setRunContainerImage(undefined)}
            onSubmit={runContainer}
            open
            volumes={dashboard?.volumes ?? []}
          />
        </Suspense>
      ) : null}
      <LogsDialog onClose={() => setLogsTarget(undefined)} target={logsTarget} />
    </div>
  );
}
