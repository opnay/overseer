import { Alert } from "@opnay/city-ds-react/alert";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { useEffect, useState, type ReactNode } from "react";
import type { ContainerKeyValue, VolumeDetail } from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { LogViewer } from "@/shared/ui/log-viewer";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";

interface VolumeDetailPageProps {
  name: string;
  refreshToken: string;
}

type VolumeDetailSection = "inspect" | "labels" | "overview" | "settings";

const sectionPresentation: Record<VolumeDetailSection, { description: string; label: string }> = {
  inspect: {
    description: "Docker Engine이 반환한 전체 볼륨 원본 JSON을 확인합니다.",
    label: "원본 정보",
  },
  labels: {
    description: "볼륨에 저장된 Docker 라벨을 확인합니다.",
    label: "라벨",
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

const volumeDetailNavigation = [
  {
    items: sectionOrder.map((value) => ({ label: sectionPresentation[value].label, value })),
    label: "볼륨",
  },
];

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
      <SectionedWorkspace<VolumeDetailSection>
        category="볼륨"
        description={presentation.description}
        groups={volumeDetailNavigation}
        navigationLabel="볼륨 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.label}
      >
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
          <KeyValues empty="라벨이 없습니다." values={detail.labels} />
        ) : null}

        {section === "inspect" ? (
          <LogViewer
            ariaLabel="볼륨 원본 JSON"
            context={<code>docker volume inspect {detail.name}</code>}
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
