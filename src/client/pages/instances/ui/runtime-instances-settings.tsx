import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { CircleStop, Play, ServerCog, Wrench } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type {
  DeleteRuntimeInstanceInput,
  RuntimeInstancesSnapshot,
  UpdateRuntimeInstanceInput,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { RuntimeInstanceActions } from "./runtime-instance-actions.tsx";
import { runtimeInstanceDetailPath } from "@/shared/routes";

interface RuntimeInstancesSettingsProps {
  busy: boolean;
  onDelete(name: string, input: DeleteRuntimeInstanceInput): Promise<void>;
  onForceStop(name: string): Promise<void>;
  onPrepare(name: string): Promise<void>;
  onSelect(name: string): Promise<void>;
  onStart(name: string): Promise<void>;
  onStop(name: string): Promise<void>;
  onUpdate(name: string, input: UpdateRuntimeInstanceInput): Promise<void>;
  onOpenDetail(name: string): void;
  refreshToken: string;
}

function gibibytes(value: number | undefined): string {
  return value === undefined ? "-" : `${value}GiB`;
}

export function RuntimeInstancesSettings({
  busy,
  onDelete,
  onForceStop,
  onPrepare,
  onSelect,
  onStart,
  onStop,
  onUpdate,
  onOpenDetail,
  refreshToken,
}: RuntimeInstancesSettingsProps) {
  const [snapshot, setSnapshot] = useState<RuntimeInstancesSnapshot>();
  const [loadError, setLoadError] = useState<string>();

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setSnapshot(await apiRequest<RuntimeInstancesSnapshot>("/runtime/instances"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Lima 인스턴스를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const followDetailLink = (event: MouseEvent<HTMLAnchorElement>, name: string) => {
    if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onOpenDetail(name);
  };

  return (
    <section aria-label="Lima 인스턴스" className="overseer-instance-settings">
      {!snapshot && !loadError ? (
        <div aria-label="Lima 인스턴스 불러오는 중" className="overseer-instance-loading">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {loadError ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={3}>Lima 인스턴스를 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>{loadError}</Alert.Description>
          <Alert.Action>
            <Button onClick={() => void load()} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}

      {snapshot?.selectionLocked ? (
        <Alert.Root appearance="subtle" tone="info">
          <Alert.Title level={3}>사용할 인스턴스가 환경 변수로 고정되어 있습니다.</Alert.Title>
          <Alert.Description>
            OVERSEER_LIMA_INSTANCE를 해제해야 다른 인스턴스를 선택할 수 있습니다.
          </Alert.Description>
        </Alert.Root>
      ) : null}

      {snapshot ? (
        <DataTableRegion className="overseer-data-table-region" label="Lima 인스턴스 표">
          <Table.Root aria-label="Lima 인스턴스 목록" className="overseer-table" size="sm">
            <Table.Caption className="overseer-table-caption">
              로컬 Lima VM의 상태, 가상화 방식과 할당 자원
            </Table.Caption>
            <Table.Header>
              <Table.Row>
                <Table.Head className="overseer-table-column-medium">인스턴스</Table.Head>
                <Table.Head className="overseer-table-column-state">상태</Table.Head>
                <Table.Head className="overseer-table-column-state">가상화</Table.Head>
                <Table.Head className="overseer-table-column-medium">자원</Table.Head>
                <Table.Head className="overseer-actions-column">작업</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {snapshot.instances.length === 0 ? (
                <Table.StateRow colSpan={5}>
                  <EmptyState.Root density="compact">
                    <EmptyState.Icon>
                      <ServerCog aria-hidden="true" />
                    </EmptyState.Icon>
                    <EmptyState.Title level={3}>Lima 인스턴스가 없습니다.</EmptyState.Title>
                    <EmptyState.Description>
                      사용할 VM 인스턴스를 만드십시오.
                    </EmptyState.Description>
                  </EmptyState.Root>
                </Table.StateRow>
              ) : (
                snapshot.instances.map((instance) => (
                  <Table.Row key={instance.name}>
                    <Table.Cell>
                      <a
                        className="overseer-instance-link"
                        href={runtimeInstanceDetailPath(instance.name)}
                        onClick={(event) => followDetailLink(event, instance.name)}
                      >
                        <strong>{instance.name}</strong>
                      </a>
                      {instance.active ? (
                        <span className="overseer-instance-meta">Docker Engine으로 사용 중</span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>{instance.status}</Table.Cell>
                    <Table.Cell>
                      {instance.configuration?.vmType.toUpperCase() ?? "-"} ·{" "}
                      {instance.architecture}
                    </Table.Cell>
                    <Table.Cell>
                      {instance.configuration
                        ? `${instance.configuration.cpus} CPU · ${gibibytes(instance.configuration.memoryGiB)} · ${gibibytes(instance.configuration.diskGiB)}`
                        : "-"}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="overseer-instance-actions">
                        {!instance.prepared && instance.compatible ? (
                          <Button
                            aria-label={`${instance.name} Overseer 사용 준비`}
                            disabled={busy || snapshot.selectionLocked}
                            onClick={() => void onPrepare(instance.name).catch(() => undefined)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Wrench aria-hidden="true" size={14} />
                            준비
                          </Button>
                        ) : null}
                        {instance.compatible ? (
                          instance.status.toLowerCase() === "running" ? (
                            <Button
                              aria-label={`${instance.name} 인스턴스 중지`}
                              disabled={busy}
                              onClick={() => void onStop(instance.name).catch(() => undefined)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <CircleStop aria-hidden="true" size={14} />
                              중지
                            </Button>
                          ) : (
                            <Button
                              aria-label={`${instance.name} 인스턴스 시작`}
                              disabled={busy}
                              onClick={() => void onStart(instance.name).catch(() => undefined)}
                              size="sm"
                              type="button"
                              variant="outline"
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
                          onForceStop={onForceStop}
                          onSelect={onSelect}
                          onUpdate={onUpdate}
                          selectionLocked={snapshot.selectionLocked}
                        />
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>
        </DataTableRegion>
      ) : null}
    </section>
  );
}
