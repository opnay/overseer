import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { CircleStop, Play, ServerCog, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { RuntimeInstanceSummary, RuntimeInstancesSnapshot } from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { RuntimeInstanceActions } from "./runtime-instance-actions.tsx";
import type { RuntimeInstanceMutationProps } from "./runtime-instances-page.tsx";

type InstanceDetailSection = "connection" | "overview" | "settings";

const sectionPresentation: Record<InstanceDetailSection, { description: string; label: string }> = {
  connection: {
    description: "Overseer와 Docker가 이 VM을 사용하는 방식을 확인합니다.",
    label: "Docker 연결",
  },
  overview: {
    description: "VM 상태와 컨테이너 사용량을 확인합니다.",
    label: "개요",
  },
  settings: {
    description: "가상화 드라이버와 할당된 VM 리소스를 확인합니다.",
    label: "VM 설정",
  },
};

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

function containers(instance: RuntimeInstanceSummary): string {
  if (!instance.containerCount) return "확인 불가";
  return `${instance.containerCount.running}개 실행 중 · 전체 ${instance.containerCount.total}개`;
}

function vmType(instance: RuntimeInstanceSummary): string {
  if (instance.configuration?.vmType === "vz") return "Apple Virtualization (VZ)";
  if (instance.configuration?.vmType === "qemu") return "QEMU";
  return "확인 불가";
}

export function RuntimeInstanceDetailPage({
  busy,
  name,
  onDelete,
  onPrepare,
  onSelect,
  onStart,
  onStop,
  onUpdate,
  refreshToken,
}: Omit<RuntimeInstanceMutationProps, "onCreate"> & { name: string }) {
  const [snapshot, setSnapshot] = useState<RuntimeInstancesSnapshot>();
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<InstanceDetailSection>("overview");

  useEffect(() => setSection("overview"), [name]);

  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    setError(undefined);
    void apiRequest<RuntimeInstancesSnapshot>("/runtime/instances")
      .then((next) => active && setSnapshot(next))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error ? loadError.message : "VM 인스턴스를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [name, refreshToken]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>VM 인스턴스를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!snapshot) {
    return (
      <section aria-label="VM 인스턴스 상세 불러오는 중" className="overseer-detail-loading">
        <Skeleton />
        <Skeleton />
        <Skeleton className="overseer-loading-table" />
      </section>
    );
  }

  const instance = snapshot.instances.find((candidate) => candidate.name === name);
  if (!instance) {
    return (
      <EmptyState.Root>
        <EmptyState.Icon>
          <ServerCog aria-hidden="true" />
        </EmptyState.Icon>
        <EmptyState.Title level={2}>VM 인스턴스를 찾을 수 없습니다.</EmptyState.Title>
        <EmptyState.Description>
          삭제되었거나 Lima에서 더 이상 발견되지 않습니다.
        </EmptyState.Description>
      </EmptyState.Root>
    );
  }

  const presentation = sectionPresentation[section];
  const running = instance.status.toLowerCase() === "running";

  return (
    <article className="overseer-detail-page">
      <div className="overseer-detail-layout">
        <aside className="overseer-detail-sidebar">
          <nav aria-label="VM 인스턴스 상세 메뉴">
            <div className="overseer-detail-nav-group" role="group">
              <span className="overseer-detail-nav-label">VM 인스턴스</span>
              <div className="overseer-detail-nav-items">
                {(["overview", "settings", "connection"] as const).map((value) => (
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
            <p>VM 인스턴스</p>
            <h2 className="city-text-section-title">{presentation.label}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

          {section === "overview" ? (
            <>
              <section aria-label="VM 인스턴스 개요" className="overseer-detail-summary">
                <div>
                  <span>상태</span>
                  <strong className="overseer-settings-status-value">
                    <Badge dot size="sm" tone={running ? "success" : "neutral"} />
                    {instance.status}
                  </strong>
                </div>
                <div>
                  <span>컨테이너</span>
                  <strong>{containers(instance)}</strong>
                </div>
                <div>
                  <span>가상화</span>
                  <strong>
                    {vmType(instance)} · {instance.architecture}
                  </strong>
                </div>
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">인스턴스 정보</h3>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition label="이름" value={instance.name} />
                  <Definition
                    label="관리 방식"
                    value={instance.managed ? "Overseer 관리" : "외부 인스턴스"}
                  />
                </dl>
              </section>
            </>
          ) : section === "settings" ? (
            <div className="overseer-detail-section-list">
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">가상화 설정</h3>
                    <p>이 인스턴스가 사용하는 가상화 환경과 VM 드라이버입니다.</p>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition label="실행 환경" value="Lima VM" />
                  <Definition label="VM 드라이버" value={vmType(instance)} />
                </dl>
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">할당 자원</h3>
                    <p>VM에 할당된 CPU, 메모리와 디스크 용량입니다.</p>
                  </div>
                </header>
                <dl className="overseer-detail-definitions">
                  <Definition label="CPU" value={instance.configuration?.cpus ?? "확인 불가"} />
                  <Definition
                    label="메모리"
                    value={
                      instance.configuration
                        ? `${instance.configuration.memoryGiB}GiB`
                        : "확인 불가"
                    }
                  />
                  <Definition
                    label="디스크"
                    value={
                      instance.configuration ? `${instance.configuration.diskGiB}GiB` : "확인 불가"
                    }
                  />
                </dl>
              </section>
            </div>
          ) : (
            <>
              <section aria-label="Docker 연결 개요" className="overseer-detail-summary">
                <div>
                  <span>Overseer 사용</span>
                  <strong>{instance.active ? "현재 사용 중" : "사용 안 함"}</strong>
                </div>
                <div>
                  <span>Docker</span>
                  <strong>{instance.dockerVersion ?? "확인 불가"}</strong>
                </div>
                <div>
                  <span>사용 준비</span>
                  <strong>{instance.prepared ? "준비됨" : "준비 필요"}</strong>
                </div>
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">연결 정보</h3>
                    <p>Docker socket과 macOS 홈 공유의 연결 상태입니다.</p>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition
                    label="Docker 호환"
                    value={instance.compatible ? "호환" : "호환 안 됨"}
                  />
                  <Definition
                    label="macOS 홈 공유"
                    value={instance.homeMountWritable ? "읽기/쓰기" : "읽기 전용"}
                  />
                  <Definition label="상태 설명" value={instance.message} wide />
                </dl>
              </section>
            </>
          )}

          <div className="overseer-detail-actions">
            {!instance.prepared && instance.compatible ? (
              <Button
                disabled={busy || snapshot.selectionLocked}
                onClick={() => void onPrepare(instance.name).catch(() => undefined)}
                size="sm"
                variant="outline"
              >
                <Wrench aria-hidden="true" size={14} />
                사용 준비
              </Button>
            ) : null}
            {!instance.active && instance.prepared ? (
              <Button
                disabled={busy || snapshot.selectionLocked}
                onClick={() => void onSelect(instance.name).catch(() => undefined)}
                size="sm"
                variant="outline"
              >
                이 인스턴스 사용
              </Button>
            ) : null}
            {instance.compatible ? (
              running ? (
                <Button
                  disabled={busy}
                  onClick={() => void onStop(instance.name).catch(() => undefined)}
                  size="sm"
                  variant="outline"
                >
                  <CircleStop aria-hidden="true" size={14} />
                  중지
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => void onStart(instance.name).catch(() => undefined)}
                  size="sm"
                >
                  <Play aria-hidden="true" size={14} />
                  시작
                </Button>
              )
            ) : null}
            <RuntimeInstanceActions
              busy={busy}
              instance={instance}
              onDelete={onDelete}
              onUpdate={onUpdate}
              selectionLocked={snapshot.selectionLocked}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
