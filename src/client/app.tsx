import { Alert } from "@opnay/city-ds-react/alert";
import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Toolbar } from "@opnay/city-ds-react/toolbar";
import { Toast } from "@opnay/city-ds-react/toast";
import {
  ArrowDownToLine,
  Box,
  Boxes,
  Check,
  CircleStop,
  Container,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  Layers3,
  ListChecks,
  ListTree,
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
  ComposeProjectDetail,
  ComposeProjectSummary,
  ContainerDetail,
  ContainerSpecInput,
  ContainerSummary,
  DashboardSnapshot,
  ImageSummary,
  NetworkSummary,
  OperationAccepted,
  OperationSnapshot,
  OperationResource,
  RegisterRemoteComposeInput,
  RuntimePhase,
  VolumeSummary,
} from "../shared/contracts.ts";
import { isImageReference, isResourceName } from "../shared/validation.ts";
import { ApiRequestError, apiRequest } from "./api.ts";
import {
  getResourceRoute,
  RESOURCE_ROUTES,
  RESOURCE_ROUTE_GROUPS,
  type ResourcePath,
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
  "/volumes": Database,
} satisfies Record<ResourcePath, typeof Layers3>;

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

function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

function LoadingScreen() {
  return (
    <div aria-busy="true" aria-label="대시보드 불러오는 중" className="overseer-shell">
      <aside aria-hidden="true" className="overseer-sidebar overseer-loading-sidebar">
        <Skeleton className="overseer-loading-brand" />
        <div className="overseer-loading-nav">
          {RESOURCE_ROUTE_GROUPS.map((group) => (
            <div className="overseer-loading-nav-group" key={group.id}>
              <Skeleton className="overseer-loading-nav-label" />
              <div className="overseer-loading-nav-items">
                {RESOURCE_ROUTES.filter((route) => route.group === group.id).map((route) => (
                  <Skeleton className="overseer-loading-nav-item" key={route.path} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="overseer-workspace">
        <header aria-hidden="true" className="overseer-topbar">
          <Skeleton className="overseer-loading-topbar-context" />
          <Skeleton className="overseer-loading-topbar-action" />
        </header>
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
              <section aria-label={`${target?.title} 터미널`} className="overseer-terminal">
                <div className="overseer-terminal-toolbar">
                  <div className="overseer-terminal-context">
                    <Terminal aria-hidden="true" size={14} />
                    <code>tail -n 300</code>
                    <span aria-live="polite">{loading ? "동기화 중…" : `${lines.length}줄`}</span>
                  </div>
                  <Toolbar.Root
                    appearance="plain"
                    aria-label="로그 명령"
                    className="overseer-terminal-actions"
                    size="sm"
                  >
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
                </div>
                <div
                  aria-busy={loading}
                  className="overseer-terminal-scroll"
                  ref={scrollRef}
                  tabIndex={0}
                >
                  {loading && lines.length === 0 ? (
                    <div className="overseer-terminal-empty" role="status">
                      로그를 불러오는 중…
                    </div>
                  ) : lines.length === 0 ? (
                    <div className="overseer-terminal-empty">출력된 로그가 없습니다.</div>
                  ) : (
                    <ol className="overseer-terminal-lines">
                      {lines.map((line, index) => (
                        <li key={`${index}-${line.slice(0, 24)}`}>
                          <code>{line || " "}</code>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
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

function ComposeProjectDialog({
  onClose,
  project,
}: {
  onClose: () => void;
  project?: ComposeProjectSummary;
}) {
  const [detail, setDetail] = useState<ComposeProjectDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await apiRequest<{ project: ComposeProjectDetail }>(
        `/compose/projects/${encodeURIComponent(project.name)}`,
      );
      setDetail(result.project);
    } catch (loadError) {
      setError(actionError(loadError));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setDetail(undefined);
    if (project) void load();
  }, [project, load]);

  return (
    <Dialog.Root onOpenChange={(open) => !open && onClose()} open={Boolean(project)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="xl">
            <Dialog.Header>
              <div>
                <Dialog.Title>{project?.name} 서비스</Dialog.Title>
                <Dialog.Description>
                  {project?.configFiles.map(composeFileName).join(" · ")}
                </Dialog.Description>
              </div>
              <Button disabled={loading} onClick={() => void load()} size="sm" variant="outline">
                <RefreshCw aria-hidden="true" size={14} />
                새로고침
              </Button>
            </Dialog.Header>
            <Dialog.Body>
              {error ? (
                <Alert.Root tone="destructive">
                  <Alert.Title level={3}>서비스 상태를 불러오지 못했습니다.</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : loading && !detail ? (
                <div aria-live="polite" role="status">
                  서비스 상태를 불러오는 중…
                </div>
              ) : detail ? (
                <DataTableRegion
                  hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
                  label={`${detail.name} 서비스 표`}
                >
                  <Table.Root
                    aria-label={`${detail.name} 서비스 목록`}
                    className="overseer-table overseer-table--compose-services"
                    size="sm"
                  >
                    <Table.Caption className="overseer-table-caption">
                      {detail.name} Compose 서비스
                    </Table.Caption>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head>서비스</Table.Head>
                        <Table.Head>컨테이너</Table.Head>
                        <Table.Head>이미지</Table.Head>
                        <Table.Head>상태</Table.Head>
                        <Table.Head>포트</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {detail.services.length === 0 ? (
                        <Table.StateRow colSpan={5}>
                          등록된 서비스 컨테이너가 없습니다.
                        </Table.StateRow>
                      ) : (
                        detail.services.map((service) => {
                          const running = service.state === "running";
                          return (
                            <Table.Row key={service.id || service.name}>
                              <Table.Cell>
                                <strong>{service.service}</strong>
                              </Table.Cell>
                              <Table.Cell>{service.name}</Table.Cell>
                              <Table.Cell>{service.image}</Table.Cell>
                              <Table.Cell>
                                <span className="overseer-container-status">
                                  <Badge
                                    aria-label={running ? "실행 중" : "중지됨"}
                                    dot
                                    size="sm"
                                    tone={running ? "success" : "neutral"}
                                  />
                                  <span>{service.health || service.status}</span>
                                </span>
                              </Table.Cell>
                              <Table.Cell>
                                <code>{service.ports || "—"}</code>
                              </Table.Cell>
                            </Table.Row>
                          );
                        })
                      )}
                    </Table.Body>
                  </Table.Root>
                </DataTableRegion>
              ) : null}
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
              <Table.Head>프로젝트</Table.Head>
              <Table.Head>상태</Table.Head>
              <Table.Head>구성 파일</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {projects.length === 0 ? (
              <Table.StateRow colSpan={4}>
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
                    <Table.Cell>
                      <div className="overseer-primary-cell">
                        <strong>{project.name}</strong>
                        {project.remote ? (
                          <span className="overseer-primary-meta">URL 등록</span>
                        ) : project.builder ? (
                          <span className="overseer-primary-meta">폼 등록</span>
                        ) : null}
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
                      <code
                        className="overseer-compose-config"
                        title={project.remote?.url ?? project.configFiles.join(", ")}
                      >
                        {project.remote?.url ??
                          (project.builder
                            ? "SQLite 생성 compose.yaml"
                            : project.configFiles.map(composeFileName).join(" · "))}
                      </code>
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
  request: () => Promise<OperationAccepted>;
}

function resourcePathFromLocation(): ResourcePath {
  return getResourceRoute(window.location.pathname).path;
}

export function App() {
  return (
    <Toast.Provider limit={3} timeout={5_000}>
      <AppContent />
    </Toast.Provider>
  );
}

function AppContent() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);
  const [editContainer, setEditContainer] = useState<ContainerSummary>();
  const [composeDetailProject, setComposeDetailProject] = useState<ComposeProjectSummary>();
  const [logsTarget, setLogsTarget] = useState<LogsTarget>();
  const [dark, setDark] = useState(() => window.localStorage.getItem("overseer-theme") === "dark");
  const [resourcePath, setResourcePath] = useState<ResourcePath>(resourcePathFromLocation);
  const notifiedOperations = useRef(new Set<string>());
  const operationsInitialized = useRef(false);
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

  const refreshResource = useCallback(
    async (resource: OperationResource) => {
      try {
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
    [refresh],
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
      }
    }
  }, [operations, refreshResource, toastManager]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("overseer-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (window.location.pathname !== resourcePath) {
      window.history.replaceState(null, "", resourcePath);
    }
    const syncResourcePath = () => setResourcePath(resourcePathFromLocation());
    window.addEventListener("popstate", syncResourcePath);
    return () => window.removeEventListener("popstate", syncResourcePath);
  }, []);

  const selectResourcePath = useCallback((nextPath: ResourcePath) => {
    setResourcePath(nextPath);
    if (window.location.pathname !== nextPath) window.history.pushState(null, "", nextPath);
  }, []);

  const handleResourceLink = (event: MouseEvent<HTMLAnchorElement>, nextPath: ResourcePath) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    selectResourcePath(nextPath);
  };

  const mutate = async ({ key, request }: MutationOptions) => {
    setSubmitting(key);
    setOperationError(undefined);
    try {
      const { operation } = await request();
      if (!operation) throw new Error("작업 응답을 확인하지 못했습니다.");
      setOperations((current) => [operation, ...current.filter(({ id }) => id !== operation.id)]);
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

  if (!dashboard && !loadError) return <LoadingScreen />;

  const runtime = dashboard?.runtime;
  const runtimeStatus = runtime ? runtimePresentation[runtime.phase] : runtimePresentation.error;
  const runtimeRunning = runtime?.phase === "running";
  const activeOperations = operations.filter(
    ({ status }) => status === "queued" || status === "running",
  );
  const targetBusy = (resource: OperationResource, identifier: string) =>
    activeOperations.some(
      ({ target }) =>
        target.resource === resource && (target.id === identifier || target.name === identifier),
    );
  const runtimeBusy = activeOperations.some(({ target }) => target.resource === "runtime");
  const currentRoute = getResourceRoute(resourcePath);
  const pagePrimaryAction = !runtimeRunning ? null : resourcePath === "/compose" ? (
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
    <div className="overseer-shell">
      <a className="overseer-skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className="overseer-sidebar">
        <div className="overseer-brand">
          <span aria-hidden="true">
            <Container size={20} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Overseer</strong>
            <small>Lima control plane</small>
          </div>
        </div>
        <nav aria-label="주요 메뉴">
          {RESOURCE_ROUTE_GROUPS.map((group) => {
            const labelId = `overseer-nav-${group.id}`;
            return (
              <div
                aria-labelledby={labelId}
                className="overseer-nav-group"
                key={group.id}
                role="group"
              >
                <span className="overseer-nav-group-label" id={labelId}>
                  {group.label}
                </span>
                <div className="overseer-nav-group-items">
                  {RESOURCE_ROUTES.filter((route) => route.group === group.id).map((route) => {
                    const Icon = resourceRouteIcon[route.path];
                    return (
                      <a
                        aria-current={resourcePath === route.path ? "page" : undefined}
                        href={route.path}
                        key={route.path}
                        onClick={(event) => handleResourceLink(event, route.path)}
                      >
                        <Icon aria-hidden="true" size={16} />
                        {route.label}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="overseer-sidebar-status">
          <span aria-hidden="true" data-state={runtimeStatus.tone} />
          <div>
            <strong>{runtimeStatus.label}</strong>
            <small>{runtime?.instance ?? "overseer"}</small>
          </div>
        </div>
      </aside>

      <div className="overseer-workspace">
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
              {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            </Button>
          </div>
        </header>

        <main className="overseer-main" id="main-content">
          <section className="overseer-page-header">
            <div>
              <p>{currentRoute.eyebrow}</p>
              <h1 className="city-text-page-title">{currentRoute.label}</h1>
              <span className="city-text-supporting">{currentRoute.description}</span>
            </div>
            <div className="overseer-page-actions">
              <div className="overseer-page-utilities">
                <Button
                  onClick={() =>
                    void (resourcePath === "/operations" ? loadOperations() : refresh())
                  }
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw aria-hidden="true" size={14} />
                  새로고침
                </Button>
                {runtime?.phase === "missing" || runtime?.phase === "stopped" ? (
                  <Button
                    disabled={runtimeBusy || submitting === "runtime-start"}
                    onClick={() =>
                      void mutate({
                        key: "runtime-start",
                        request: () =>
                          apiRequest<OperationAccepted>("/runtime/start", { method: "POST" }),
                      }).catch(() => undefined)
                    }
                    size="sm"
                  >
                    <Play aria-hidden="true" size={14} />
                    {submitting === "runtime-start" || runtimeBusy
                      ? "준비 중…"
                      : runtime.phase === "missing"
                        ? "Lima 환경 만들기"
                        : "런타임 시작"}
                  </Button>
                ) : runtimeRunning ? (
                  <ConfirmAction
                    actionLabel="런타임 중지"
                    disabled={runtimeBusy || Boolean(submitting)}
                    description="실행 중인 컨테이너에 접근할 수 없게 됩니다. 컨테이너 데이터는 유지됩니다."
                    onConfirm={() =>
                      void mutate({
                        key: "runtime-stop",
                        request: () =>
                          apiRequest<OperationAccepted>("/runtime/stop", { method: "POST" }),
                      }).catch(() => undefined)
                    }
                    title="Lima 런타임을 중지하시겠습니까?"
                  >
                    <CircleStop aria-hidden="true" size={14} />
                    런타임 중지
                  </ConfirmAction>
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

          {runtime && !runtimeRunning ? (
            <Alert.Root appearance="subtle" tone={runtimeStatus.tone}>
              <Alert.Title level={2}>Lima · {runtimeStatus.label}</Alert.Title>
              <Alert.Description>
                {runtime.message}
                {runtime.dockerVersion ? ` Docker ${runtime.dockerVersion}` : ""}
              </Alert.Description>
            </Alert.Root>
          ) : null}

          {dashboard && !runtimeRunning && resourcePath !== "/operations" ? (
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
                    ? "공식 Docker 템플릿으로 overseer 전용 인스턴스를 생성합니다."
                    : "상단의 런타임 액션으로 다시 시작할 수 있습니다."}
                </EmptyState.Description>
              </EmptyState.Root>
            </section>
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

          {dashboard && runtimeRunning && resourcePath !== "/operations" ? (
            <>
              {resourcePath === "/compose" ? (
                <ComposePage
                  isBusy={(project) => runtimeBusy || targetBusy("compose", project.name)}
                  onAction={(project, action) =>
                    mutate({
                      key: `compose-${project.name}-${action}`,
                      request: () =>
                        apiRequest<OperationAccepted>(
                          `/compose/projects/${encodeURIComponent(project.name)}/actions/${action}`,
                          { method: "POST" },
                        ),
                    })
                  }
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
                  onInspect={setComposeDetailProject}
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
      <ComposeProjectDialog
        onClose={() => setComposeDetailProject(undefined)}
        project={composeDetailProject}
      />
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
              <Table.Head>이름</Table.Head>
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
                  <Table.Cell>
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
              <Table.Head>이름</Table.Head>
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
                  <Table.Cell>
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
  onLogs,
  onRemove,
}: {
  containers: ContainerSummary[];
  isBusy: (container: ContainerSummary) => boolean;
  onAction: (container: ContainerSummary, action: "restart" | "start" | "stop") => void;
  onEdit: (container: ContainerSummary) => void;
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
            <Table.Head>이름</Table.Head>
            <Table.Head>이미지</Table.Head>
            <Table.Head>상태</Table.Head>
            <Table.Head>포트</Table.Head>
            <Table.Head className="overseer-actions-column">작업</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {containers.length === 0 ? (
            <Table.StateRow colSpan={5}>
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
                  <Table.Cell>
                    <div className="overseer-primary-cell">
                      <strong>{container.name}</strong>
                      <div className="overseer-primary-meta">
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
                  <Table.Cell>{container.image}</Table.Cell>
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
  onRemove,
}: {
  images: ImageSummary[];
  isBusy: (image: ImageSummary) => boolean;
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
            <Table.Head>저장소</Table.Head>
            <Table.Head>태그</Table.Head>
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
                <Table.Cell>
                  <strong>{image.repository}</strong>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.tag}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.id}</code>
                </Table.Cell>
                <Table.Cell>{image.createdSince}</Table.Cell>
                <Table.Cell>{image.size}</Table.Cell>
                <Table.Cell>
                  <div className="overseer-row-actions">
                    <ConfirmAction
                      actionLabel="이미지 삭제"
                      ariaLabel={`${image.repository} 이미지 삭제`}
                      disabled={isBusy(image)}
                      description="이 이미지를 사용하는 컨테이너가 있으면 삭제되지 않습니다."
                      onConfirm={() => onRemove(image)}
                      iconOnly
                      title={`${image.repository}:${image.tag} 이미지를 삭제하시겠습니까?`}
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
