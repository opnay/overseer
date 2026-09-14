import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Boxes } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import type { ComposeBuilderInput, ComposeProjectDetail } from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { BuilderComposeDialog } from "./builder-compose-dialog.tsx";
import { formatDateTime } from "@/shared/lib/date-time";
import { useUrlSection } from "@/shared/lib/url-section";
import { LogViewer } from "@/shared/ui/log-viewer";
import { containerDetailPath } from "@/shared/routes";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";

interface ComposeProjectDetailPageProps {
  busy: boolean;
  name: string;
  onBuilderUpdate(input: ComposeBuilderInput, expectedConfigHash: string): Promise<void>;
  onOpenContainer(id: string): void;
  onRemoteCheck(): Promise<void>;
  onRemoteUpdate(): Promise<void>;
  refreshToken: string;
}

type ComposeDetailSection = "configuration" | "form" | "logs" | "overview" | "services" | "updates";
const sectionOrder: ComposeDetailSection[] = [
  "overview",
  "services",
  "configuration",
  "logs",
  "updates",
  "form",
];

const sectionPresentation: Record<ComposeDetailSection, { description: string; label: string }> = {
  configuration: {
    description: "현재 적용되는 Compose 원본과 YAML을 확인합니다.",
    label: "구성",
  },
  form: {
    description: "직접 작성하여 관리하는 Compose 구성을 확인하고 편집합니다.",
    label: "작성 설정",
  },
  logs: {
    description: "프로젝트 전체 서비스의 최근 로그를 확인합니다.",
    label: "로그",
  },
  overview: {
    description: "프로젝트 상태와 등록 방식, 서비스 수를 확인합니다.",
    label: "개요",
  },
  services: {
    description: "서비스별 컨테이너 상태를 확인하고 컨테이너 상세로 이동합니다.",
    label: "서비스",
  },
  updates: {
    description: "URL 원본의 확인 상태와 적용 대기 중인 변경을 관리합니다.",
    label: "업데이트",
  },
};

