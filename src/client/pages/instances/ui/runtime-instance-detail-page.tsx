import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ServerCog, Terminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { RuntimeInstanceSummary, RuntimeInstancesSnapshot } from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { useUrlSection } from "@/shared/lib/url-section";
import { CommandBlock } from "@/shared/ui/command-block";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";
import type { RuntimeInstanceHeaderState } from "./runtime-instance-header-actions.tsx";

type InstanceDetailSection = "connection" | "overview" | "settings" | "terminal";

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
  terminal: {
    description: "로컬 터미널에서 Lima VM 셸에 연결합니다.",
    label: "터미널",
  },
};

const sectionOrder: InstanceDetailSection[] = ["overview", "settings", "terminal", "connection"];

const instanceDetailNavigation = [
  {
    items: sectionOrder.map((value) => ({ label: sectionPresentation[value].label, value })),
    label: "VM 인스턴스",
  },
];

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
  name,
  onHeaderStateChange,
  refreshToken,
}: {
  name: string;
  onHeaderStateChange(state?: RuntimeInstanceHeaderState): void;
  refreshToken: string;
}) {
  const [snapshot, setSnapshot] = useState<RuntimeInstancesSnapshot>();
  const [error, setError] = useState<string>();
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: "overview",
    locationKey: name,
    values: sectionOrder,
  });

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

  const instance = snapshot?.instances.find((candidate) => candidate.name === name);

  useEffect(() => {
    onHeaderStateChange(
      instance && snapshot ? { instance, selectionLocked: snapshot.selectionLocked } : undefined,
    );
  }, [instance, onHeaderStateChange, snapshot]);

  useEffect(
    () => () => {
      onHeaderStateChange(undefined);
    },
    [onHeaderStateChange],
  );

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
      <SectionedWorkspace<InstanceDetailSection>
        category="VM 인스턴스"
        description={presentation.description}
        getSectionHref={getSectionHref}
        groups={instanceDetailNavigation}
        navigationLabel="VM 인스턴스 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.label}
      >
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
                    instance.configuration ? `${instance.configuration.memoryGiB}GiB` : "확인 불가"
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
        ) : section === "terminal" ? (
          running ? (
            <section className="overseer-detail-section">
              <p className="city-text-supporting">
                로컬 터미널에서 아래 명령을 실행하면 이 Lima VM 셸에 연결됩니다.
              </p>
              <CommandBlock
                ariaLabel="VM 인스턴스 터미널 명령"
                command={`limactl shell ${instance.name}`}
                copyLabel="터미널 명령 복사"
                label="로컬 터미널에서 실행"
              />
            </section>
          ) : (
            <EmptyState.Root>
              <EmptyState.Icon>
                <Terminal aria-hidden="true" />
              </EmptyState.Icon>
              <EmptyState.Title level={3}>VM 인스턴스가 실행 중이 아닙니다.</EmptyState.Title>
              <EmptyState.Description>
                페이지 상단에서 인스턴스를 시작한 뒤 터미널 명령을 확인하십시오.
              </EmptyState.Description>
            </EmptyState.Root>
          )
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
      </SectionedWorkspace>
    </article>
  );
}
