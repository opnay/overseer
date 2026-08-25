import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Pagination } from "@opnay/city-ds-react/pagination";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  ContainerKeyValue,
  ImageDetail,
  ImageHistoryEntry,
  ImageRepositoryTags,
  ImageSummary,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { formatDateTime } from "./date-time.ts";
import { reconstructDockerfileLayers } from "./image-history-presentation.ts";
import { LogViewer } from "./log-display-options.tsx";

interface ImageDetailPageProps {
  id: string;
  refreshToken: string;
  summary?: ImageSummary;
}

type ImageDetailSection =
  | "configuration"
  | "environment"
  | "inspect"
  | "labels"
  | "layers"
  | "overview"
  | "tags";

const sectionPresentation: Record<ImageDetailSection, { description: string; label: string }> = {
  configuration: {
    description: "이미지의 기본 실행 명령과 공개 포트를 확인합니다.",
    label: "실행 설정",
  },
  environment: {
    description: "이미지에 기본값으로 저장된 환경 변수를 확인합니다.",
    label: "환경 변수",
  },
  inspect: {
    description: "Docker Engine이 반환한 전체 이미지 원본 JSON을 확인합니다.",
    label: "원본 정보",
  },
  labels: {
    description: "이미지 제작자가 저장한 OCI·Docker 라벨을 확인합니다.",
    label: "라벨",
  },
  layers: {
    description: "이미지 기록을 빌드 순서의 Dockerfile 코드로 재구성합니다.",
    label: "레이어",
  },
  overview: {
    description: "이미지의 참조 URL과 식별자, 플랫폼 정보를 확인합니다.",
    label: "개요",
  },
  tags: {
    description: "공개 Docker Hub 저장소에서 최근 태그와 지원 플랫폼을 확인합니다.",
    label: "저장소 태그",
  },
};

const sectionOrder: ImageDetailSection[] = [
  "overview",
  "tags",
  "configuration",
  "environment",
  "labels",
  "layers",
  "inspect",
];

const tagPaginationLabels = {
  first: "첫 페이지",
  last: "마지막 페이지",
  navigation: "저장소 태그 페이지",
  next: "다음 페이지",
  nextGroup: (count: number) => `다음 ${count}개 페이지`,
  page: (page: number) => `${page}페이지`,
  previous: "이전 페이지",
  previousGroup: (count: number) => `이전 ${count}개 페이지`,
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1_000 && unit < units.length - 1) {
    size /= 1_000;
    unit += 1;
  }
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}

