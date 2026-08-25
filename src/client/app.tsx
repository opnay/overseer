import { Alert } from "@opnay/city-ds-react/alert";
import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Toolbar } from "@opnay/city-ds-react/toolbar";
import { Toast } from "@opnay/city-ds-react/toast";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import {
  ArrowLeft,
  ArrowDownToLine,
  Box,
  Boxes,
  Check,
  Container,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  Layers3,
  ListChecks,
  ListTree,
  Menu,
  Moon,
  Network as NetworkIcon,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  Sun,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  ComposeProjectAction,
  ComposeBuilderSpec,
  ComposeProjectSummary,
  ContainerDetail,
  ContainerSpecInput,
  ContainerSummary,
  DashboardSnapshot,
  DockerEngineConfiguration,
  ImageSummary,
  NetworkSummary,
  OperationAccepted,
  OperationSnapshot,
  OperationResource,
  RegisterRemoteComposeInput,
  RecreateDockerEngineInput,
  RuntimePhase,
  StartupInstallTarget,
  StartupPrerequisiteId,
  StartupSnapshot,
  StartupStepId,
  ToolUpdateId,
  UpdateDockerDaemonConfigurationSectionInput,
  VolumeSummary,
} from "../shared/contracts.ts";
import { isImageReference, isResourceName } from "../shared/validation.ts";
import { ApiRequestError, apiRequest } from "./api.ts";
import { formatDateTime } from "./date-time.ts";
import { LogViewer } from "./log-display-options.tsx";
import {
  APP_ROUTES,
  APP_ROUTE_GROUPS,
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  getAppRoute,
  imageDetailPath,
  type AppLocationPath,
  type AppPath,
} from "./routes.ts";

const RunContainerDialog = lazy(() =>
  import("./container-dialog.tsx").then((module) => ({ default: module.RunContainerDialog })),
);
const EditContainerDialog = lazy(() =>
  import("./container-dialog.tsx").then((module) => ({ default: module.EditContainerDialog })),
);
const OperationsDrawer = lazy(() =>
  import("./operations-drawer.tsx").then((module) => ({ default: module.OperationsDrawer })),
);
const RemoteComposeDialog = lazy(() =>
  import("./remote-compose-dialog.tsx").then((module) => ({
    default: module.RemoteComposeDialog,
  })),
);
const RemoteComposeActions = lazy(() =>
  import("./remote-compose-actions.tsx").then((module) => ({
    default: module.RemoteComposeActions,
  })),
);
const OperationsPage = lazy(() =>
  import("./operations-page.tsx").then((module) => ({ default: module.OperationsPage })),
);
const SettingsPage = lazy(() =>
  import("./settings-page.tsx").then((module) => ({ default: module.SettingsPage })),
);
const StartupPage = lazy(() =>
  import("./startup-page.tsx").then((module) => ({ default: module.StartupPage })),
);
const ComposeProjectDetailPage = lazy(() =>
  import("./compose-project-detail-page.tsx").then((module) => ({
    default: module.ComposeProjectDetailPage,
  })),
);
const ContainerDetailPage = lazy(() =>
  import("./container-detail-page.tsx").then((module) => ({
    default: module.ContainerDetailPage,
  })),
);
const ImageDetailPage = lazy(() =>
  import("./image-detail-page.tsx").then((module) => ({
    default: module.ImageDetailPage,
  })),
);
const CreateBuilderComposeDialog = lazy(() =>
  import("./builder-compose-dialog.tsx").then((module) => ({
    default: module.CreateBuilderComposeDialog,
  })),
);
const BuilderComposeActions = lazy(() =>
  import("./builder-compose-actions.tsx").then((module) => ({
    default: module.BuilderComposeActions,
  })),
);

