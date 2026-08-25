import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Input } from "@opnay/city-ds-react/input";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { CircleStop, Play, Plus, ServerCog, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  CreateRuntimeInstanceInput,
  DockerEngineConfiguration,
  RuntimeInstancesSnapshot,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { DockerEngineNumberSetting } from "./docker-engine-number-setting.tsx";

interface RuntimeInstancesSettingsProps {
  busy: boolean;
  defaultConfiguration: DockerEngineConfiguration;
  onCreate(input: CreateRuntimeInstanceInput): Promise<void>;
  onPrepare(name: string): Promise<void>;
  onSelect(name: string): Promise<void>;
  onStart(name: string): Promise<void>;
  onStop(name: string): Promise<void>;
  refreshToken: string;
}

function gibibytes(value: number | undefined): string {
  return value === undefined ? "-" : `${value}GiB`;
}

export function RuntimeInstancesSettings({
  busy,
  defaultConfiguration,
  onCreate,
  onPrepare,
  onSelect,
  onStart,
  onStop,
  refreshToken,
}: RuntimeInstancesSettingsProps) {
  const [snapshot, setSnapshot] = useState<RuntimeInstancesSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [configuration, setConfiguration] = useState(defaultConfiguration);
  const [formError, setFormError] = useState<string>();

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

  useEffect(() => {
    if (!dialogOpen) setConfiguration(defaultConfiguration);
  }, [defaultConfiguration, dialogOpen]);

  const create = async () => {
    setFormError(undefined);
    try {
      await onCreate({ configuration, name });
      setDialogOpen(false);
      setName("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "인스턴스를 만들지 못했습니다.");
    }
  };

  return (
    <section className="overseer-instance-settings" aria-labelledby="overseer-instances-title">
      <header className="overseer-instance-settings-header">
        <div>
          <h3 id="overseer-instances-title">Lima 인스턴스</h3>
          <p>발견된 인스턴스 중 하나를 활성 Docker Engine으로 사용합니다.</p>
        </div>
        <Dialog.Root onOpenChange={setDialogOpen} open={dialogOpen}>
          <Dialog.Trigger disabled={busy} render={<Button type="button" />}>
            <Plus aria-hidden="true" size={14} />
            인스턴스 만들기
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <Dialog.Popup scroll="body" size="md">
                <Dialog.Header>
                  <Dialog.Title>Lima 인스턴스 만들기</Dialog.Title>
                  <Dialog.Description>
                    선택한 가상화 설정과 자원으로 Docker Engine 인스턴스를 만듭니다.
                  </Dialog.Description>
                </Dialog.Header>
                <Dialog.Body>
                  <div className="overseer-instance-create-form">
                    <Field.Root>
                      <Field.Label>인스턴스 이름</Field.Label>
                      <Input
                        aria-label="인스턴스 이름"
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                        placeholder="예: overseer"
                        value={name}
                      />
                      <Field.Description>
                        소문자·숫자로 시작하고 점·밑줄·하이픈을 사용할 수 있습니다.
                      </Field.Description>
                    </Field.Root>
                    <Fieldset.Root appearance="plain">
                      <Fieldset.Legend>VM 리소스</Fieldset.Legend>
                      <Fieldset.Content className="overseer-settings-resource-grid">
                        <DockerEngineNumberSetting
                          description="가상 CPU 수"
                          label="CPU"
                          min={1}
                          onChange={(cpus) =>
                            setConfiguration((current) => ({
                              ...current,
                              cpus: cpus ?? current.cpus,
                            }))
                          }
                          value={configuration.cpus}
                        />
                        <DockerEngineNumberSetting
                          description="GiB 단위"
                          label="메모리"
                          min={1}
                          onChange={(memoryGiB) =>
                            setConfiguration((current) => ({
                              ...current,
                              memoryGiB: memoryGiB ?? current.memoryGiB,
                            }))
                          }
                          value={configuration.memoryGiB}
                        />
                        <DockerEngineNumberSetting
                          description="GiB 단위, 최소 10GiB"
                          label="디스크"
                          min={10}
                          onChange={(diskGiB) =>
                            setConfiguration((current) => ({
                              ...current,
                              diskGiB: diskGiB ?? current.diskGiB,
                            }))
                          }
                          value={configuration.diskGiB}
                        />
                      </Fieldset.Content>
                    </Fieldset.Root>
                    {formError ? (
                      <Alert.Root tone="destructive">
                        <Alert.Title level={3}>인스턴스를 만들지 못했습니다.</Alert.Title>
                        <Alert.Description>{formError}</Alert.Description>
                      </Alert.Root>
                    ) : null}
                  </div>
                </Dialog.Body>
                <Dialog.Footer>
                  <Dialog.Close render={<Button variant="outline" />}>취소</Dialog.Close>
                  <Button
                    disabled={busy || !name.trim()}
                    onClick={() => void create()}
                    type="button"
                  >
                    <ServerCog aria-hidden="true" size={14} />
                    만들기
                  </Button>
                </Dialog.Footer>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

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
          <Alert.Title level={3}>활성 인스턴스가 환경 변수로 고정되어 있습니다.</Alert.Title>
          <Alert.Description>
            OVERSEER_LIMA_INSTANCE를 해제해야 다른 인스턴스를 선택할 수 있습니다.
          </Alert.Description>
        </Alert.Root>
      ) : null}

      {snapshot ? (
        <DataTableRegion
          className="overseer-data-table-region"
          hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
          label="Lima 인스턴스 표"
        >
          <Table.Root aria-label="Lima 인스턴스 목록" className="overseer-table" size="sm">
            <Table.Caption className="overseer-table-caption">
              로컬 Lima 인스턴스와 Overseer 사용 준비 상태
            </Table.Caption>
            <Table.Header>
              <Table.Row>
                <Table.Head className="overseer-table-column-compact">활성</Table.Head>
                <Table.Head className="overseer-table-column-instance">인스턴스</Table.Head>
                <Table.Head className="overseer-table-column-state">상태</Table.Head>
                <Table.Head className="overseer-table-column-compact">Docker</Table.Head>
                <Table.Head className="overseer-table-column-state">가상화</Table.Head>
                <Table.Head className="overseer-table-column-instance">자원</Table.Head>
                <Table.Head className="overseer-table-column-state">연결</Table.Head>
                <Table.Head className="overseer-actions-column">작업</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {snapshot.instances.length === 0 ? (
                <Table.StateRow colSpan={8}>
                  <EmptyState.Root density="compact">
                    <EmptyState.Icon>
                      <ServerCog aria-hidden="true" />
                    </EmptyState.Icon>
                    <EmptyState.Title level={3}>Lima 인스턴스가 없습니다.</EmptyState.Title>
                    <EmptyState.Description>
                      Docker Engine을 사용할 인스턴스를 만드십시오.
                    </EmptyState.Description>
                  </EmptyState.Root>
                </Table.StateRow>
              ) : (
                snapshot.instances.map((instance) => (
                  <Table.Row key={instance.name}>
                    <Table.Cell>
                      {instance.active ? <Badge tone="success">활성</Badge> : "-"}
                    </Table.Cell>
                    <Table.Cell>
                      <strong>{instance.name}</strong>
                      {instance.managed ? (
                        <span className="overseer-instance-origin">Overseer</span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>{instance.status}</Table.Cell>
                    <Table.Cell>
                      {instance.dockerVersion ?? (instance.compatible ? "대기" : "미지원")}
                    </Table.Cell>
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
                      <Badge
                        tone={
                          instance.prepared
                            ? "success"
                            : instance.compatible
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {instance.prepared
                          ? "준비됨"
                          : instance.compatible
                            ? "준비 필요"
                            : "호환 안 됨"}
                      </Badge>
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
                        {!instance.active && instance.prepared ? (
                          <Button
                            aria-label={`${instance.name} 인스턴스 사용`}
                            disabled={busy || snapshot.selectionLocked}
                            onClick={() => void onSelect(instance.name).catch(() => undefined)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            사용
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
