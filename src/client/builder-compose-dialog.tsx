import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Checkbox } from "@opnay/city-ds-react/checkbox";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Input } from "@opnay/city-ds-react/input";
import { NumberField } from "@opnay/city-ds-react/number-field";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Tabs } from "@opnay/city-ds-react/tabs";
import { Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ComposeBuilderProjectDetail,
  ComposeBuilderService,
  ComposeBuilderSpec,
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerVolumeMount,
} from "../shared/contracts.ts";
import {
  composeBuilderYaml,
  emptyComposeBuilderService,
  emptyComposeBuilderSpec,
  validateComposeBuilderSpec,
} from "../shared/compose-builder.ts";
import { ApiRequestError, apiRequest } from "./api.ts";

function SelectControl({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <Select.Root
      items={Object.fromEntries(options.map((option) => [option.value, option.label]))}
      onValueChange={(nextValue) => nextValue && onChange(String(nextValue))}
      value={value}
    >
      <Select.Trigger aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.List>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  <Select.ItemIndicator />
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function NumberControl({
  ariaLabel,
  onChange,
  value,
}: {
  ariaLabel: string;
  onChange: (value: number | undefined) => void;
  value?: number;
}) {
  return (
    <NumberField.Root
      max={65_535}
      min={1}
      onValueChange={(nextValue) => onChange(nextValue ?? undefined)}
      value={value ?? null}
    >
      <NumberField.Group>
        <NumberField.Input aria-label={ariaLabel} />
        <NumberField.Decrement aria-label={`${ariaLabel} 감소`} />
        <NumberField.Increment aria-label={`${ariaLabel} 증가`} />
      </NumberField.Group>
    </NumberField.Root>
  );
}

function StringRows({
  addLabel,
  ariaLabel,
  onChange,
  placeholder,
  values,
}: {
  addLabel: string;
  ariaLabel: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((value, index) => (
        <div className="overseer-repeatable-row overseer-repeatable-row-single" key={index}>
          <Input
            aria-label={`${ariaLabel} ${index + 1}`}
            onValueChange={(nextValue) =>
              onChange(values.map((item, itemIndex) => (itemIndex === index ? nextValue : item)))
            }
            placeholder={placeholder}
            value={value}
          />
          <Button
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            size="sm"
            type="button"
            variant="ghost"
          >
            삭제
          </Button>
        </div>
      ))}
      <Button onClick={() => onChange([...values, ""])} size="sm" type="button" variant="outline">
        <Plus aria-hidden="true" size={14} />
        {addLabel}
      </Button>
    </div>
  );
}

function KeyValueRows({
  onChange,
  serviceIndex,
  values,
}: {
  onChange: (values: ContainerKeyValue[]) => void;
  serviceIndex: number;
  values: ContainerKeyValue[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((entry, index) => (
        <div className="overseer-repeatable-row" key={index}>
          <Input
            aria-label={`서비스 ${serviceIndex + 1} 환경 변수 이름 ${index + 1}`}
            onValueChange={(key) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, key } : item)),
              )
            }
            placeholder="KEY"
            value={entry.key}
          />
          <Input
            aria-label={`서비스 ${serviceIndex + 1} 환경 변수 값 ${index + 1}`}
            onValueChange={(value) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)),
              )
            }
            placeholder="value"
            value={entry.value}
          />
          <Button
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            size="sm"
            type="button"
            variant="ghost"
          >
            삭제
          </Button>
        </div>
      ))}
      <Button
        onClick={() => onChange([...values, { key: "", value: "" }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        환경 변수 추가
      </Button>
    </div>
  );
}

function PortRows({
  onChange,
  serviceIndex,
  values,
}: {
  onChange: (values: ContainerPortMapping[]) => void;
  serviceIndex: number;
  values: ContainerPortMapping[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((port, index) => (
        <div className="overseer-port-row" key={index}>
          <NumberControl
            ariaLabel={`서비스 ${serviceIndex + 1} 컨테이너 포트 ${index + 1}`}
            onChange={(containerPort) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, containerPort: containerPort ?? 0 } : item,
                ),
              )
            }
            value={port.containerPort || undefined}
          />
          <NumberControl
            ariaLabel={`서비스 ${serviceIndex + 1} 호스트 포트 ${index + 1}`}
            onChange={(hostPort) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index
                    ? {
                        ...item,
                        ...(hostPort === undefined ? { hostPort: undefined } : { hostPort }),
                      }
                    : item,
                ),
              )
            }
            value={port.hostPort}
          />
          <SelectControl
            ariaLabel={`서비스 ${serviceIndex + 1} 포트 프로토콜 ${index + 1}`}
            onChange={(protocol) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, protocol: protocol === "udp" ? "udp" : "tcp" }
                    : item,
                ),
              )
            }
            options={[
              { label: "TCP", value: "tcp" },
              { label: "UDP", value: "udp" },
            ]}
            value={port.protocol}
          />
          <Button
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            size="sm"
            type="button"
            variant="ghost"
          >
            삭제
          </Button>
        </div>
      ))}
      <Button
        onClick={() => onChange([...values, { containerPort: 0, protocol: "tcp" }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        포트 추가
      </Button>
    </div>
  );
}

function VolumeRows({
  onChange,
  serviceIndex,
  values,
}: {
  onChange: (values: ContainerVolumeMount[]) => void;
  serviceIndex: number;
  values: ContainerVolumeMount[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((mount, index) => (
        <div className="overseer-volume-row" key={index}>
          <Input
            aria-label={`서비스 ${serviceIndex + 1} 볼륨 이름 ${index + 1}`}
            onValueChange={(volume) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, volume } : item)),
              )
            }
            placeholder="app-data"
            value={mount.volume}
          />
          <Input
            aria-label={`서비스 ${serviceIndex + 1} 볼륨 경로 ${index + 1}`}
            onValueChange={(containerPath) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, containerPath } : item,
                ),
              )
            }
            placeholder="/data"
            value={mount.containerPath}
          />
          <label className="overseer-checkbox-label">
            <Checkbox
              aria-label={`서비스 ${serviceIndex + 1} 볼륨 ${index + 1} 읽기 전용`}
              checked={mount.readOnly}
              onCheckedChange={(readOnly) =>
                onChange(
                  values.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, readOnly: readOnly === true } : item,
                  ),
                )
              }
            />
            읽기 전용
          </label>
          <Button
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            size="sm"
            type="button"
            variant="ghost"
          >
            삭제
          </Button>
        </div>
      ))}
      <Button
        onClick={() => onChange([...values, { containerPath: "", readOnly: false, volume: "" }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        볼륨 연결 추가
      </Button>
    </div>
  );
}

function ServiceFields({
  index,
  onChange,
  onRemove,
  service,
}: {
  index: number;
  onChange: (service: ComposeBuilderService) => void;
  onRemove: () => void;
  service: ComposeBuilderService;
}) {
  const labelId = `overseer-compose-service-${index + 1}`;
  return (
    <section aria-labelledby={labelId} className="overseer-compose-service">
      <div className="overseer-compose-service-header">
        <div>
          <strong id={labelId}>서비스 {index + 1}</strong>
          <span>{service.name || "이름 없음"}</span>
        </div>
        <Button onClick={onRemove} size="sm" type="button" variant="ghost">
          서비스 삭제
        </Button>
      </div>
      <div className="overseer-container-form">
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>이미지와 식별 정보</Fieldset.Legend>
          <Fieldset.Content className="overseer-form-section-grid">
            <Field.Root>
              <Field.Label>서비스 이름</Field.Label>
              <Input
                aria-label={`서비스 ${index + 1} 이름`}
                onValueChange={(name) => onChange({ ...service, name })}
                placeholder="web"
                value={service.name}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>컨테이너 이름 (선택)</Field.Label>
              <Input
                aria-label={`서비스 ${index + 1} 컨테이너 이름`}
                onValueChange={(containerName) =>
                  onChange({ ...service, containerName: containerName || undefined })
                }
                placeholder="demo-web"
                value={service.containerName ?? ""}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>이미지</Field.Label>
              <Input
                aria-label={`서비스 ${index + 1} 이미지`}
                onValueChange={(image) => onChange({ ...service, image })}
                placeholder="nginx"
                value={service.image}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>태그</Field.Label>
              <Input
                aria-label={`서비스 ${index + 1} 이미지 태그`}
                onValueChange={(tag) => onChange({ ...service, tag })}
                placeholder="latest"
                value={service.tag}
              />
            </Field.Root>
          </Fieldset.Content>
        </Fieldset.Root>
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>명령</Fieldset.Legend>
          <Fieldset.Content>
            <StringRows
              addLabel="명령 인수 추가"
              ariaLabel={`서비스 ${index + 1} 명령 인수`}
              onChange={(command) => onChange({ ...service, command })}
              placeholder="명령 또는 인수"
              values={service.command}
            />
          </Fieldset.Content>
        </Fieldset.Root>
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>포트</Fieldset.Legend>
          <Fieldset.Description>호스트 포트는 항상 127.0.0.1에만 연결됩니다.</Fieldset.Description>
          <Fieldset.Content>
            <PortRows
              onChange={(ports) => onChange({ ...service, ports })}
              serviceIndex={index}
              values={service.ports}
            />
          </Fieldset.Content>
        </Fieldset.Root>
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>환경 변수</Fieldset.Legend>
          <Fieldset.Content>
            <KeyValueRows
              onChange={(environment) => onChange({ ...service, environment })}
              serviceIndex={index}
              values={service.environment}
            />
          </Fieldset.Content>
        </Fieldset.Root>
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>볼륨 연결</Fieldset.Legend>
          <Fieldset.Content>
            <VolumeRows
              onChange={(volumes) => onChange({ ...service, volumes })}
              serviceIndex={index}
              values={service.volumes}
            />
          </Fieldset.Content>
        </Fieldset.Root>
        <Fieldset.Root appearance="plain">
          <Fieldset.Legend>네트워크 연결</Fieldset.Legend>
          <Fieldset.Content>
            <StringRows
              addLabel="네트워크 연결 추가"
              ariaLabel={`서비스 ${index + 1} 네트워크`}
              onChange={(networks) => onChange({ ...service, networks })}
              placeholder="frontend"
              values={service.networks}
            />
          </Fieldset.Content>
        </Fieldset.Root>
        <Field.Root>
          <Field.Label>재시작 정책</Field.Label>
          <SelectControl
            ariaLabel={`서비스 ${index + 1} 재시작 정책`}
            onChange={(mode) =>
              onChange({
                ...service,
                restartPolicy: {
                  mode:
                    mode === "always" || mode === "unless-stopped" || mode === "on-failure"
                      ? mode
                      : "no",
                },
              })
            }
            options={[
              { label: "없음", value: "no" },
              { label: "항상", value: "always" },
              { label: "중지 전까지", value: "unless-stopped" },
              { label: "실패 시", value: "on-failure" },
            ]}
            value={service.restartPolicy.mode}
          />
        </Field.Root>
      </div>
    </section>
  );
}

export function BuilderComposeDialog({
  onOpenChange,
  onSubmit,
  open,
  projectName,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (spec: ComposeBuilderSpec, expectedConfigHash?: string) => Promise<void>;
  open: boolean;
  projectName?: string;
}) {
  const [configHash, setConfigHash] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [spec, setSpec] = useState<ComposeBuilderSpec>(emptyComposeBuilderSpec);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("form");

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setFormError(undefined);
    setTab("form");
    if (!projectName) {
      setConfigHash(undefined);
      setSpec(emptyComposeBuilderSpec());
      return;
    }
    setLoading(true);
    void apiRequest<{ project: ComposeBuilderProjectDetail }>(
      `/compose/projects/${encodeURIComponent(projectName)}/builder`,
    )
      .then(({ project }) => {
        setConfigHash(project.configHash);
        setSpec(project.spec);
      })
      .catch((error) =>
        setFormError(
          error instanceof Error ? error.message : "Compose 구성을 불러오지 못했습니다.",
        ),
      )
      .finally(() => setLoading(false));
  }, [open, projectName]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issues = validateComposeBuilderSpec(spec).map(({ message }) => message);
    setErrors([...new Set(issues)]);
    if (issues.length > 0) {
      setTab("form");
      return;
    }
    setSubmitting(true);
    setFormError(undefined);
    try {
      await onSubmit(spec, configHash);
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : "Compose 저장 작업을 시작하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const previewIssues = validateComposeBuilderSpec(spec);

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="overseer-container-dialog" scroll="body" size="xl">
            <Dialog.Header>
              <div>
                <Dialog.Title>{projectName ? "폼 Compose 수정" : "폼 Compose 추가"}</Dialog.Title>
                <Dialog.Description>
                  서비스와 리소스를 입력하고 생성될 compose.yaml을 확인합니다.
                </Dialog.Description>
              </div>
            </Dialog.Header>
            <form onSubmit={submit}>
              <Dialog.Body>
                {loading ? (
                  <div aria-label="Compose 구성 불러오는 중" className="overseer-form-stack">
                    <Skeleton className="overseer-loading-description" />
                    <Skeleton className="overseer-loading-table" />
                  </div>
                ) : (
                  <Tabs.Root onValueChange={(value) => setTab(String(value))} value={tab}>
                    <Tabs.List aria-label="Compose 입력 방식">
                      <Tabs.Tab value="form">폼</Tabs.Tab>
                      <Tabs.Tab value="yaml">YAML 미리보기</Tabs.Tab>
                      <Tabs.Indicator />
                    </Tabs.List>
                    <Tabs.Panel className="overseer-compose-builder-panel" value="form">
                      {formError ? (
                        <Alert.Root tone="destructive">
                          <Alert.Title level={3}>Compose 구성을 저장하지 못했습니다.</Alert.Title>
                          <Alert.Description>{formError}</Alert.Description>
                        </Alert.Root>
                      ) : null}
                      {errors.length > 0 ? (
                        <Alert.Root tone="destructive">
                          <Alert.Title level={3}>입력값을 확인하십시오.</Alert.Title>
                          <Alert.Description>
                            <ul>
                              {errors.slice(0, 6).map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          </Alert.Description>
                        </Alert.Root>
                      ) : null}
                      <Fieldset.Root appearance="plain">
                        <Fieldset.Legend>프로젝트</Fieldset.Legend>
                        <Fieldset.Content>
                          <Field.Root>
                            <Field.Label>프로젝트 이름</Field.Label>
                            <Input
                              aria-label="Compose 프로젝트 이름"
                              disabled={Boolean(projectName)}
                              onValueChange={(name) => setSpec((current) => ({ ...current, name }))}
                              placeholder="demo-stack"
                              value={spec.name}
                            />
                            <Field.Description>
                              저장 후 프로젝트 이름은 변경할 수 없습니다.
                            </Field.Description>
                          </Field.Root>
                        </Fieldset.Content>
                      </Fieldset.Root>
                      <div className="overseer-form-section-grid">
                        <Fieldset.Root appearance="plain">
                          <Fieldset.Legend>네트워크</Fieldset.Legend>
                          <Fieldset.Description>
                            기본 bridge 네트워크를 만듭니다.
                          </Fieldset.Description>
                          <Fieldset.Content>
                            <StringRows
                              addLabel="네트워크 추가"
                              ariaLabel="Compose 네트워크 이름"
                              onChange={(networks) =>
                                setSpec((current) => ({ ...current, networks }))
                              }
                              placeholder="frontend"
                              values={spec.networks}
                            />
                          </Fieldset.Content>
                        </Fieldset.Root>
                        <Fieldset.Root appearance="plain">
                          <Fieldset.Legend>이름 있는 볼륨</Fieldset.Legend>
                          <Fieldset.Description>
                            Docker가 관리하는 볼륨을 만듭니다.
                          </Fieldset.Description>
                          <Fieldset.Content>
                            <StringRows
                              addLabel="볼륨 추가"
                              ariaLabel="Compose 볼륨 이름"
                              onChange={(volumes) =>
                                setSpec((current) => ({ ...current, volumes }))
                              }
                              placeholder="app-data"
                              values={spec.volumes}
                            />
                          </Fieldset.Content>
                        </Fieldset.Root>
                      </div>
                      <div className="overseer-compose-services">
                        {spec.services.map((service, index) => (
                          <ServiceFields
                            index={index}
                            key={index}
                            onChange={(nextService) =>
                              setSpec((current) => ({
                                ...current,
                                services: current.services.map((item, itemIndex) =>
                                  itemIndex === index ? nextService : item,
                                ),
                              }))
                            }
                            onRemove={() =>
                              setSpec((current) => ({
                                ...current,
                                services: current.services.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              }))
                            }
                            service={service}
                          />
                        ))}
                        <Button
                          onClick={() =>
                            setSpec((current) => ({
                              ...current,
                              services: [
                                ...current.services,
                                emptyComposeBuilderService(current.services.length + 1),
                              ],
                            }))
                          }
                          type="button"
                          variant="outline"
                        >
                          <Plus aria-hidden="true" size={14} />
                          서비스 추가
                        </Button>
                      </div>
                    </Tabs.Panel>
                    <Tabs.Panel className="overseer-compose-builder-panel" value="yaml">
                      {previewIssues.length > 0 ? (
                        <Alert.Root tone="warning">
                          <Alert.Title level={3}>미완성된 입력이 있습니다.</Alert.Title>
                          <Alert.Description>
                            저장 전 폼 탭에서 {previewIssues.length}개 항목을 확인하십시오.
                          </Alert.Description>
                        </Alert.Root>
                      ) : null}
                      <pre className="overseer-compose-yaml-preview">
                        <code>{composeBuilderYaml(spec)}</code>
                      </pre>
                    </Tabs.Panel>
                  </Tabs.Root>
                )}
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={loading || submitting} type="submit">
                  {submitting ? "요청 중…" : projectName ? "변경사항 저장" : "Compose 저장"}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CreateBuilderComposeDialog({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (spec: ComposeBuilderSpec) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)} size="sm">
        <Plus aria-hidden="true" size={14} />
        폼으로 추가
      </Button>
      <BuilderComposeDialog
        onOpenChange={setOpen}
        onSubmit={(spec) => onSubmit(spec)}
        open={open}
      />
    </>
  );
}
