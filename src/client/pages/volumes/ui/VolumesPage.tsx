import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Table } from "@opnay/city-ds-react/table";
import { Database, Trash2 } from "lucide-react";
import type { VolumeSummary } from "@contracts/contracts.ts";
import { followLink } from "@/shared/lib/follow-link";
import { volumeDetailPath } from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";

export function VolumesPage({
  isBusy,
  onInspect,
  onRemove,
  volumes,
}: {
  isBusy: (volume: VolumeSummary) => boolean;
  onInspect: (volume: VolumeSummary) => void;
  onRemove: (volume: VolumeSummary) => void;
  volumes: VolumeSummary[];
}) {
  return (
    <section className="overseer-panel" id="volumes">
      <DataTableRegion className="overseer-data-table-region" label="볼륨 표">
        <Table.Root
          aria-label="볼륨 목록"
          className="overseer-table overseer-table--volumes"
          size="sm"
        >
          <Table.Caption className="overseer-table-caption">
            Lima overseer 인스턴스의 볼륨
          </Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">이름</Table.Head>
              <Table.Head>드라이버</Table.Head>
              <Table.Head>범위</Table.Head>
              <Table.Head>레이블</Table.Head>
              <Table.Head className="overseer-actions-column">작업</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {volumes.length === 0 ? (
              <Table.StateRow colSpan={5}>
                <EmptyState.Root className="overseer-table-empty-state" density="compact">
                  <EmptyState.Icon>
                    <Database aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>볼륨이 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    named volume을 만들어 컨테이너 데이터를 유지할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              volumes.map((volume) => (
                <Table.Row key={volume.name}>
                  <Table.Cell className="overseer-table-column-wide">
                    <a
                      className="overseer-detail-link"
                      href={volumeDetailPath(volume.name)}
                      onClick={(event) => followLink(event, () => onInspect(volume))}
                    >
                      {volume.name}
                    </a>
                  </Table.Cell>
                  <Table.Cell>{volume.driver}</Table.Cell>
                  <Table.Cell>{volume.scope}</Table.Cell>
                  <Table.Cell>{volume.labels || "—"}</Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <ConfirmAction
                        actionLabel="볼륨 삭제"
                        ariaLabel={`${volume.name} 볼륨 삭제`}
                        disabled={isBusy(volume)}
                        description="볼륨의 데이터가 영구적으로 삭제됩니다. 사용 중인 볼륨은 삭제되지 않습니다."
                        onConfirm={() => onRemove(volume)}
                        iconOnly
                        title={`${volume.name} 볼륨을 삭제하시겠습니까?`}
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
