import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type {
  ContainerDetail,
  ContainerKeyValue,
  ContainerMount,
  ContainerSummary,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { composeProjectDetailPath } from "./routes.ts";

interface ContainerDetailPageProps {
  id: string;
  onOpenCompose(name: string): void;
  refreshToken: string;
  summary?: ContainerSummary;
}

type ContainerDetailSection = "environment" | "labels" | "network" | "overview" | "runtime";

const sectionPresentation: Record<ContainerDetailSection, { description: string; label: string }> =
  {
    environment: {
      description: "컨테이너 프로세스에 전달되는 환경 변수를 확인합니다.",
      label: "환경 변수",
    },
    labels: {
      description: "Overseer 예약 항목을 제외한 사용자 Label을 확인합니다.",
      label: "Label",
    },
    network: {
      description: "포트, Docker 네트워크와 Volume 연결을 확인합니다.",
      label: "연결",
    },
    overview: {
      description: "컨테이너 상태와 식별 정보, Compose 소속을 확인합니다.",
      label: "개요",
    },
    runtime: {
      description: "이미지, 명령, 실행 정책과 리소스 제한을 확인합니다.",
      label: "실행 설정",
    },
  };
const sectionOrder: ContainerDetailSection[] = [
  "overview",
  "runtime",
  "network",
  "environment",
  "labels",
];

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
    return { label: "Bind mount", sourceLabel: "Lima 호스트 경로", source: mount.hostPath };
  }
  if (mount.type === "volume") {
    return { label: "Named volume", sourceLabel: "Volume", source: mount.volume };
  }
  return {
    label: `${mount.dockerType} mount`,
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

export function ContainerDetailPage({
  id,
  onOpenCompose,
  refreshToken,
  summary,
}: ContainerDetailPageProps) {
  const [detail, setDetail] = useState<ContainerDetail>();
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<ContainerDetailSection>("overview");

  useEffect(() => setSection("overview"), [id]);

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
      <div className="overseer-detail-layout">
        <aside className="overseer-detail-sidebar">
          <nav aria-label="컨테이너 상세 메뉴">
            <div
              aria-labelledby="overseer-container-detail-navigation"
              className="overseer-detail-nav-group"
              role="group"
            >
              <span className="overseer-detail-nav-label" id="overseer-container-detail-navigation">
                컨테이너
              </span>
              <div className="overseer-detail-nav-items">
                {sectionOrder.map((value) => {
                  const item = sectionPresentation[value];
                  return (
                    <button
                      aria-current={section === value ? "page" : undefined}
                      key={value}
                      onClick={() => setSection(value)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>
        </aside>

        <div className="overseer-detail-content">
          <header className="overseer-detail-content-header">
            <p>컨테이너</p>
            <h2 className="city-text-section-title">{presentation.label}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

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
                          onClick={(event) =>
                            followComposeLink(event, composeProject, onOpenCompose)
                          }
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
            <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
              <Definition label="이미지" value={<code>{spec.image}</code>} />
              <Definition label="Hostname" value={spec.hostname ?? "—"} />
              <Definition label="재시작 정책" value={<code>{restartPolicy(detail)}</code>} />
              <Definition label="CPU" value={spec.resources.cpus ?? "제한 없음"} />
              <Definition
                label="메모리"
                value={
                  spec.resources.memoryMiB === undefined
                    ? "제한 없음"
                    : `${spec.resources.memoryMiB} MiB`
                }
              />
              <Definition
                label="명령"
                value={
                  spec.command.length > 0 ? <code>{spec.command.join(" ")}</code> : "지정되지 않음"
                }
              />
            </dl>
          ) : null}

          {section === "network" ? (
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
          ) : null}

          {section === "environment" ? (
            <KeyValues empty="환경 변수가 없습니다." values={spec.environment} />
          ) : null}

          {section === "labels" ? (
            <KeyValues empty="사용자 label이 없습니다." values={spec.labels} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