const resourceRouteIcon = {
  "/compose": Layers3,
  "/containers": Boxes,
  "/images": HardDrive,
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
        <small>Lima control plane</small>
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
                    onClick={(event) => followAppLink(event, () => onSelect(route.path))}
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
  dockerVersion,
  instance,
  onSelect,
  status,
}: {
  currentPath: AppPath;
  dockerVersion?: string;
  instance: string;
  onSelect(path: AppPath): void;
  status: (typeof runtimePresentation)[RuntimePhase];
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
            <Drawer.Body className="overseer-mobile-navigation-body">
              <PrimaryNavigation
                currentPath={currentPath}
                mode="drawer"
                onSelect={(path) => {
                  setOpen(false);
                  onSelect(path);
                }}
              />
              <section aria-label="Docker Engine 상태" className="overseer-mobile-runtime">
                <div>
                  <Badge dot size="sm" tone={status.tone} />
                  <strong>{status.label}</strong>
                </div>
                <span>{instance}</span>
                <span>Docker {dockerVersion ?? "-"}</span>
              </section>
            </Drawer.Body>
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

function ConfirmAction({
  actionLabel,
  ariaLabel,
  children,
  description,
  disabled,
  iconOnly = false,
  onConfirm,
  title,
}: {
  actionLabel: string;
  ariaLabel?: string;
  children: ReactNode;
  description: string;
  disabled?: boolean;
  iconOnly?: boolean;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        disabled={disabled}
        render={<Button aria-label={ariaLabel} iconOnly={iconOnly} size="sm" variant="ghost" />}
      >
        {children}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Viewport>
          <AlertDialog.Popup>
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
            <div className="overseer-dialog-actions">
              <AlertDialog.Cancel render={<Button variant="outline" />}>취소</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                onClick={onConfirm}
                render={<Button variant="destructive" />}
              >
                {actionLabel}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function PullImageDialog({
  busy,
  disabled,
  onSubmit,
}: {
  busy: boolean;
  disabled: boolean;
  onSubmit: (image: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; image?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const form = new FormData(event.currentTarget);
    const image = String(form.get("image") ?? "").trim();
    if (!isImageReference(image)) {
      setErrors({ image: "유효한 레지스트리 경로와 이미지 태그를 입력하십시오." });
      return;
    }
    try {
      await onSubmit(image);
      setOpen(false);
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.code === "invalid_image") {
        setErrors({ image: submitError.message });
        return;
      }
      setErrors({ form: actionError(submitError) });
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setErrors({});
      }}
      open={open}
    >
      <Dialog.Trigger disabled={disabled} render={<Button size="sm" variant="primary" />}>
        <Download aria-hidden="true" size={15} />
        이미지 받기
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="sm">
            <Dialog.Title>이미지 받기</Dialog.Title>
            <Dialog.Description>표준 OCI/Docker 이미지 경로를 입력하십시오.</Dialog.Description>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                {errors.form ? (
                  <Alert.Root tone="destructive">
                    <Alert.Title level={3}>이미지를 받지 못했습니다.</Alert.Title>
                    <Alert.Description>{errors.form}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.image)}>
                  <Field.Label>
                    이미지 <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    autoFocus
                    name="image"
                    onValueChange={() => setErrors((current) => ({ ...current, image: undefined }))}
                    placeholder="alpine:latest"
                    required
                  />
                  <Field.Error match>{errors.image}</Field.Error>
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={busy} type="submit">
                  {busy ? "받는 중…" : "이미지 받기"}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
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

function composeIsRunning(status: string): boolean {
  return status.startsWith("running");
}

function composeStatusLabel(status: string): string {
  const running = status.match(/^running\((\d+)\)$/)?.[1];
  if (running) return `${running}개 실행 중`;
  const exited = status.match(/^exited\((\d+)\)$/)?.[1];
  if (exited) return `${exited}개 중지됨`;
  const created = status.match(/^created\((\d+)\)$/)?.[1];
  if (created) return `${created}개 생성됨`;
  if (status === "registered") return "등록됨";
  if (status === "blocked") return "실행 제한";
  return status;
}

function composeStatusTone(project: ComposeProjectSummary): "neutral" | "success" | "warning" {
  if (composeIsRunning(project.status)) return "success";
  if (project.status === "blocked") return "warning";
  return "neutral";
}

function composeFileName(file: string): string {
  return file.split("/").filter(Boolean).at(-1) ?? file;
}

function imageDisplayReference(image: ImageSummary): string {
  return image.tag === "<none>" ? image.repository : `${image.repository}:${image.tag}`;
}

function followAppLink(event: MouseEvent<HTMLAnchorElement>, onFollow: () => void) {
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onFollow();
}

function ComposePage({
  isBusy,
  onAction,
  onBuilderRemove,
  onBuilderUpdate,
  onInspect,
  onLogs,
  onRemoteCheck,
  onRemoteRemove,
  onRemoteUpdate,
  projects,
}: {
  isBusy: (project: ComposeProjectSummary) => boolean;
  onAction: (project: ComposeProjectSummary, action: ComposeProjectAction) => Promise<void>;
  onBuilderRemove: (project: ComposeProjectSummary) => Promise<void>;
  onBuilderUpdate: (
    project: ComposeProjectSummary,
    spec: ComposeBuilderSpec,
    expectedConfigHash: string,
  ) => Promise<void>;
  onInspect: (project: ComposeProjectSummary) => void;
  onLogs: (project: ComposeProjectSummary) => void;
  onRemoteCheck: (project: ComposeProjectSummary) => Promise<void>;
  onRemoteRemove: (project: ComposeProjectSummary) => Promise<void>;
  onRemoteUpdate: (project: ComposeProjectSummary) => Promise<void>;
  projects: ComposeProjectSummary[];
}) {
  return (
    <section className="overseer-panel" id="compose">
      <DataTableRegion
        className="overseer-data-table-region"
        hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
        label="Compose 프로젝트 표"
      >
        <Table.Root
          aria-label="Compose 프로젝트 목록"
          className="overseer-table overseer-table--compose-projects"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 Compose 프로젝트
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">프로젝트</Table.Head>
              <Table.Head>상태</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {projects.length === 0 ? (
              <Table.StateRow colSpan={3}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <Layers3 aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>Compose 프로젝트가 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    CLI 실행 이력이나 폼·raw compose.yaml URL 프로젝트를 등록하면 여기에 표시됩니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              projects.map((project) => {
                const running = composeIsRunning(project.status);
                const rowBusy = isBusy(project);
                const hasRemoteFlag = Boolean(
                  project.remote?.buildContext ||
                  project.remote?.updateAvailable ||
                  project.remote?.checkError,
                );
                return (
                  <Table.Row key={project.name}>
                    <Table.Cell className="overseer-table-column-wide">
                      <div className="overseer-primary-cell">
                        <a
                          className="overseer-detail-link"
                          href={composeProjectDetailPath(project.name)}
                          onClick={(event) => followAppLink(event, () => onInspect(project))}
                        >
                          {project.name}
                        </a>
                        <div className="overseer-primary-meta">
                          {project.remote ? (
                            <span>URL 등록</span>
                          ) : project.builder ? (
                            <span>폼 등록</span>
                          ) : null}
                          <code
                            className="overseer-compose-config"
                            title={project.remote?.url ?? project.configFiles.join(", ")}
                          >
                            {project.remote?.url ??
                              (project.builder
                                ? "SQLite 생성 compose.yaml"
                                : project.configFiles.map(composeFileName).join(" · "))}
                          </code>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="overseer-compose-status-stack">
                        <span className="overseer-container-status">
                          <Badge
                            aria-label={composeStatusLabel(project.status)}
                            dot
                            size="sm"
                            tone={composeStatusTone(project)}
                          />
                          <span>{composeStatusLabel(project.status)}</span>
                        </span>
                        {hasRemoteFlag ? (
                          <div className="overseer-compose-flags">
                            {project.remote?.buildContext ? (
                              <Badge appearance="outline" size="sm" tone="warning">
                                build context
                              </Badge>
                            ) : null}
                            {project.remote?.updateAvailable ? (
                              <Badge appearance="outline" size="sm" tone="info">
                                업데이트 있음
                              </Badge>
                            ) : null}
                            {project.remote?.checkError ? (
                              <Badge
                                appearance="outline"
                                size="sm"
                                title={project.remote.checkError}
                                tone="destructive"
                              >
                                확인 실패
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="overseer-row-actions">
                        <Button
                          aria-label={`${project.name} 서비스 보기`}
                          disabled={rowBusy}
                          iconOnly
                          onClick={() => onInspect(project)}
                          size="sm"
                          variant="ghost"
                        >
                          <ListTree aria-hidden="true" size={14} />
                        </Button>
                        {running ? (
                          <Button
                            aria-label={`${project.name} 중지`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => void onAction(project, "stop").catch(() => undefined)}
                            size="sm"
                            variant="ghost"
                          >
                            <Square aria-hidden="true" size={14} />
                          </Button>
                        ) : (
                          <Button
                            aria-label={`${project.name} 실행`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => void onAction(project, "up").catch(() => undefined)}
                            size="sm"
                            variant="ghost"
                          >
                            <Play aria-hidden="true" size={14} />
                          </Button>
                        )}
                        {running ? (
                          <Button
                            aria-label={`${project.name} 재시작`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => void onAction(project, "restart").catch(() => undefined)}
                            size="sm"
                            variant="ghost"
                          >
                            <RotateCcw aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                        <Button
                          aria-label={`${project.name} 로그 보기`}
                          disabled={rowBusy}
                          iconOnly
                          onClick={() => onLogs(project)}
                          size="sm"
                          variant="ghost"
                        >
                          <FileText aria-hidden="true" size={14} />
                        </Button>
                        <ConfirmAction
                          actionLabel="프로젝트 내리기"
                          ariaLabel={`${project.name} 프로젝트 내리기`}
                          disabled={rowBusy}
                          description="프로젝트 컨테이너와 기본 네트워크를 제거합니다. named volume과 구성 파일은 유지됩니다."
                          onConfirm={() => void onAction(project, "down").catch(() => undefined)}
                          iconOnly
                          title={`${project.name} 프로젝트를 내리시겠습니까?`}
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </ConfirmAction>
                        {project.remote ? (
                          <Suspense
                            fallback={<Skeleton className="overseer-loading-topbar-action" />}
                          >
                            <RemoteComposeActions
                              busy={rowBusy}
                              onApply={() => onAction(project, "up")}
                              onCheck={() => onRemoteCheck(project)}
                              onRemove={() => onRemoteRemove(project)}
                              onUpdate={() => onRemoteUpdate(project)}
                              project={project}
                            />
                          </Suspense>
                        ) : null}
                        {project.builder ? (
                          <Suspense
                            fallback={<Skeleton className="overseer-loading-topbar-action" />}
                          >
                            <BuilderComposeActions
                              busy={rowBusy}
                              onApply={() => onAction(project, "up")}
                              onRemove={() => onBuilderRemove(project)}
                              onUpdate={(spec, expectedConfigHash) =>
                                onBuilderUpdate(project, spec, expectedConfigHash)
                              }
                              project={project}
                            />
                          </Suspense>
                        ) : null}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table.Root>
      </DataTableRegion>
    </section>
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
    <Toast.Provider limit={3} timeout={5_000}>
      <AppContent />
    </Toast.Provider>
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
  const [operationError, setOperationError] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);
  const [editContainer, setEditContainer] = useState<ContainerSummary>();
  const [logsTarget, setLogsTarget] = useState<LogsTarget>();
  const [dark, setDark] = useState(() => window.localStorage.getItem("overseer-theme") === "dark");
  const [resourcePath, setResourcePath] = useState<AppLocationPath>(resourcePathFromLocation);
  const [detailRefreshRevision, setDetailRefreshRevision] = useState(0);
  const [settingsRefreshRevision, setSettingsRefreshRevision] = useState(0);
  const notifiedOperations = useRef(new Set<string>());
  const operationsInitialized = useRef(false);
  const startupLoaded = useRef(false);
  const startupRefreshInFlight = useRef(false);
  const toastManager = Toast.useToastManager();

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

  const refreshStartup = useCallback(async () => {
    if (startupRefreshInFlight.current) return;
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
  const engineSettingsRoute = detectedStartupStep === "engine" && resourcePath === "/settings";
  const entryStartupStep =
    startupReviewMode && !startupPreview
      ? "homebrew"
      : engineSettingsRoute
        ? undefined
        : detectedStartupStep;
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
      !detectedStartupStep ||
      (detectedStartupStep === "engine" && resourcePath === "/settings")
    ) {
      return;
    }
    setStartupReviewMode(false);
    setStartupRoute(true);
    window.history.replaceState(null, "", `/startup${window.location.search}`);
  }, [detectedStartupStep, displayedStartup, resourcePath, startupRoute]);

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
        toastManager.add({
          description: operation.successMessage,
          title: "작업을 완료했습니다.",
          type: "success",
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
        toastManager.add({
          description: operation.error?.message ?? "작업을 완료하지 못했습니다.",
          title: "작업이 실패했습니다.",
          type: "warning",
        });
        if (operation.target.resource === "runtime" || operation.target.resource === "startup") {
          void refreshResource(operation.target.resource);
        }
      }
    }
  }, [operations, refreshResource, toastManager]);

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
      toastManager.add({
        description: operation.title,
        title: "작업을 시작했습니다.",
        type: "info",
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

  const createDockerEngine = (configuration: DockerEngineConfiguration) =>
    mutate({
      key: "runtime-create",
      request: () =>
        apiRequest<OperationAccepted>("/runtime/start", {
          body: JSON.stringify({ configuration }),
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

  const recreateDockerEngine = (input: RecreateDockerEngineInput) =>
    mutate({
      key: "runtime-recreate",
      request: () =>
        apiRequest<OperationAccepted>("/runtime/recreate", {
          body: JSON.stringify(input),
          method: "POST",
        }),
    });

  const connectDockerCli = () =>
    mutate({
      key: "runtime-connect",
      request: () =>
        apiRequest<OperationAccepted>("/runtime/cli/connect", {
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

  const startRuntime = () =>
    mutate({
      key: "runtime-start",
      request: () => apiRequest<OperationAccepted>("/runtime/start", { method: "POST" }),
    });

  const stopRuntime = () =>
    mutate({
      key: "runtime-stop",
      request: () => apiRequest<OperationAccepted>("/runtime/stop", { method: "POST" }),
    });

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
          engineBusy={submitting === "runtime-start"}
          error={startupError ?? operationError}
          onContinue={continueStartup}
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
  const latestFinishedDetailOperation = currentDetail
    ? operations.find(
        ({ status, target }) =>
          target.resource === currentDetail.type &&
          status !== "queued" &&
          status !== "running" &&
          (target.id === currentDetail.identifier || target.name === currentDetail.identifier),
      )
    : undefined;
  const detailRefreshToken = `${detailRefreshRevision}:${latestFinishedDetailOperation?.id ?? ""}:${latestFinishedDetailOperation?.status ?? ""}`;
  const pageEyebrow = currentDetail
    ? currentDetail.type === "compose"
      ? "COMPOSE PROJECT"
      : currentDetail.type === "container"
        ? "CONTAINER DETAIL"
        : "IMAGE DETAIL"
    : currentRoute.eyebrow;
  const pageLabel = currentDetail
    ? currentDetail.type === "compose"
      ? currentDetail.identifier
      : currentDetail.type === "container"
        ? (currentContainer?.name ?? currentDetail.identifier)
        : currentImage
          ? imageDisplayReference(currentImage)
          : currentDetail.identifier
    : currentRoute.label;
  const pageDescription = currentDetail
    ? currentDetail.type === "compose"
      ? "프로젝트 구성, 서비스, 로그와 소스별 설정을 관리합니다."
      : currentDetail.type === "container"
        ? "컨테이너 실행 상태와 전체 구성을 확인합니다."
        : "이미지의 실행 설정, 메타데이터와 파일 시스템 레이어를 확인합니다."
    : currentRoute.description;
  const runComposeAction = (name: string, action: ComposeProjectAction) =>
    mutate({
      key: `compose-${name}-${action}`,
      request: () =>
        apiRequest<OperationAccepted>(
          `/compose/projects/${encodeURIComponent(name)}/actions/${action}`,
          { method: "POST" },
        ),
    });
  const pagePrimaryAction = !runtimeRunning ? null : currentCompose ? (
    <div className="overseer-compose-create-actions">
      {composeIsRunning(currentCompose.status) ? (
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
          onSubmit={(spec: ComposeBuilderSpec) =>
            mutate({
              key: "compose-builder-register",
              request: () =>
                apiRequest<OperationAccepted>("/compose/builder", {
                  body: JSON.stringify(spec),
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
        onSubmit={async (spec) =>
          mutate({
            key: "container-run",
            request: () =>
              apiRequest<OperationAccepted>("/containers", {
                body: JSON.stringify(spec),
                method: "POST",
              }),
          })
        }
        volumes={dashboard?.volumes ?? []}
      />
    </Suspense>
  ) : resourcePath === "/images" ? (
    <PullImageDialog
      busy={submitting === "image-pull"}
      disabled={Boolean(submitting) || runtimeBusy}
      onSubmit={async (image) =>
        mutate({
          key: "image-pull",
          request: () =>
            apiRequest<OperationAccepted>("/images/pull", {
              body: JSON.stringify({ image }),
              method: "POST",
            }),
        })
      }
    />
  ) : resourcePath === "/volumes" ? (
    <CreateNamedResourceDialog
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
    <CreateNamedResourceDialog
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

  return (
    <div className="overseer-shell" data-navigation-mode={navigationMode}>
      <a className="overseer-skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      {navigationMode !== "mobile" ? (
        <aside className="overseer-sidebar" data-navigation-mode={navigationMode}>
          <AppBrand />
          <PrimaryNavigation
            currentPath={currentRoute.path}
            mode={navigationMode}
            onSelect={selectResourcePath}
          />
          <div className="overseer-sidebar-status">
            <span aria-hidden="true" data-state={runtimeStatus.tone} />
            <div>
              <strong>{runtimeStatus.label}</strong>
              <small>{runtime?.instance ?? "overseer"}</small>
            </div>
          </div>
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
                dockerVersion={runtime?.dockerVersion}
                instance={runtime?.instance ?? "overseer"}
                onSelect={selectResourcePath}
                status={runtimeStatus}
              />
            </div>
          </header>
        ) : (
          <header className="overseer-topbar">
            <div>
              <span>Local container console</span>
              <strong>127.0.0.1 전용</strong>
            </div>
            <div className="overseer-topbar-actions">
              {runtime?.dockerVersion ? (
                <span className="overseer-runtime-version">Docker {runtime.dockerVersion}</span>
              ) : null}
              <span className="overseer-runtime-state">
                <Badge
                  aria-label={`Lima ${runtimeStatus.label}`}
                  dot
                  size="sm"
                  tone={runtimeStatus.tone}
                />
                <span>{runtimeStatus.label}</span>
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
              <p>{pageEyebrow}</p>
              <h1 className="city-text-page-title">{pageLabel}</h1>
              <span className="city-text-supporting">{pageDescription}</span>
            </div>
            <div className="overseer-page-actions">
              <div className="overseer-page-utilities">
                {currentDetail ? (
                  <Button
                    onClick={() => selectResourcePath(currentDetail.parentPath)}
                    size="sm"
                    variant="outline"
                  >
                    <ArrowLeft aria-hidden="true" size={14} />
                    {currentDetail.type === "compose"
                      ? "Compose 목록"
                      : currentDetail.type === "container"
                        ? "컨테이너 목록"
                        : "이미지 목록"}
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    if (resourcePath === "/operations") {
                      void loadOperations();
                      return;
                    }
                    if (resourcePath === "/settings") {
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

          {runtime && !runtimeRunning && resourcePath !== "/settings" ? (
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
          resourcePath !== "/settings" ? (
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
                    ? "설정에서 VM 드라이버와 자원을 선택해 overseer 전용 인스턴스를 만드십시오."
                    : "설정의 엔진 설정에서 런타임을 다시 시작할 수 있습니다."}
                </EmptyState.Description>
                <EmptyState.Actions>
                  <Button onClick={() => selectResourcePath("/settings")} size="sm">
                    <Settings2 aria-hidden="true" size={14} />
                    Docker Engine 설정
                  </Button>
                </EmptyState.Actions>
              </EmptyState.Root>
            </section>
          ) : null}

          {dashboard && resourcePath === "/settings" ? (
            <Suspense fallback={<Skeleton className="overseer-loading-table" />}>
              <SettingsPage
                busy={runtimeBusy || Boolean(submitting)}
                dashboard={dashboard}
                onApplyDaemonConfiguration={applyDockerDaemonConfiguration}
                onCheckToolUpdates={checkToolUpdates}
                onConnectDockerCli={connectDockerCli}
                onCreate={createDockerEngine}
                onRecreate={recreateDockerEngine}
                onStart={startRuntime}
                onStop={stopRuntime}
                onUpdateTool={updateTool}
                refreshToken={settingsRefreshToken}
                runtimeBusy={
                  runtimeBusy ||
                  submitting === "runtime-connect" ||
                  submitting === "runtime-start" ||
                  submitting === "runtime-stop"
                }
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
                operations={operations}
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
                onBuilderUpdate={(spec, expectedConfigHash) =>
                  mutate({
                    key: `compose-${currentDetail.identifier}-builder-update`,
                    request: () =>
                      apiRequest<OperationAccepted>(
                        `/compose/projects/${encodeURIComponent(currentDetail.identifier)}/builder`,
                        {
                          body: JSON.stringify({ expectedConfigHash, spec }),
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

          {dashboard &&
          runtimeRunning &&
          !currentDetail &&
          resourcePath !== "/operations" &&
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
                  onBuilderUpdate={(project, spec, expectedConfigHash) =>
                    mutate({
                      key: `compose-${project.name}-builder-update`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/builder`,
                          {
                            body: JSON.stringify({ expectedConfigHash, spec }),
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
                  <ContainerTable
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
                  <ImageTable
                    images={dashboard?.images ?? []}
                    isBusy={(image) => runtimeBusy || targetBusy("image", image.id)}
                    onInspect={(image) => selectResourcePath(imageDetailPath(image.id))}
                    onRemove={(image) =>
                      void mutate({
                        key: `${image.id}-remove`,
                        request: () =>
                          apiRequest<OperationAccepted>(`/images/${image.id}`, {
                            method: "DELETE",
                          }),
                      }).catch(() => undefined)
                    }
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
                  volumes={dashboard?.volumes ?? []}
                />
              ) : null}

              {resourcePath === "/networks" ? (
                <NetworksPage
                  isBusy={(network) => runtimeBusy || targetBusy("network", network.name)}
                  networks={dashboard?.networks ?? []}
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
      <LogsDialog onClose={() => setLogsTarget(undefined)} target={logsTarget} />
      <Toast.Portal>
        <Toast.Viewport>
          {toastManager.toasts.map((toast) => (
            <Toast.Root key={toast.id} toast={toast}>
              <Toast.Content>
                <div>
                  <Toast.Title />
                  <Toast.Description />
                </div>
                <Toast.Close aria-label="알림 닫기" />
              </Toast.Content>
            </Toast.Root>
          ))}
        </Toast.Viewport>
      </Toast.Portal>
    </div>
  );
}

function CreateNamedResourceDialog({
  busy,
  description,
  disabled,
  label,
  onSubmit,
  placeholder,
}: {
  busy: boolean;
  description: string;
  disabled: boolean;
  label: "네트워크" | "볼륨";
  onSubmit: (name: string) => Promise<void>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; name?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!isResourceName(name)) {
      setErrors({ name: "영문·숫자로 시작하고 점·밑줄·하이픈만 사용하십시오." });
      return;
    }
    try {
      await onSubmit(name);
      setOpen(false);
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.code === "invalid_name") {
        setErrors({ name: submitError.message });
        return;
      }
      setErrors({ form: actionError(submitError) });
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setErrors({});
      }}
      open={open}
    >
      <Dialog.Trigger disabled={disabled} render={<Button size="sm" variant="primary" />}>
        <Plus aria-hidden="true" size={15} />
        {label} 만들기
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="sm">
            <Dialog.Title>{label} 만들기</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                {errors.form ? (
                  <Alert.Root tone="destructive">
                    <Alert.Title level={3}>{label}을 만들지 못했습니다.</Alert.Title>
                    <Alert.Description>{errors.form}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.name)}>
                  <Field.Label>
                    이름 <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    autoFocus
                    name="name"
                    onValueChange={() => setErrors((current) => ({ ...current, name: undefined }))}
                    placeholder={placeholder}
                    required
                  />
                  <Field.Description>
                    영문·숫자로 시작하고 점·밑줄·하이픈을 사용할 수 있습니다.
                  </Field.Description>
                  <Field.Error match>{errors.name}</Field.Error>
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={busy} type="submit">
                  {busy ? "만드는 중…" : `${label} 만들기`}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function VolumesPage({
  isBusy,
  onRemove,
  volumes,
}: {
  isBusy: (volume: VolumeSummary) => boolean;
  onRemove: (volume: VolumeSummary) => void;
  volumes: VolumeSummary[];
}) {
  return (
    <section className="overseer-panel" id="volumes">
      <DataTableRegion
        className="overseer-data-table-region"
        hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
        label="볼륨 표"
      >
        <Table.Root
          aria-label="볼륨 목록"
          className="overseer-table overseer-table--volumes"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 볼륨
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">이름</Table.Head>
              <Table.Head>드라이버</Table.Head>
              <Table.Head>범위</Table.Head>
              <Table.Head>레이블</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {volumes.length === 0 ? (
              <Table.StateRow colSpan={5}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <Database aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>볼륨이 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    named volume을 만들어 컨테이너 데이터를 유지할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              volumes.map((volume) => (
                <Table.Row key={volume.name}>
                  <Table.Cell className="overseer-table-column-wide">
                    <strong>{volume.name}</strong>
                  </Table.Cell>
                  <Table.Cell>{volume.driver}</Table.Cell>
                  <Table.Cell>{volume.scope}</Table.Cell>
                  <Table.Cell>{volume.labels || "—"}</Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <ConfirmAction
                        actionLabel="볼륨 삭제"
                        ariaLabel={`${volume.name} 볼륨 삭제`}
                        disabled={isBusy(volume)}
                        description="볼륨의 데이터가 영구적으로 삭제됩니다. 사용 중인 볼륨은 삭제되지 않습니다."
                        onConfirm={() => onRemove(volume)}
                        iconOnly
                        title={`${volume.name} 볼륨을 삭제하시겠습니까?`}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </ConfirmAction>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </DataTableRegion>
    </section>
  );
}

function NetworksPage({
  isBusy,
  networks,
  onRemove,
}: {
  isBusy: (network: NetworkSummary) => boolean;
  networks: NetworkSummary[];
  onRemove: (network: NetworkSummary) => void;
}) {
  return (
    <section className="overseer-panel" id="networks">
      <DataTableRegion
        className="overseer-data-table-region"
        hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
        label="네트워크 표"
      >
        <Table.Root
          aria-label="네트워크 목록"
          className="overseer-table overseer-table--networks"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 네트워크
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">이름</Table.Head>
              <Table.Head>드라이버</Table.Head>
              <Table.Head>범위</Table.Head>
              <Table.Head>IP</Table.Head>
              <Table.Head>내부</Table.Head>
              <Table.Head>네트워크 ID</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {networks.length === 0 ? (
              <Table.StateRow colSpan={7}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <NetworkIcon aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>네트워크가 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    bridge 네트워크를 만들어 컨테이너를 연결할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              networks.map((network) => (
                <Table.Row key={network.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <div className="overseer-primary-cell">
                      <strong>{network.name}</strong>
                      {network.builtIn ? (
                        <span className="overseer-primary-meta">Docker 기본 네트워크</span>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{network.driver}</Table.Cell>
                  <Table.Cell>{network.scope}</Table.Cell>
                  <Table.Cell>
                    {[network.ipv4 ? "IPv4" : null, network.ipv6 ? "IPv6" : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Table.Cell>
                  <Table.Cell>{network.internal ? "예" : "아니요"}</Table.Cell>
                  <Table.Cell>
                    <code>{network.id}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <ConfirmAction
                        actionLabel="네트워크 삭제"
                        ariaLabel={`${network.name} 네트워크 삭제`}
                        disabled={network.builtIn || isBusy(network)}
                        description="연결된 컨테이너가 있는 네트워크는 삭제되지 않습니다."
                        onConfirm={() => onRemove(network)}
                        iconOnly
                        title={`${network.name} 네트워크를 삭제하시겠습니까?`}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </ConfirmAction>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </DataTableRegion>
    </section>
  );
}

function ContainerTable({
  containers,
  isBusy,
  onAction,
  onEdit,
  onInspect,
  onLogs,
  onRemove,
}: {
  containers: ContainerSummary[];
  isBusy: (container: ContainerSummary) => boolean;
  onAction: (container: ContainerSummary, action: "restart" | "start" | "stop") => void;
  onEdit: (container: ContainerSummary) => void;
  onInspect: (container: ContainerSummary) => void;
  onLogs: (container: ContainerSummary) => void;
  onRemove: (container: ContainerSummary) => void;
}) {
  return (
    <DataTableRegion
      className="overseer-data-table-region"
      hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
      label="컨테이너 표"
    >
      <Table.Root
        aria-label="컨테이너 목록"
        className="overseer-table overseer-table--containers"
        size="sm"
      >
        <Table.Caption className="overseer-table-caption">
          Lima overseer 인스턴스의 전체 컨테이너
        </Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head className="overseer-table-column-wide">이름</Table.Head>
            <Table.Head>상태</Table.Head>
            <Table.Head>포트</Table.Head>
            <Table.Head className="overseer-actions-column">작업</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {containers.length === 0 ? (
            <Table.StateRow colSpan={4}>
              <EmptyState.Root className="overseer-table-empty-state" density="compact">
                <EmptyState.Icon>
                  <Box aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>컨테이너가 없습니다.</EmptyState.Title>
                <EmptyState.Description>
                  이미지를 지정해 첫 컨테이너를 실행할 수 있습니다.
                </EmptyState.Description>
              </EmptyState.Root>
            </Table.StateRow>
          ) : (
            containers.map((container) => {
              const running = container.state === "running";
              const rowBusy = isBusy(container);
              return (
                <Table.Row key={container.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <div className="overseer-primary-cell">
                      <a
                        className="overseer-detail-link"
                        href={containerDetailPath(container.id)}
                        onClick={(event) => followAppLink(event, () => onInspect(container))}
                      >
                        {container.name}
                      </a>
                      <div className="overseer-primary-meta">
                        <code>{container.image}</code>
                        {container.composeProject ? (
                          <span
                            title={`Compose 프로젝트 ${container.composeProject}${
                              container.composeService
                                ? ` · 서비스 ${container.composeService}`
                                : ""
                            }`}
                          >
                            Compose · {container.composeProject}
                            {container.composeService &&
                            container.composeService !== container.composeProject
                              ? ` / ${container.composeService}`
                              : ""}
                          </span>
                        ) : null}
                        <code>{container.id}</code>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="overseer-container-status">
                      <Badge
                        aria-label={running ? "실행 중" : "중지됨"}
                        dot
                        size="sm"
                        tone={running ? "success" : "neutral"}
                      />
                      <span>{container.status}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <code>{container.ports || "—"}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <Button
                        disabled={rowBusy}
                        onClick={() => onEdit(container)}
                        size="sm"
                        variant="ghost"
                      >
                        <Settings2 aria-hidden="true" size={14} />
                        설정
                      </Button>
                      {running ? (
                        <>
                          <Button
                            aria-label={`${container.name} 중지`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => onAction(container, "stop")}
                            size="sm"
                            variant="ghost"
                          >
                            <Square aria-hidden="true" size={14} />
                          </Button>
                          <Button
                            aria-label={`${container.name} 재시작`}
                            disabled={rowBusy}
                            iconOnly
                            onClick={() => onAction(container, "restart")}
                            size="sm"
                            variant="ghost"
                          >
                            <RotateCcw aria-hidden="true" size={14} />
                          </Button>
                        </>
                      ) : (
                        <Button
                          aria-label={`${container.name} 시작`}
                          disabled={rowBusy}
                          iconOnly
                          onClick={() => onAction(container, "start")}
                          size="sm"
                          variant="ghost"
                        >
                          <Play aria-hidden="true" size={14} />
                        </Button>
                      )}
                      <Button
                        aria-label={`${container.name} 로그 보기`}
                        disabled={rowBusy}
                        iconOnly
                        onClick={() => onLogs(container)}
                        size="sm"
                        variant="ghost"
                      >
                        <FileText aria-hidden="true" size={14} />
                      </Button>
                      <ConfirmAction
                        actionLabel="컨테이너 삭제"
                        ariaLabel={`${container.name} 컨테이너 삭제`}
                        disabled={running || rowBusy}
                        description="컨테이너의 쓰기 레이어가 삭제됩니다. 연결된 named volume과 이미지는 유지됩니다."
                        onConfirm={() => onRemove(container)}
                        iconOnly
                        title={`${container.name} 컨테이너를 삭제하시겠습니까?`}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </ConfirmAction>
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table.Root>
    </DataTableRegion>
  );
}

function ImageTable({
  images,
  isBusy,
  onInspect,
  onRemove,
}: {
  images: ImageSummary[];
  isBusy: (image: ImageSummary) => boolean;
  onInspect: (image: ImageSummary) => void;
  onRemove: (image: ImageSummary) => void;
}) {
  return (
    <DataTableRegion
      className="overseer-data-table-region"
      hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
      label="이미지 표"
    >
      <Table.Root
        aria-label="이미지 목록"
        className="overseer-table overseer-table--images"
        size="sm"
      >
        <Table.Caption className="overseer-table-caption">
          Lima overseer 인스턴스의 로컬 이미지
        </Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head className="overseer-table-column-wide">이미지</Table.Head>
            <Table.Head>플랫폼</Table.Head>
            <Table.Head>이미지 ID</Table.Head>
            <Table.Head>생성</Table.Head>
            <Table.Head>크기</Table.Head>
            <Table.Head className="overseer-actions-column">작업</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {images.length === 0 ? (
            <Table.StateRow colSpan={6}>
              <EmptyState.Root className="overseer-table-empty-state" density="compact">
                <EmptyState.Icon>
                  <HardDrive aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>로컬 이미지가 없습니다.</EmptyState.Title>
                <EmptyState.Description>
                  필요한 이미지를 먼저 받을 수 있습니다.
                </EmptyState.Description>
              </EmptyState.Root>
            </Table.StateRow>
          ) : (
            images.map((image) => (
              <Table.Row key={`${image.id}-${image.repository}-${image.tag}`}>
                <Table.Cell className="overseer-table-column-wide">
                  <div className="overseer-primary-cell">
                    <a
                      className="overseer-detail-link"
                      href={imageDetailPath(image.id)}
                      onClick={(event) => followAppLink(event, () => onInspect(image))}
                    >
                      {imageDisplayReference(image)}
                    </a>
                    <div className="overseer-primary-meta">
                      <code>{image.url}</code>
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.platform}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.id}</code>
                </Table.Cell>
                <Table.Cell>
                  <time dateTime={image.createdAt}>{formatDateTime(image.createdAt)}</time>
                </Table.Cell>
                <Table.Cell>{image.size}</Table.Cell>
                <Table.Cell>
                  <div className="overseer-row-actions">
                    <ConfirmAction
                      actionLabel="이미지 삭제"
                      ariaLabel={`${imageDisplayReference(image)} 이미지 삭제`}
                      disabled={isBusy(image)}
                      description="이 이미지를 사용하는 컨테이너가 있으면 삭제되지 않습니다."
                      onConfirm={() => onRemove(image)}
                      iconOnly
                      title={`${imageDisplayReference(image)} 이미지를 삭제하시겠습니까?`}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </ConfirmAction>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </DataTableRegion>
  );
}
