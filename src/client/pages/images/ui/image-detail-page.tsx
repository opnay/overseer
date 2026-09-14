import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  ContainerKeyValue,
  ImageDetail,
  ImageHistoryEntry,
  ImageSummary,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { useUrlSection } from "@/shared/lib/url-section";
import { LogViewer } from "@/shared/ui/log-viewer";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";
import { reconstructDockerfileLayers } from "../lib/image-history-presentation.ts";

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
  | "overview";

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
};

const sectionOrder: ImageDetailSection[] = [
  "overview",
  "configuration",
  "environment",
  "labels",
  "layers",
  "inspect",
];

const imageDetailNavigation = [
  {
    items: sectionOrder.map((value) => ({ label: sectionPresentation[value].label, value })),
    label: "이미지",
  },
];

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
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: "overview",
    locationKey: id,
    values: sectionOrder,
  });

  useEffect(() => {
    setHistory(undefined);
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
      <SectionedWorkspace<ImageDetailSection>
        category="이미지"
        description={presentation.description}
        getSectionHref={getSectionHref}
        groups={imageDetailNavigation}
        navigationLabel="이미지 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.label}
      >
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
                <Definition label="이미지 ID" value={<code>{detail.id}</code>} wide />
                <Definition
                  label="저장소·태그"
                  value={<CodeValues empty="태그 없음" values={detail.repositoryTags} />}
                />
                <Definition
                  label="Digest"
                  value={<CodeValues empty="Digest 없음" values={detail.repositoryDigests} />}
                  wide
                />
              </dl>
            </section>
          </>
        ) : null}

        {section === "configuration" ? (
          <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
            <Definition label="작업 디렉터리" value={detail.workingDirectory ?? "지정되지 않음"} />
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
      </SectionedWorkspace>
    </article>
  );
}
