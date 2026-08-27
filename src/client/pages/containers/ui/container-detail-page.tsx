import { Accordion } from "@opnay/city-ds-react/accordion";
import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Activity, Terminal } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type {
  ContainerDetail,
  ContainerHealth,
  ContainerHealthStatus,
  ContainerInspection,
  ContainerKeyValue,
  ContainerMount,
  ContainerSummary,
  ContainerTerminalAccess,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { CommandBlock } from "@/shared/ui/command-block";
import { composeProjectDetailPath } from "@/shared/routes";
import { formatDateTime } from "@/shared/lib/date-time";
import { useUrlSection } from "@/shared/lib/url-section";
import { LogViewer } from "@/shared/ui/log-viewer";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";

interface ContainerDetailPageProps {
  id: string;
  onOpenCompose(name: string): void;
  refreshToken: string;
  summary?: ContainerSummary;
}

type ContainerDetailSection =
  | "environment"
  | "health"
  | "inspect"
  | "labels"
  | "overview"
  | "runtime"
  | "terminal";

const sectionPresentation: Record<ContainerDetailSection, { description: string; label: string }> =
  {
    environment: {
      description: "컨테이너 프로세스에 전달되는 환경 변수를 확인합니다.",
      label: "환경 변수",
    },
    health: {
      description: "현재 상태와 Docker가 보관한 최근 검사 결과를 확인합니다.",
      label: "상태 검사",
    },
    inspect: {
      description: "Docker Engine이 반환한 전체 컨테이너 원본 JSON을 확인합니다.",
      label: "원본 정보",
    },
    labels: {
      description: "Overseer 예약 항목을 제외한 사용자 라벨을 확인합니다.",
      label: "라벨",
    },
    overview: {
      description: "컨테이너 상태와 식별 정보, Compose 소속을 확인합니다.",
      label: "개요",
    },
    runtime: {
      description: "이미지, 명령, 실행 정책, 리소스와 연결 구성을 확인합니다.",
      label: "실행 설정",
    },
    terminal: {
      description: "로컬 터미널에서 컨테이너 셸에 연결할 명령을 확인합니다.",
      label: "터미널",
    },
  };
const sectionOrder: ContainerDetailSection[] = [
  "overview",
  "runtime",
  "terminal",
  "health",
  "environment",
  "labels",
  "inspect",
];

const containerDetailNavigation = [
  {
    items: sectionOrder.map((value) => ({ label: sectionPresentation[value].label, value })),
    label: "컨테이너",
  },
];

const healthStatusPresentation: Record<
  ContainerHealthStatus,
  { label: string; tone: "destructive" | "info" | "success" }
> = {
  healthy: { label: "정상", tone: "success" },
  starting: { label: "확인 중", tone: "info" },
  unhealthy: { label: "비정상", tone: "destructive" },
};

function followComposeLink(
  event: MouseEvent<HTMLAnchorElement>,
  name: string,
  onOpenCompose: (name: string) => void,
) {
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onOpenCompose(name);
}

function restartPolicy(detail: ContainerDetail): string {
  const policy = detail.spec.restartPolicy;
  return policy.mode === "on-failure" && policy.maximumRetryCount !== undefined
    ? `${policy.mode}:${policy.maximumRetryCount}`
    : policy.mode;
}

function TerminalAccess({ access }: { access: ContainerTerminalAccess }) {
  if (access.status === "ready" && access.command && access.shell) {
    return (
      <section className="overseer-detail-section">
        <p className="city-text-supporting">
          로컬 터미널에서 아래 명령을 실행하면 현재 컨테이너 셸에 연결됩니다.
        </p>
        <dl className="overseer-detail-definitions">
          <Definition label="실행 셸" value={<code>{access.shell}</code>} />
        </dl>
        <CommandBlock
          ariaLabel="컨테이너 터미널 명령"
          command={access.command}
          copyLabel="터미널 명령 복사"
          label="로컬 터미널에서 실행"
        />
      </section>
    );
  }

  const paused = access.status === "paused";
  const shellNotFound = access.status === "shell-not-found";
  return (
    <EmptyState.Root>
      <EmptyState.Icon>
        <Terminal aria-hidden="true" />
      </EmptyState.Icon>
      <EmptyState.Title level={3}>
        {shellNotFound
          ? "실행할 셸을 찾을 수 없습니다."
          : paused
            ? "컨테이너가 일시 중지되어 있습니다."
            : "컨테이너가 실행 중이 아닙니다."}
      </EmptyState.Title>
      <EmptyState.Description>
        {shellNotFound
          ? "이미지에 sh, bash, ash 또는 zsh를 포함하거나 실행 파일을 직접 지정하십시오."
          : paused
            ? "일시 중지를 해제한 뒤 다시 확인하십시오."
            : "컨테이너를 시작한 뒤 다시 확인하십시오."}
      </EmptyState.Description>
    </EmptyState.Root>
  );
}

function Definition({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "overseer-detail-definition--wide" : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function mountPresentation(mount: ContainerMount) {
  if (mount.type === "bind") {
    return { label: "바인드 마운트", sourceLabel: "호스트 경로", source: mount.hostPath };
  }
  if (mount.type === "volume") {
    return { label: "이름 있는 볼륨", sourceLabel: "볼륨", source: mount.volume };
  }
  return {
    label: `${mount.dockerType} 마운트`,
    sourceLabel: "소스",
    source: mount.source ?? "—",
  };
}

function Mounts({ mounts }: { mounts: ContainerMount[] }) {
  if (mounts.length === 0) return <>없음</>;
  return (
    <ul className="overseer-detail-mounts">
      {mounts.map((mount) => {
        const presentation = mountPresentation(mount);
        return (
          <li key={`${mount.type}:${presentation.source}:${mount.containerPath}`}>
            <div className="overseer-detail-mount-header">
              <Badge appearance="outline" size="sm" tone="neutral">
                {presentation.label}
              </Badge>
              <span>{mount.readOnly ? "읽기 전용" : "읽기/쓰기"}</span>
            </div>
            <dl className="overseer-detail-mount-paths">
              <div>
                <dt>{presentation.sourceLabel}</dt>
                <dd>
                  <code>{presentation.source}</code>
                </dd>
              </div>
              <div>
                <dt>컨테이너 경로</dt>
                <dd>
                  <code>{mount.containerPath}</code>
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function KeyValues({ empty, values }: { empty: string; values: ContainerKeyValue[] }) {
  if (values.length === 0) return <p className="overseer-detail-empty-copy">{empty}</p>;
  return (
    <dl className="overseer-detail-key-values">
      {values.map(({ key, value }) => (
        <div key={key}>
          <dt>
            <code>{key}</code>
          </dt>
          <dd>
            <code>{value || "—"}</code>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HealthCheckHistory({ health }: { health: ContainerHealth }) {
  const status = healthStatusPresentation[health.status];
  const latest = health.history[0];
  return (
    <>
      <dl className="overseer-detail-definitions">
        <Definition
          label="현재 상태"
          value={
            <span className="overseer-settings-status-value">
              <Badge dot size="sm" tone={status.tone} />
              {status.label}
            </span>
          }
        />
        <Definition label="연속 실패" value={`${health.failingStreak}회`} />
        <Definition
          label="최근 검사"
          value={latest ? formatDateTime(latest.startedAt) : "기록 없음"}
        />
      </dl>

      <section className="overseer-detail-section">
        <header>
          <div>
            <h3 className="city-text-subsection-title">실행 이력</h3>
            <p>Docker가 보관한 최근 상태 검사 결과입니다.</p>
          </div>
        </header>
        {health.history.length === 0 ? (
          <EmptyState.Root density="compact">
            <EmptyState.Icon>
              <Activity aria-hidden="true" />
            </EmptyState.Icon>
            <EmptyState.Title level={4}>상태 검사 실행 기록이 없습니다.</EmptyState.Title>
            <EmptyState.Description>
              첫 검사가 끝나면 결과와 출력이 여기에 표시됩니다.
            </EmptyState.Description>
          </EmptyState.Root>
        ) : (
          <Accordion.Root
            className="overseer-health-check-history"
            defaultValue={["health-check-0"]}
          >
            {health.history.map((entry, index) => {
              const succeeded = entry.exitCode === 0;
              return (
                <Accordion.Item key={`${entry.startedAt}-${index}`} value={`health-check-${index}`}>
                  <Accordion.Header render={<h4 />}>
                    <Accordion.Trigger>
                      <span className="overseer-health-check-trigger">
                        <Badge
                          appearance="subtle"
                          size="lg"
                          tone={succeeded ? "success" : "destructive"}
                        >
                          {succeeded ? "성공" : "실패"}
                        </Badge>
                        <time dateTime={entry.startedAt}>{formatDateTime(entry.startedAt)}</time>
                        <code>exit {entry.exitCode}</code>
                      </span>
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Panel>
                    <LogViewer
                      ariaLabel={`${formatDateTime(entry.startedAt)} 상태 검사 출력`}
                      context={
                        <span>
                          종료 <time dateTime={entry.endedAt}>{formatDateTime(entry.endedAt)}</time>
                        </span>
                      }
                      emptyMessage="상태 검사 출력이 없습니다."
                      height="compact"
                      optionsLabel="상태 검사 출력 옵션"
                      value={entry.output}
                    />
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion.Root>
        )}
      </section>
    </>
  );
}

export function ContainerDetailPage({
  id,
  onOpenCompose,
  refreshToken,
  summary,
}: ContainerDetailPageProps) {
  const [detail, setDetail] = useState<ContainerDetail>();
  const [error, setError] = useState<string>();
  const [inspection, setInspection] = useState<ContainerInspection>();
  const [inspectionAttempt, setInspectionAttempt] = useState(0);
  const [inspectionError, setInspectionError] = useState<string>();
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [section, setSection] = useUrlSection({
    defaultValue: "overview",
    locationKey: id,
    values: sectionOrder,
  });
  const [terminal, setTerminal] = useState<ContainerTerminalAccess>();
  const [terminalAttempt, setTerminalAttempt] = useState(0);
  const [terminalError, setTerminalError] = useState<string>();
  const [terminalLoading, setTerminalLoading] = useState(false);

  useEffect(() => {
    setInspection(undefined);
    setInspectionAttempt(0);
    setInspectionError(undefined);
    setTerminal(undefined);
    setTerminalAttempt(0);
    setTerminalError(undefined);
  }, [id]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiRequest<{ container: ContainerDetail }>(`/containers/${encodeURIComponent(id)}`)
      .then(({ container }) => active && setDetail(container))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error ? loadError.message : "컨테이너 상세를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [id, refreshToken]);

  const inspectionVisible = section === "health" || section === "inspect";
  useEffect(() => {
    if (!inspectionVisible) return;
    let active = true;
    setInspection(undefined);
    setInspectionError(undefined);
    setInspectionLoading(true);
    void apiRequest<{ inspection: ContainerInspection }>(
      `/containers/${encodeURIComponent(id)}/inspect`,
    )
      .then(({ inspection: value }) => active && setInspection(value))
      .catch(
        (loadError: unknown) =>
          active &&
          setInspectionError(
            loadError instanceof Error ? loadError.message : "원본 정보를 불러오지 못했습니다.",
          ),
      )
      .finally(() => active && setInspectionLoading(false));
    return () => {
      active = false;
    };
  }, [id, inspectionAttempt, inspectionVisible, refreshToken]);

  const terminalVisible = section === "terminal";
  useEffect(() => {
    if (!terminalVisible) return;
    let active = true;
    setTerminal(undefined);
    setTerminalError(undefined);
    setTerminalLoading(true);
    void apiRequest<{ terminal: ContainerTerminalAccess }>(
      `/containers/${encodeURIComponent(id)}/terminal`,
    )
      .then(({ terminal: value }) => active && setTerminal(value))
      .catch(
        (loadError: unknown) =>
          active &&
          setTerminalError(
            loadError instanceof Error ? loadError.message : "터미널 명령을 확인하지 못했습니다.",
          ),
      )
      .finally(() => active && setTerminalLoading(false));
    return () => {
      active = false;
    };
  }, [id, refreshToken, terminalAttempt, terminalVisible]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>컨테이너 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!detail) {
    return (
      <section aria-label="컨테이너 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const spec = detail.spec;
  const running = summary ? summary.state === "running" : detail.running;
  const composeProject = summary?.composeProject;
  const ports = spec.ports.map(({ containerPort, hostPort, protocol }) =>
    hostPort
      ? `127.0.0.1:${hostPort} → ${containerPort}/${protocol}`
      : `${containerPort}/${protocol}`,
  );
  const presentation = sectionPresentation[section];

  return (
    <article className="overseer-detail-page">
      <SectionedWorkspace<ContainerDetailSection>
        category="컨테이너"
        description={presentation.description}
        groups={containerDetailNavigation}
        navigationLabel="컨테이너 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.label}
      >
        {section === "overview" ? (
          <>
            <section aria-label="컨테이너 개요" className="overseer-detail-summary">
              <div>
                <span>상태</span>
                <strong className="overseer-settings-status-value">
                  <Badge dot size="sm" tone={running ? "success" : "neutral"} />
                  {summary?.status ?? (detail.running ? "실행 중" : "중지됨")}
                </strong>
              </div>
              <div>
                <span>이미지</span>
                <strong>{summary?.image ?? spec.image}</strong>
              </div>
              <div>
                <span>포트</span>
                <strong>{summary?.ports || ports.join(" · ") || "—"}</strong>
              </div>
            </section>

            {detail.replacementBlockers.length > 0 ? (
              <Alert.Root appearance="subtle" tone="warning">
                <Alert.Title level={3}>일부 설정은 읽기 전용입니다.</Alert.Title>
                <Alert.Description>{detail.replacementBlockers.join(" ")}</Alert.Description>
              </Alert.Root>
            ) : null}

            <section className="overseer-detail-section">
              <header>
                <div>
                  <h3 className="city-text-subsection-title">식별 정보</h3>
                </div>
              </header>
              <dl className="overseer-detail-definitions">
                <Definition label="이름" value={spec.name ?? "—"} />
                <Definition label="ID" value={<code>{detail.id}</code>} />
                {composeProject ? (
                  <Definition
                    label="Compose 프로젝트"
                    value={
                      <a
                        className="overseer-detail-link"
                        href={composeProjectDetailPath(composeProject)}
                        onClick={(event) => followComposeLink(event, composeProject, onOpenCompose)}
                      >
                        {composeProject}
                        {summary.composeService ? ` / ${summary.composeService}` : ""}
                      </a>
                    }
                  />
                ) : null}
              </dl>
            </section>
          </>
        ) : null}

        {section === "runtime" ? (
          <div className="overseer-detail-section-list">
            <section className="overseer-detail-section">
              <header>
                <div>
                  <h3 className="city-text-subsection-title">기본 정보</h3>
                  <p>컨테이너가 시작될 때 적용되는 이미지와 프로세스 설정입니다.</p>
                </div>
              </header>
              <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                <Definition label="이미지" value={<code>{spec.image}</code>} />
                <Definition label="호스트 이름" value={spec.hostname ?? "—"} />
                <Definition label="재시작 정책" value={<code>{restartPolicy(detail)}</code>} />
                <Definition
                  label="명령"
                  value={
                    spec.command.length > 0 ? (
                      <code>{spec.command.join(" ")}</code>
                    ) : (
                      "지정되지 않음"
                    )
                  }
                />
              </dl>
            </section>

            <section className="overseer-detail-section">
              <header>
                <div>
                  <h3 className="city-text-subsection-title">리소스 제한</h3>
                  <p>컨테이너가 사용할 수 있는 CPU와 메모리 한도입니다.</p>
                </div>
              </header>
              <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                <Definition label="CPU" value={spec.resources.cpus ?? "제한 없음"} />
                <Definition
                  label="메모리"
                  value={
                    spec.resources.memoryMiB === undefined
                      ? "제한 없음"
                      : `${spec.resources.memoryMiB} MiB`
                  }
                />
              </dl>
            </section>

            <section className="overseer-detail-section">
              <header>
                <div>
                  <h3 className="city-text-subsection-title">네트워크 및 저장소</h3>
                  <p>외부 공개 포트, 연결 네트워크와 데이터 마운트입니다.</p>
                </div>
              </header>
              <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                <Definition
                  label="포트"
                  value={
                    ports.length > 0 ? ports.map((port) => <code key={port}>{port}</code>) : "없음"
                  }
                />
                <Definition
                  label="네트워크"
                  value={
                    spec.networks.length > 0
                      ? spec.networks.map((network) => <code key={network}>{network}</code>)
                      : "없음"
                  }
                />
                <Definition label="마운트" value={<Mounts mounts={detail.mounts} />} wide />
              </dl>
            </section>
          </div>
        ) : null}

        {terminalVisible && terminalLoading ? (
          <section aria-label="터미널 명령 확인 중" className="overseer-detail-loading">
            <Skeleton />
            <Skeleton className="overseer-loading-table" />
          </section>
        ) : null}

        {terminalVisible && terminalError ? (
          <Alert.Root tone="destructive">
            <Alert.Title level={3}>터미널 명령을 확인하지 못했습니다.</Alert.Title>
            <Alert.Description>{terminalError}</Alert.Description>
            <Alert.Action>
              <Button
                onClick={() => setTerminalAttempt((value) => value + 1)}
                size="sm"
                variant="outline"
              >
                다시 시도
              </Button>
            </Alert.Action>
          </Alert.Root>
        ) : null}

        {terminalVisible && terminal && !terminalError ? (
          <TerminalAccess access={terminal} />
        ) : null}

        {inspectionVisible && inspectionError ? (
          <Alert.Root tone="destructive">
            <Alert.Title level={3}>원본 정보를 불러오지 못했습니다.</Alert.Title>
            <Alert.Description>{inspectionError}</Alert.Description>
            <Alert.Action>
              <Button
                onClick={() => setInspectionAttempt((value) => value + 1)}
                size="sm"
                variant="outline"
              >
                다시 시도
              </Button>
            </Alert.Action>
          </Alert.Root>
        ) : null}

        {section === "health" && inspectionLoading ? (
          <section aria-label="상태 검사 불러오는 중" className="overseer-detail-loading">
            <Skeleton />
            <Skeleton />
            <Skeleton className="overseer-loading-table" />
          </section>
        ) : null}

        {section === "health" && inspection && !inspectionError ? (
          inspection.health ? (
            <HealthCheckHistory health={inspection.health} />
          ) : (
            <EmptyState.Root>
              <EmptyState.Icon>
                <Activity aria-hidden="true" />
              </EmptyState.Icon>
              <EmptyState.Title level={3}>상태 검사가 설정되지 않았습니다.</EmptyState.Title>
              <EmptyState.Description>
                이미지 또는 Compose에 상태 검사를 추가하면 상태와 실행 이력을 확인할 수 있습니다.
              </EmptyState.Description>
            </EmptyState.Root>
          )
        ) : null}

        {section === "inspect" && !inspectionError ? (
          <section className="overseer-detail-section">
            <Alert.Root appearance="subtle" tone="warning">
              <Alert.Title level={3}>민감한 설정이 포함될 수 있습니다.</Alert.Title>
              <Alert.Description>
                원본 JSON에는 환경 변수, 라벨과 호스트 경로가 그대로 표시됩니다.
              </Alert.Description>
            </Alert.Root>
            <LogViewer
              ariaLabel="Docker 원본 JSON"
              context={<code>docker inspect {detail.id.slice(0, 12)}</code>}
              emptyMessage="원본 정보가 없습니다."
              height="expanded"
              loading={inspectionLoading}
              loadingMessage="원본 JSON을 불러오는 중…"
              optionsLabel="원본 정보 보기 옵션"
              value={inspection?.json ?? ""}
            />
          </section>
        ) : null}

        {section === "environment" ? (
          <KeyValues empty="환경 변수가 없습니다." values={spec.environment} />
        ) : null}

        {section === "labels" ? (
          <KeyValues empty="사용자 라벨이 없습니다." values={spec.labels} />
        ) : null}
      </SectionedWorkspace>
    </article>
  );
}
