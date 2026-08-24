import { Alert } from "@opnay/city-ds-react/alert";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { useEffect, useState, type ReactNode } from "react";
import type { ContainerKeyValue, ImageDetail, ImageSummary } from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";

interface ImageDetailPageProps {
  id: string;
  refreshToken: string;
  summary?: ImageSummary;
}

type ImageDetailSection = "configuration" | "environment" | "labels" | "layers" | "overview";

const sectionPresentation: Record<ImageDetailSection, { description: string; label: string }> = {
  configuration: {
    description: "이미지의 기본 실행 명령과 공개 포트를 확인합니다.",
    label: "실행 설정",
  },
  environment: {
    description: "이미지에 기본값으로 저장된 환경 변수를 확인합니다.",
    label: "환경 변수",
  },
  labels: {
    description: "이미지 제작자가 저장한 OCI·Docker Label을 확인합니다.",
    label: "Label",
  },
  layers: {
    description: "이미지를 구성하는 파일 시스템 레이어를 순서대로 확인합니다.",
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
];

const createdAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : createdAtFormatter.format(date);
}

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

export function ImageDetailPage({ id, refreshToken, summary }: ImageDetailPageProps) {
  const [detail, setDetail] = useState<ImageDetail>();
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<ImageDetailSection>("overview");

  useEffect(() => setSection("overview"), [id]);

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
                    <time dateTime={detail.createdAt}>{formatCreatedAt(detail.createdAt)}</time>
                  </strong>
                </div>
                <div>
                  <span>플랫폼</span>
                  <strong>
                    {detail.operatingSystem}/{detail.architecture}
                  </strong>
                </div>
              </section>

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
            <KeyValues empty="Label이 없습니다." values={detail.labels} />
          ) : null}

          {section === "layers" ? (
            detail.layers.length > 0 ? (
              <ol className="overseer-detail-layer-list">
                {detail.layers.map((layer) => (
                  <li key={layer}>
                    <code>{layer}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="overseer-detail-empty-copy">레이어 정보가 없습니다.</p>
            )
          ) : null}
        </div>
      </div>
    </article>
  );
}
