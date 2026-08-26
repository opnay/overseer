import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Table } from "@opnay/city-ds-react/table";
import { Network, Trash2 } from "lucide-react";
import type { NetworkSummary } from "@contracts/contracts.ts";
import { followLink } from "@/shared/lib/follow-link";
import { networkDetailPath } from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";

export function NetworksPage({
  isBusy,
  networks,
  onInspect,
  onRemove,
}: {
  isBusy: (network: NetworkSummary) => boolean;
  networks: NetworkSummary[];
  onInspect: (network: NetworkSummary) => void;
  onRemove: (network: NetworkSummary) => void;
}) {
  return (
    <section className="overseer-panel" id="networks">
      <DataTableRegion
        className="overseer-data-table-region"
        hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
        label="네트워크 표"
      >
        <Table.Root
          aria-label="네트워크 목록"
          className="overseer-table overseer-table--networks"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 네트워크
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">이름</Table.Head>
              <Table.Head>드라이버</Table.Head>
              <Table.Head>범위</Table.Head>
              <Table.Head>IP</Table.Head>
              <Table.Head>내부</Table.Head>
              <Table.Head>네트워크 ID</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {networks.length === 0 ? (
              <Table.StateRow colSpan={7}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <Network aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>네트워크가 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    bridge 네트워크를 만들어 컨테이너를 연결할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              networks.map((network) => (
                <Table.Row key={network.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <div className="overseer-primary-cell">
                      <a
                        className="overseer-detail-link"
                        href={networkDetailPath(network.name)}
                        onClick={(event) => followLink(event, () => onInspect(network))}
                      >
                        {network.name}
                      </a>
                      {network.builtIn ? (
                        <span className="overseer-primary-meta">Docker 기본 네트워크</span>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{network.driver}</Table.Cell>
                  <Table.Cell>{network.scope}</Table.Cell>
                  <Table.Cell>
                    {[network.ipv4 ? "IPv4" : null, network.ipv6 ? "IPv6" : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Table.Cell>
                  <Table.Cell>{network.internal ? "예" : "아니요"}</Table.Cell>
                  <Table.Cell>
                    <code>{network.id}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <ConfirmAction
                        actionLabel="네트워크 삭제"
                        ariaLabel={`${network.name} 네트워크 삭제`}
                        disabled={network.builtIn || isBusy(network)}
                        description="연결된 컨테이너가 있는 네트워크는 삭제되지 않습니다."
                        onConfirm={() => onRemove(network)}
                        iconOnly
                        title={`${network.name} 네트워크를 삭제하시겠습니까?`}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </ConfirmAction>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </DataTableRegion>
    </section>
  );
}