function Definition({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function CodeValues({ empty, values }: { empty: string; values: string[] }) {
  return values.length > 0
    ? values.map((value, index) => <code key={`${index}-${value}`}>{value}</code>)
    : empty;
}

function safeExternalUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function dockerHubUrl(summary?: ImageSummary): string | undefined {
  if (!summary?.url.startsWith("docker.io/")) return undefined;
  const reference = summary.url.slice("docker.io/".length).split("@", 1)[0] ?? "";
  const lastSlash = reference.lastIndexOf("/");
  const lastColon = reference.lastIndexOf(":");
  const repository = lastColon > lastSlash ? reference.slice(0, lastColon) : reference;
  if (!repository) return undefined;
  return repository.startsWith("library/")
    ? `https://hub.docker.com/_/${repository.slice("library/".length)}`
    : `https://hub.docker.com/r/${repository}`;
}

function externalLinks(summary: ImageSummary | undefined, labels: ContainerKeyValue[]) {
  const links: Array<{ href: string; label: string }> = [];
  const dockerHub = dockerHubUrl(summary);
  if (dockerHub) links.push({ href: dockerHub, label: "Docker Hub" });

  const labelPresentation = new Map([
    ["org.opencontainers.image.source", "소스 저장소"],
    ["org.opencontainers.image.url", "프로젝트 페이지"],
    ["org.opencontainers.image.documentation", "문서"],
  ]);
  for (const { key, value } of labels) {
    const fallbackLabel = labelPresentation.get(key);
    if (!fallbackLabel) continue;
    const url = safeExternalUrl(value);
    if (!url || links.some(({ href }) => href === url.href)) continue;
    links.push({
      href: url.href,
      label:
        key === "org.opencontainers.image.source" && url.hostname === "github.com"
          ? "GitHub 저장소"
          : fallbackLabel,
    });
  }
  return links;
}

export function ImageDetailPage({ id, refreshToken, summary }: ImageDetailPageProps) {
  const [detail, setDetail] = useState<ImageDetail>();
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<ImageHistoryEntry[]>();
  const [historyError, setHistoryError] = useState<string>();
  const [repositoryTags, setRepositoryTags] = useState<ImageRepositoryTags>();
  const [section, setSection] = useState<ImageDetailSection>("overview");
  const [tagError, setTagError] = useState<string>();
  const [tagPage, setTagPage] = useState(1);

  useEffect(() => {
    setHistory(undefined);
    setRepositoryTags(undefined);
    setSection("overview");
    setTagPage(1);
  }, [id]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiRequest<{ image: ImageDetail }>(`/images/${encodeURIComponent(id)}`)
      .then(({ image }) => active && setDetail(image))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error ? loadError.message : "이미지 상세를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [id, refreshToken]);

  useEffect(() => {
    if (section !== "layers") return;
    let active = true;
    setHistory(undefined);
    setHistoryError(undefined);
    void apiRequest<{ history: ImageHistoryEntry[] }>(`/images/${encodeURIComponent(id)}/history`)
      .then(({ history: nextHistory }) => active && setHistory(nextHistory))
      .catch(
        (loadError: unknown) =>
          active &&
          setHistoryError(
            loadError instanceof Error
              ? loadError.message
              : "이미지 레이어 기록을 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [id, refreshToken, section]);

  useEffect(() => {
    if (section !== "tags") return;
    let active = true;
    setRepositoryTags(undefined);
    setTagError(undefined);
    void apiRequest<{ tags: ImageRepositoryTags }>(
      `/images/${encodeURIComponent(id)}/tags?page=${tagPage}`,
    )
      .then(({ tags }) => active && setRepositoryTags(tags))
      .catch(
        (loadError: unknown) =>
          active &&
          setTagError(
            loadError instanceof Error
              ? loadError.message
              : "Docker Hub 태그 목록을 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [id, refreshToken, section, tagPage]);

  if (error) {
    return (
      <Alert.Root appearance="subtle" tone="destructive">
        <Alert.Title level={2}>이미지 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!detail) {
    return (
      <section aria-label="이미지 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const presentation = sectionPresentation[section];
  const referenceUrl = summary?.url ?? detail.repositoryTags[0] ?? "—";
  const links = externalLinks(summary, detail.labels);

  return (
    <article className="overseer-detail-page">
      <div className="overseer-detail-layout">
        <aside className="overseer-detail-sidebar">
          <nav aria-label="이미지 상세 메뉴">
            <div
              aria-labelledby="overseer-image-detail-navigation"
              className="overseer-detail-nav-group"
              role="group"
            >
              <span className="overseer-detail-nav-label" id="overseer-image-detail-navigation">
                이미지
              </span>
              <div className="overseer-detail-nav-items">
                {sectionOrder.map((value) => (
                  <button
                    aria-current={section === value ? "page" : undefined}
                    key={value}
                    onClick={() => setSection(value)}
                    type="button"
                  >
                    {sectionPresentation[value].label}
                  </button>
                ))}
              </div>
            </div>
          </nav>
        </aside>

        <div className="overseer-detail-content">
          <header className="overseer-detail-content-header">
            <p>이미지</p>
            <h2 className="city-text-section-title">{presentation.label}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

          {section === "overview" ? (
            <>
              <section aria-label="이미지 개요" className="overseer-detail-summary">
                <div>
                  <span>크기</span>
                  <strong>{summary?.size ?? formatBytes(detail.sizeBytes)}</strong>
                </div>
                <div>
                  <span>생성</span>
                  <strong>
                    <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
                  </strong>
                </div>
                <div>
                  <span>플랫폼</span>
                  <strong>
                    {detail.operatingSystem}/{detail.architecture}
                  </strong>
                </div>
              </section>

              {links.length > 0 ? (
                <section className="overseer-detail-section">
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">관련 링크</h3>
                    </div>
                  </header>
                  <nav aria-label="이미지 관련 링크" className="overseer-detail-external-links">
                    {links.map(({ href, label }) => (
                      <Button
                        key={href}
                        nativeButton={false}
                        render={<a href={href} rel="noreferrer" target="_blank" />}
                        size="sm"
                        variant="outline"
                      >
                        <ExternalLink aria-hidden="true" size={14} />
                        {label}
                      </Button>
                    ))}
                  </nav>
                </section>
              ) : null}

              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">식별 정보</h3>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition label="참조 URL" value={<code>{referenceUrl}</code>} />
                  <Definition label="이미지 ID" value={<code>{detail.id}</code>} />
                  <Definition
                    label="저장소·태그"
                    value={<CodeValues empty="태그 없음" values={detail.repositoryTags} />}
                  />
                  <Definition
                    label="Digest"
                    value={<CodeValues empty="Digest 없음" values={detail.repositoryDigests} />}
                  />
                </dl>
              </section>
            </>
          ) : null}

          {section === "tags" ? (
            tagError ? (
              <Alert.Root appearance="subtle" tone="destructive">
                <Alert.Title level={3}>저장소 태그를 불러오지 못했습니다.</Alert.Title>
                <Alert.Description>{tagError}</Alert.Description>
              </Alert.Root>
            ) : !repositoryTags ? (
              <section aria-label="저장소 태그 불러오는 중" className="overseer-detail-loading">
                <Skeleton />
                <Skeleton className="overseer-loading-table" />
              </section>
            ) : (
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">{repositoryTags.repository}</h3>
                    <p className="city-text-supporting">총 {repositoryTags.count}개 태그</p>
                  </div>
                </header>
                <DataTableRegion
                  hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
                  label={`${repositoryTags.repository} 태그 표`}
                >
                  <Table.Root
                    aria-label={`${repositoryTags.repository} 태그 목록`}
                    className="overseer-table overseer-table--image-tags"
                    size="sm"
                  >
                    <Table.Caption className="overseer-table-caption">
                      Docker Hub 공개 저장소의 최근 업데이트 태그
                    </Table.Caption>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head className="overseer-table-column-wide">태그</Table.Head>
                        <Table.Head>플랫폼</Table.Head>
                        <Table.Head>크기</Table.Head>
                        <Table.Head>업데이트</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {repositoryTags.tags.length > 0 ? (
                        repositoryTags.tags.map((tag) => (
                          <Table.Row key={tag.name}>
                            <Table.Cell className="overseer-table-column-wide">
                              <strong>{tag.name}</strong>
                            </Table.Cell>
                            <Table.Cell>
                              <code>{tag.platforms.join(" · ") || "—"}</code>
                            </Table.Cell>
                            <Table.Cell>{formatBytes(tag.sizeBytes)}</Table.Cell>
                            <Table.Cell>
                              <time dateTime={tag.lastUpdated}>
                                {formatDateTime(tag.lastUpdated)}
                              </time>
                            </Table.Cell>
                          </Table.Row>
                        ))
                      ) : (
                        <Table.StateRow colSpan={4}>
                          <EmptyState.Root density="compact">
                            <EmptyState.Title level={3}>표시할 태그가 없습니다.</EmptyState.Title>
                            <EmptyState.Description>
                              이 페이지에는 공개 태그가 없습니다.
                            </EmptyState.Description>
                          </EmptyState.Root>
                        </Table.StateRow>
                      )}
                    </Table.Body>
                  </Table.Root>
                </DataTableRegion>
                {repositoryTags.count > repositoryTags.pageSize ? (
                  <Pagination.Root
                    density="compact"
                    labels={tagPaginationLabels}
                    onPageChange={setTagPage}
                    page={repositoryTags.page}
                    totalPages={Math.ceil(repositoryTags.count / repositoryTags.pageSize)}
                  />
                ) : null}
              </section>
            )
          ) : null}

          {section === "configuration" ? (
            <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
              <Definition
                label="작업 디렉터리"
                value={detail.workingDirectory ?? "지정되지 않음"}
              />
              <Definition
                label="Entrypoint"
                value={<CodeValues empty="지정되지 않음" values={detail.entrypoint} />}
              />
              <Definition
                label="명령"
                value={<CodeValues empty="지정되지 않음" values={detail.command} />}
              />
              <Definition
                label="공개 포트"
                value={<CodeValues empty="없음" values={detail.exposedPorts} />}
              />
              <Definition label="레이어" value={`${detail.layers.length}개`} />
              <Definition label="빌드 설명" value={detail.comment ?? "—"} />
            </dl>
          ) : null}

          {section === "environment" ? (
            <KeyValues empty="환경 변수가 없습니다." values={detail.environment} />
          ) : null}

          {section === "labels" ? (
            <KeyValues empty="라벨이 없습니다." values={detail.labels} />
          ) : null}

          {section === "layers" ? (
            historyError ? (
              <Alert.Root appearance="subtle" tone="destructive">
                <Alert.Title level={3}>레이어 기록을 불러오지 못했습니다.</Alert.Title>
                <Alert.Description>{historyError}</Alert.Description>
              </Alert.Root>
            ) : !history ? (
              <section
                aria-label="이미지 레이어 기록 불러오는 중"
                className="overseer-detail-loading"
              >
                <Skeleton />
                <Skeleton className="overseer-loading-table" />
              </section>
            ) : (
              <LogViewer
                ariaLabel="Dockerfile 레이어 코드"
                context={
                  <>
                    <code>Dockerfile</code>
                    <span>{history.length}개 레이어 · 빌드 순서 · history 재구성</span>
                  </>
                }
                emptyMessage="레이어 기록이 없습니다."
                height="expanded"
                optionsLabel="코드 보기 옵션"
                value={reconstructDockerfileLayers(history)}
              />
            )
          ) : null}

          {section === "inspect" ? (
            <LogViewer
              ariaLabel="이미지 원본 JSON"
              context={<code>docker image inspect {detail.id.slice(0, 12)}</code>}
              emptyMessage="원본 정보가 없습니다."
              height="expanded"
              optionsLabel="원본 JSON 보기 옵션"
              value={detail.inspectJson}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
