import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Network } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type {
  ContainerKeyValue,
  NetworkContainerAttachment,
  NetworkDetail,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { containerDetailPath } from "./routes.ts";
import { formatDateTime } from "./date-time.ts";
import { LogViewer } from "./log-display-options.tsx";

interface NetworkDetailPageProps {
  name: string;
  onOpenContainer(id: string): void;
  refreshToken: string;
}

type NetworkDetailSection = "containers" | "inspect" | "ipam" | "labels" | "options" | "overview";

const sectionPresentation: Record<NetworkDetailSection, { description: string; label: string }> = {
  containers: {
    description: "이 네트워크에 연결된 컨테이너와 할당 주소를 확인합니다.",
    label: "연결 컨테이너",
  },
  inspect: {
    description: "Docker Engine이 반환한 전체 네트워크 inspect JSON을 확인합니다.",
    label: "Inspect",
  },
  ipam: {
    description: "IPAM 드라이버와 주소 풀, Gateway를 확인합니다.",
    label: "IPAM",
  },
  labels: {
    description: "네트워크에 저장된 Docker Label을 확인합니다.",
    label: "Label",
  },
  options: {
    description: "네트워크와 IPAM 드라이버에 전달된 옵션을 확인합니다.",
    label: "드라이버 설정",
  },
  overview: {
    description: "네트워크의 식별자, 드라이버와 연결 동작을 확인합니다.",
    label: "개요",
  },
};

const sectionOrder: NetworkDetailSection[] = [
  "overview",
  "ipam",
  "containers",
  "options",
  "labels",
  "inspect",
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

function followContainerLink(
  event: MouseEvent<HTMLAnchorElement>,
  id: string,
  onOpenContainer: (id: string) => void,
) {
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onOpenContainer(id);
}

function Containers({
  containers,
  onOpenContainer,
}: {
  containers: NetworkContainerAttachment[];
  onOpenContainer(id: string): void;
}) {
  return (
    <DataTableRegion
      hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
      label="네트워크 연결 컨테이너 표"
    >
      <Table.Root aria-label="연결 컨테이너 목록" className="overseer-table" size="sm">
        <Table.Caption className="overseer-table-caption">
          네트워크에 연결된 Docker 컨테이너
        </Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head className="overseer-table-column-medium">컨테이너</Table.Head>
            <Table.Head>IPv4</Table.Head>
            <Table.Head>IPv6</Table.Head>
            <Table.Head>MAC</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {containers.length === 0 ? (
            <Table.StateRow colSpan={4}>
              <EmptyState.Root density="compact">
                <EmptyState.Icon>
                  <Network aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={3}>연결된 컨테이너가 없습니다.</EmptyState.Title>
              </EmptyState.Root>
            </Table.StateRow>
          ) : (
            containers.map((container) => (
              <Table.Row key={container.id}>
                <Table.Cell className="overseer-table-column-medium">
                  <div className="overseer-primary-cell">
                    <a
                      className="overseer-detail-link"
                      href={containerDetailPath(container.id)}
                      onClick={(event) => followContainerLink(event, container.id, onOpenContainer)}
                    >
                      {container.name}
                    </a>
                    <code className="overseer-primary-meta">{container.id}</code>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <code>{container.ipv4Address ?? "—"}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{container.ipv6Address ?? "—"}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{container.macAddress ?? "—"}</code>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </DataTableRegion>
  );
}

export function NetworkDetailPage({ name, onOpenContainer, refreshToken }: NetworkDetailPageProps) {
  const [detail, setDetail] = useState<NetworkDetail>();
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<NetworkDetailSection>("overview");

  useEffect(() => setSection("overview"), [name]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiRequest<{ network: NetworkDetail }>(`/networks/${encodeURIComponent(name)}`)
      .then(({ network }) => active && setDetail(network))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(
            loadError instanceof Error ? loadError.message : "네트워크 상세를 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [name, refreshToken]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>네트워크 상세를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    );
  }

  if (!detail) {
    return (
      <section aria-label="네트워크 상세 불러오는 중" className="overseer-detail-loading">
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
          <nav aria-label="네트워크 상세 메뉴">
            <div
              aria-labelledby="overseer-network-detail-navigation"
              className="overseer-detail-nav-group"
              role="group"
            >
              <span className="overseer-detail-nav-label" id="overseer-network-detail-navigation">
                네트워크
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
            <p>네트워크</p>
            <h2 className="city-text-section-title">{presentation.label}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

          {section === "overview" ? (
            <>
              <section aria-label="네트워크 개요" className="overseer-detail-summary">
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
                    <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
                  </strong>
                </div>
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">식별 및 동작 정보</h3>
                  </div>
                </header>
                <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                  <Definition label="이름" value={detail.name} />
                  <Definition label="ID" value={<code>{detail.id}</code>} />
                  <Definition
                    label="종류"
                    value={
                      detail.builtIn ? (
                        <Badge appearance="outline" size="sm" tone="neutral">
                          Docker 기본 네트워크
                        </Badge>
                      ) : (
                        "사용자 네트워크"
                      )
                    }
                  />
                  <Definition label="IPv4" value={detail.enableIpv4 ? "사용" : "사용 안 함"} />
                  <Definition label="IPv6" value={detail.enableIpv6 ? "사용" : "사용 안 함"} />
                  <Definition label="내부 전용" value={detail.internal ? "예" : "아니요"} />
                  <Definition label="수동 연결" value={detail.attachable ? "허용" : "허용 안 함"} />
                  <Definition label="Ingress" value={detail.ingress ? "예" : "아니요"} />
                  <Definition label="설정 전용" value={detail.configOnly ? "예" : "아니요"} />
                </dl>
              </section>
            </>
          ) : null}

          {section === "ipam" ? (
            <div className="overseer-detail-section-list">
              <dl className="overseer-detail-definitions">
                <Definition label="IPAM 드라이버" value={<code>{detail.ipamDriver}</code>} />
                <Definition label="주소 풀" value={`${detail.ipamConfigurations.length}개`} />
              </dl>
              {detail.ipamConfigurations.map((configuration, index) => (
                <section
                  className="overseer-detail-section"
                  key={`${configuration.subnet}-${index}`}
                >
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">주소 풀 {index + 1}</h3>
                    </div>
                  </header>
                  <dl className="overseer-detail-definitions">
                    <Definition label="Subnet" value={<code>{configuration.subnet ?? "—"}</code>} />
                    <Definition
                      label="Gateway"
                      value={<code>{configuration.gateway ?? "—"}</code>}
                    />
                    <Definition
                      label="IP Range"
                      value={<code>{configuration.ipRange ?? "—"}</code>}
                    />
                  </dl>
                  {configuration.auxiliaryAddresses.length > 0 ? (
                    <KeyValues empty="" values={configuration.auxiliaryAddresses} />
                  ) : null}
                </section>
              ))}
              {detail.ipamConfigurations.length === 0 ? (
                <p className="overseer-detail-empty-copy">IPAM 주소 풀이 없습니다.</p>
              ) : null}
            </div>
          ) : null}

          {section === "containers" ? (
            <Containers containers={detail.containers} onOpenContainer={onOpenContainer} />
          ) : null}

          {section === "options" ? (
            <div className="overseer-detail-section-list">
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">네트워크 드라이버</h3>
                  </div>
                </header>
                <KeyValues empty="네트워크 드라이버 옵션이 없습니다." values={detail.options} />
              </section>
              <section className="overseer-detail-section">
                <header>
                  <div>
                    <h3 className="city-text-subsection-title">IPAM 드라이버</h3>
                  </div>
                </header>
                <KeyValues empty="IPAM 드라이버 옵션이 없습니다." values={detail.ipamOptions} />
              </section>
            </div>
          ) : null}

          {section === "labels" ? (
            <KeyValues empty="Label이 없습니다." values={detail.labels} />
          ) : null}

          {section === "inspect" ? (
            <LogViewer
              ariaLabel="네트워크 Inspect JSON"
              context={<code>docker network inspect {detail.name}</code>}
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
