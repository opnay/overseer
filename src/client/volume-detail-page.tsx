import { Alert } from "@opnay/city-ds-react/alert";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { useEffect, useState, type ReactNode } from "react";
import type { ContainerKeyValue, VolumeDetail } from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { formatDateTime } from "./date-time.ts";
import { LogViewer } from "./log-display-options.tsx";

interface VolumeDetailPageProps {
  name: string;
  refreshToken: string;
}

type VolumeDetailSection = "inspect" | "labels" | "overview" | "settings";

const sectionPresentation: Record<VolumeDetailSection, { description: string; label: string }> = {
  inspect: {
    description: "Docker Engine이 반환한 전체 볼륨 inspect JSON을 확인합니다.",
    label: "Inspect",
  },
  labels: {
    description: "볼륨에 저장된 Docker Label을 확인합니다.",
    label: "Label",
  },
  overview: {
    description: "볼륨의 식별자, 드라이버와 데이터 저장 위치를 확인합니다.",
    label: "개요",
  },
  settings: {
    description: "볼륨 드라이버에 전달된 생성 옵션을 확인합니다.",
    label: "드라이버 설정",
  },
};

const sectionOrder: VolumeDetailSection[] = ["overview", "settings", "labels", "inspect"];

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

export function VolumeDetailPage({ name, refreshToken }: VolumeDetailPageProps) {
  const [detail, setDetail] = useState<VolumeDetail>();
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<VolumeDetailSection>("overview");

  useEffect(() => setSection("overview"), [name]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiRequest<{ volume: VolumeDetail }>(`/volumes/${encodeURIComponent(name)}`)
      .then(({ volume }) => active && setDetail(volume))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error ? loadError.message : "볼륨 상세를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [name, refreshToken]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>볼륨 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!detail) {
    return (
      <section aria-label="볼륨 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const presentation = sectionPresentation[section];

  return (
    <article className="overseer-detail-page">
      <div className="overseer-detail-layout">
        <aside className="overseer-detail-sidebar">
          <nav aria-label="볼륨 상세 메뉴">
            <div
              aria-labelledby="overseer-volume-detail-navigation"
              className="overseer-detail-nav-group"
              role="group"
            >
              <span className="overseer-detail-nav-label" id="overseer-volume-detail-navigation">
                볼륨
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
            <p>볼륨</p>
            <h2 className="city-text-section-title">{presentation.label}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

          {section === "overview" ? (
            <>
              <section aria-label="볼륨 개요" className="overseer-detail-summary">
                <div>
                  <span>드라이버</span>
                  <strong>{detail.driver}</strong>
                </div>
                <div>
                  <span>범위</span>
                  <strong>{detail.scope}</strong>
                </div>
                <div>
                  <span>생성</span>
                  <strong>
                    {detail.createdAt ? (
                      <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">식별 및 저장 정보</h3>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition label="이름" value={detail.name} />
                  <Definition label="Mountpoint" value={<code>{detail.mountpoint}</code>} />
                </dl>
              </section>
            </>
          ) : null}

          {section === "settings" ? (
            <KeyValues empty="드라이버 옵션이 없습니다." values={detail.options} />
          ) : null}

          {section === "labels" ? (
            <KeyValues empty="Label이 없습니다." values={detail.labels} />
          ) : null}

          {section === "inspect" ? (
            <LogViewer
              ariaLabel="볼륨 Inspect JSON"
              context={<code>docker volume inspect {detail.name}</code>}
              emptyMessage="Inspect 정보가 없습니다."
              height="expanded"
              optionsLabel="Inspect JSON 보기 옵션"
              value={detail.inspectJson}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