function statusLabel(status: string): string {
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

function followContainerLink(
  event: MouseEvent<HTMLAnchorElement>,
  id: string,
  onOpenContainer: (id: string) => void,
) {
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onOpenContainer(id);
}

export function ComposeProjectDetailPage({
  busy,
  name,
  onBuilderUpdate,
  onOpenContainer,
  onRemoteCheck,
  onRemoteUpdate,
  refreshToken,
}: ComposeProjectDetailPageProps) {
  const [detail, setDetail] = useState<ComposeProjectDetail>();
  const [error, setError] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [logs, setLogs] = useState<string>();
  const [logsError, setLogsError] = useState<string>();
  const [logsLoading, setLogsLoading] = useState(false);
  const [requestedSection, setSection, getSectionHref] = useUrlSection({
    defaultValue: "overview",
    locationKey: name,
    values: sectionOrder,
  });
  const section =
    (requestedSection === "updates" && detail?.configuration.kind !== "remote") ||
    (requestedSection === "form" && detail?.configuration.kind !== "builder")
      ? "overview"
      : requestedSection;

  useEffect(() => {
    if (detail && section !== requestedSection) setSection(section);
  }, [detail, requestedSection, section, setSection]);

  useEffect(() => {
    if (section !== "logs") return;
    let active = true;
    setLogsLoading(true);
    setLogsError(undefined);
    void apiRequest<{ logs: string }>(`/compose/projects/${encodeURIComponent(name)}/logs`)
      .then(({ logs: nextLogs }) => active && setLogs(nextLogs))
      .catch(
        (loadError: unknown) =>
          active &&
          setLogsError(
            loadError instanceof Error ? loadError.message : "Compose 로그를 불러오지 못했습니다.",
          ),
      )
      .finally(() => active && setLogsLoading(false));
    return () => {
      active = false;
    };
  }, [name, refreshToken, section]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiRequest<{ project: ComposeProjectDetail }>(
      `/compose/projects/${encodeURIComponent(name)}`,
    )
      .then(({ project }) => active && setDetail(project))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Compose 프로젝트 상세를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [name, refreshToken]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>Compose 프로젝트 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!detail) {
    return (
      <section aria-label="Compose 프로젝트 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const running = detail.status.startsWith("running");
  const source = detail.remote
    ? "URL Compose"
    : detail.builder?.mode === "yaml"
      ? "YAML 작성"
      : detail.builder
        ? "폼 작성"
        : "Docker Compose";
  const sourceReference = detail.remote?.url ?? detail.configFiles.join(" · ");
  const sections: Array<{ label: string; value: ComposeDetailSection }> = [
    { label: "개요", value: "overview" },
    { label: "서비스", value: "services" },
    { label: "구성", value: "configuration" },
    { label: "로그", value: "logs" },
    ...(detail.configuration.kind === "remote"
      ? [{ label: "업데이트", value: "updates" as const }]
      : []),
    ...(detail.configuration.kind === "builder"
      ? [{ label: "작성 설정", value: "form" as const }]
      : []),
  ];
  const presentation = sectionPresentation[section];

  return (
    <article className="overseer-detail-page">
      <SectionedWorkspace<ComposeDetailSection>
        category="Compose 프로젝트"
        description={presentation.description}
        getSectionHref={getSectionHref}
        groups={[{ items: sections, label: "Compose 프로젝트" }]}
        navigationLabel="Compose 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.label}
      >
        {section === "overview" ? (
          <section aria-label="Compose 프로젝트 개요" className="overseer-detail-summary">
            <div>
              <span>상태</span>
              <strong className="overseer-settings-status-value">
                <Badge dot size="sm" tone={running ? "success" : "neutral"} />
                {statusLabel(detail.status)}
              </strong>
            </div>
            <div>
              <span>등록 방식</span>
              <strong>{source}</strong>
            </div>
            <div>
              <span>서비스</span>
              <strong>{detail.services.length}개</strong>
            </div>
          </section>
        ) : null}

        {section === "services" ? (
          <section className="overseer-detail-section">
            <DataTableRegion
              hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
              label={`${detail.name} 서비스 컨테이너 표`}
            >
              <Table.Root
                aria-label={`${detail.name} 서비스 컨테이너 목록`}
                className="overseer-table overseer-table--compose-services"
                size="sm"
              >
                <Table.Caption className="overseer-table-caption">
                  {detail.name} Compose 서비스 컨테이너
                </Table.Caption>
                <Table.Header>
                  <Table.Row>
                    <Table.Head className="overseer-table-column-wide">서비스</Table.Head>
                    <Table.Head>상태</Table.Head>
                    <Table.Head>포트</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {detail.services.length === 0 ? (
                    <Table.StateRow colSpan={3}>
                      <EmptyState.Root className="overseer-table-empty-state" density="compact">
                        <EmptyState.Icon>
                          <Boxes aria-hidden="true" />
                        </EmptyState.Icon>
                        <EmptyState.Title level={3}>서비스 컨테이너가 없습니다.</EmptyState.Title>
                        <EmptyState.Description>
                          프로젝트를 실행하면 생성된 컨테이너가 여기에 표시됩니다.
                        </EmptyState.Description>
                      </EmptyState.Root>
                    </Table.StateRow>
                  ) : (
                    detail.services.map((service) => {
                      const serviceRunning = service.state === "running";
                      return (
                        <Table.Row key={service.id || service.name}>
                          <Table.Cell className="overseer-table-column-wide">
                            <div className="overseer-primary-cell">
                              <strong>{service.service}</strong>
                              <div className="overseer-primary-meta">
                                {service.id ? (
                                  <a
                                    className="overseer-detail-link"
                                    href={containerDetailPath(service.id)}
                                    onClick={(event) =>
                                      followContainerLink(event, service.id, onOpenContainer)
                                    }
                                  >
                                    {service.name}
                                  </a>
                                ) : (
                                  <span>{service.name || "—"}</span>
                                )}
                                <code>{service.image}</code>
                              </div>
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="overseer-container-status">
                              <Badge
                                aria-label={serviceRunning ? "실행 중" : "중지됨"}
                                dot
                                size="sm"
                                tone={serviceRunning ? "success" : "neutral"}
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
          </section>
        ) : null}

        {section === "configuration" ? (
          <section className="overseer-detail-section">
            <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
              <div>
                <dt>등록 방식</dt>
                <dd>{source}</dd>
              </div>
              <div>
                <dt>원본</dt>
                <dd>
                  <code>{sourceReference}</code>
                </dd>
              </div>
            </dl>
            {detail.configuration.kind === "discovered" ? (
              <div className="overseer-detail-file-list">
                {detail.configuration.configFiles.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            ) : (
              <pre className="overseer-detail-yaml">
                <code>{detail.configuration.yaml}</code>
              </pre>
            )}
          </section>
        ) : null}

        {section === "logs" ? (
          <section className="overseer-detail-section">
            {logsError ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={3}>Compose 로그를 불러오지 못했습니다.</Alert.Title>
                <Alert.Description>{logsError}</Alert.Description>
              </Alert.Root>
            ) : logsLoading ? (
              <Skeleton className="overseer-loading-table" />
            ) : logs ? (
              <LogViewer ariaLabel={`${name} Compose 로그`} key={name} value={logs} />
            ) : (
              <EmptyState.Root density="compact">
                <EmptyState.Title level={3}>표시할 로그가 없습니다.</EmptyState.Title>
                <EmptyState.Description>
                  서비스가 로그를 출력하면 최근 300줄이 여기에 표시됩니다.
                </EmptyState.Description>
              </EmptyState.Root>
            )}
          </section>
        ) : null}

        {section === "updates" && detail.configuration.kind === "remote" ? (
          <section className="overseer-detail-section">
            {detail.configuration.checkError ? (
              <Alert.Root appearance="subtle" tone="destructive">
                <Alert.Title level={3}>최근 업데이트 확인이 실패했습니다.</Alert.Title>
                <Alert.Description>{detail.configuration.checkError}</Alert.Description>
              </Alert.Root>
            ) : null}
            <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
              <div>
                <dt>원본 URL</dt>
                <dd>
                  <code>{detail.configuration.url}</code>
                </dd>
              </div>
              <div>
                <dt>최근 확인</dt>
                <dd>
                  <time dateTime={detail.configuration.checkedAt}>
                    {formatDateTime(detail.configuration.checkedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>현재 hash</dt>
                <dd>
                  <code>{detail.configuration.contentHash}</code>
                </dd>
              </div>
              <div>
                <dt>대기 hash</dt>
                <dd>
                  <code>{detail.configuration.pendingHash ?? "—"}</code>
                </dd>
              </div>
            </dl>
            {detail.configuration.pendingYaml ? (
              <>
                <h3 className="city-text-subsection-title">적용 대기 YAML</h3>
                <pre className="overseer-detail-yaml">
                  <code>{detail.configuration.pendingYaml}</code>
                </pre>
              </>
            ) : (
              <Alert.Root appearance="subtle" tone="neutral">
                <Alert.Title level={3}>적용할 업데이트가 없습니다.</Alert.Title>
              </Alert.Root>
            )}
            <div className="overseer-detail-actions">
              <Button
                disabled={busy}
                onClick={() => void onRemoteCheck().catch(() => undefined)}
                variant="outline"
              >
                업데이트 확인
              </Button>
              <Button
                disabled={busy || !detail.remote?.updateAvailable}
                onClick={() => void onRemoteUpdate().catch(() => undefined)}
              >
                업데이트 적용
              </Button>
            </div>
          </section>
        ) : null}

        {section === "form" && detail.configuration.kind === "builder" ? (
          <section className="overseer-detail-section">
            <dl className="overseer-detail-definitions">
              <div>
                <dt>구성 해시</dt>
                <dd>
                  <code>{detail.configuration.configHash}</code>
                </dd>
              </div>
            </dl>
            <pre className="overseer-detail-yaml">
              <code>{detail.configuration.yaml}</code>
            </pre>
            <div className="overseer-detail-actions">
              <Button disabled={busy} onClick={() => setEditOpen(true)}>
                구성 편집
              </Button>
            </div>
          </section>
        ) : null}
      </SectionedWorkspace>
      <BuilderComposeDialog
        onOpenChange={setEditOpen}
        onSubmit={(input, expectedConfigHash) => {
          if (!expectedConfigHash) throw new Error("Compose config hash를 찾을 수 없습니다.");
          return onBuilderUpdate(input, expectedConfigHash);
        }}
        open={editOpen}
        projectName={detail.configuration.kind === "builder" ? detail.name : undefined}
      />
    </article>
  );
}
