import { Alert } from "@opnay/city-ds-react/alert";
import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Checkbox } from "@opnay/city-ds-react/checkbox";
import { Combobox } from "@opnay/city-ds-react/combobox";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Input } from "@opnay/city-ds-react/input";
import { NumberField } from "@opnay/city-ds-react/number-field";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ContainerDetail,
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerSpecInput,
  ContainerSummary,
  ContainerVolumeMount,
  ImageSummary,
  NetworkSummary,
  VolumeSummary,
} from "../shared/contracts.ts";
import {
  containerSpecNeedsReplacement,
  emptyContainerSpec,
  validateContainerSpec,
  type ContainerSpecErrors,
} from "../shared/container-spec.ts";
import { ApiRequestError, apiRequest } from "./api.ts";

type StringOption = { label: string; value: string };

function SelectControl({
  ariaLabel,
  disabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: StringOption[];
  value: string;
}) {
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));
  return (
    <Select.Root
      disabled={disabled}
      items={items}
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
  disabled,
  max,
  min,
  onChange,
  placeholder,
  step = 1,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  max?: number;
  min: number;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  step?: number;
  value?: number;
}) {
  return (
    <NumberField.Root
      disabled={disabled}
      max={max}
      min={min}
      onValueChange={(nextValue) => onChange(nextValue ?? undefined)}
      step={step}
      value={value ?? null}
    >
      <NumberField.Group>
        <NumberField.Input aria-label={ariaLabel} placeholder={placeholder} />
        <NumberField.Decrement aria-label={`${ariaLabel} 감소`} />
        <NumberField.Increment aria-label={`${ariaLabel} 증가`} />
      </NumberField.Group>
    </NumberField.Root>
  );
}

function KeyValueRows({
  addLabel,
  disabled,
  keyLabel,
  onChange,
  valueLabel,
  values,
}: {
  addLabel: string;
  disabled?: boolean;
  keyLabel: string;
  onChange: (values: ContainerKeyValue[]) => void;
  valueLabel: string;
  values: ContainerKeyValue[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((entry, index) => (
        <div className="overseer-repeatable-row" key={index}>
          <Input
            aria-label={`${keyLabel} ${index + 1}`}
            disabled={disabled}
            onValueChange={(key) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, key } : item)),
              )
            }
            placeholder={keyLabel}
            value={entry.key}
          />
          <Input
            aria-label={`${valueLabel} ${index + 1}`}
            disabled={disabled}
            onValueChange={(value) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)),
              )
            }
            placeholder={valueLabel}
            value={entry.value}
          />
          <Button
            disabled={disabled}
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
        disabled={disabled}
        onClick={() => onChange([...values, { key: "", value: "" }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        {addLabel}
      </Button>
    </div>
  );
}

function CommandRows({
  disabled,
  onChange,
  values,
}: {
  disabled?: boolean;
  onChange: (values: string[]) => void;
  values: string[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((argument, index) => (
        <div className="overseer-repeatable-row overseer-repeatable-row-single" key={index}>
          <Input
            aria-label={`명령 인수 ${index + 1}`}
            disabled={disabled}
            onValueChange={(value) =>
              onChange(values.map((item, itemIndex) => (itemIndex === index ? value : item)))
            }
            placeholder={index === 0 ? "실행 파일 또는 명령" : "인수"}
            value={argument}
          />
          <Button
            disabled={disabled}
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
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        명령 인수 추가
      </Button>
    </div>
  );
}

function PortRows({
  disabled,
  onChange,
  values,
}: {
  disabled?: boolean;
  onChange: (values: ContainerPortMapping[]) => void;
  values: ContainerPortMapping[];
}) {
  return (
    <div className="overseer-repeatable-stack">
      {values.map((port, index) => (
        <div className="overseer-port-row" key={index}>
          <NumberControl
            ariaLabel={`컨테이너 포트 ${index + 1}`}
            disabled={disabled}
            max={65_535}
            min={1}
            onChange={(containerPort) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, containerPort: containerPort ?? 0 } : item,
                ),
              )
            }
            placeholder="80"
            value={port.containerPort || undefined}
          />
          <NumberControl
            ariaLabel={`호스트 포트 ${index + 1}`}
            disabled={disabled}
            max={65_535}
            min={1}
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
            placeholder="자동"
            value={port.hostPort}
          />
          <SelectControl
            ariaLabel={`프로토콜 ${index + 1}`}
            disabled={disabled}
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
            disabled={disabled}
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
        disabled={disabled}
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
  availableVolumes,
  disabled,
  onChange,
  values,
}: {
  availableVolumes: VolumeSummary[];
  disabled?: boolean;
  onChange: (values: ContainerVolumeMount[]) => void;
  values: ContainerVolumeMount[];
}) {
  const options = availableVolumes.map(({ name }) => ({ label: name, value: name }));
  return (
    <div className="overseer-repeatable-stack">
      {values.map((mount, index) => (
        <div className="overseer-volume-row" key={index}>
          <SelectControl
            ariaLabel={`볼륨 ${index + 1}`}
            disabled={disabled}
            onChange={(volume) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? { ...item, volume } : item)),
              )
            }
            options={options}
            value={mount.volume}
          />
          <Input
            aria-label={`컨테이너 경로 ${index + 1}`}
            disabled={disabled}
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
              aria-label={`볼륨 ${index + 1} 읽기 전용`}
              checked={mount.readOnly}
              disabled={disabled}
              onCheckedChange={(readOnly) =>
                onChange(
                  values.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, readOnly } : item,
                  ),
                )
              }
            />
            읽기 전용
          </label>
          <Button
            disabled={disabled}
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
        disabled={disabled || options.length === 0}
        onClick={() =>
          onChange([
            ...values,
            { containerPath: "", readOnly: false, volume: options[0]?.value ?? "" },
          ])
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" size={14} />
        볼륨 마운트 추가
      </Button>
    </div>
  );
}

function ContainerForm({
  detail,
  images,
  initialSpec,
  networks,
  onClose,
  onSubmit,
  title,
  volumes,
}: {
  detail?: ContainerDetail;
  images: ImageSummary[];
  initialSpec: ContainerSpecInput;
  networks: NetworkSummary[];
  onClose: () => void;
  onSubmit: (spec: ContainerSpecInput) => Promise<void>;
  title: string;
  volumes: VolumeSummary[];
}) {
  const [errors, setErrors] = useState<ContainerSpecErrors>({});
  const [pendingReplacement, setPendingReplacement] = useState<ContainerSpecInput>();
  const [spec, setSpec] = useState(initialSpec);
  const [submitting, setSubmitting] = useState(false);
  const immutableDisabled = Boolean(detail?.replacementBlockers.length);
  const imageOptions = images
    .filter(({ repository, tag }) => repository !== "<none>" && tag !== "<none>")
    .map(({ repository, tag }) => `${repository}:${tag}`);
  const networkOptions = networks.filter(({ name }) => name !== "host").map(({ name }) => name);

  const update = <Key extends keyof ContainerSpecInput>(
    key: Key,
    value: ContainerSpecInput[Key],
  ) => {
    setSpec((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const submitSpec = async (nextSpec: ContainerSpecInput) => {
    setSubmitting(true);
    try {
      await onSubmit(nextSpec);
      onClose();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        form:
          error instanceof ApiRequestError ? error.message : "컨테이너 작업을 시작하지 못했습니다.",
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateContainerSpec(spec);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    if (detail && containerSpecNeedsReplacement(detail.spec, spec)) {
      if (detail.replacementBlockers.length > 0) {
        setErrors({ form: `다시 만들 수 없습니다: ${detail.replacementBlockers.join(" ")}` });
        return;
      }
      setPendingReplacement(spec);
      return;
    }
    void submitSpec(spec);
  };

  return (
    <>
      <Dialog.Popup className="overseer-container-dialog" scroll="body" size="xl">
        <Dialog.Header>
          <div>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>
              필요한 설정만 입력하십시오. 포트는 127.0.0.1에만 공개됩니다.
            </Dialog.Description>
          </div>
        </Dialog.Header>
        <form onSubmit={handleSubmit}>
          <Dialog.Body className="overseer-container-form">
            {errors.form ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={3}>요청을 확인하십시오.</Alert.Title>
                <Alert.Description>{errors.form}</Alert.Description>
              </Alert.Root>
            ) : null}
            {immutableDisabled ? (
              <Alert.Root tone="warning">
                <Alert.Title level={3}>일부 설정은 읽기 전용입니다.</Alert.Title>
                <Alert.Description>{detail?.replacementBlockers.join(" ")}</Alert.Description>
              </Alert.Root>
            ) : null}

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>기본 설정</Fieldset.Legend>
              <Fieldset.Description>이미지와 컨테이너 식별 정보를 지정합니다.</Fieldset.Description>
              <Fieldset.Content className="overseer-form-section-grid">
                <Field.Root invalid={Boolean(errors.image)}>
                  <Field.Label>이미지</Field.Label>
                  <Input
                    aria-label="이미지"
                    autoFocus
                    disabled={immutableDisabled}
                    list="overseer-image-options"
                    onValueChange={(image) => update("image", image)}
                    placeholder="nginx:alpine"
                    value={spec.image}
                  />
                  <datalist id="overseer-image-options">
                    {imageOptions.map((image) => (
                      <option key={image} value={image} />
                    ))}
                  </datalist>
                  <Field.Error match>{errors.image}</Field.Error>
                </Field.Root>
                <Field.Root invalid={Boolean(errors.name)}>
                  <Field.Label>이름 {detail ? null : "(선택)"}</Field.Label>
                  <Input
                    aria-label="이름"
                    onValueChange={(name) => update("name", name || undefined)}
                    placeholder="web"
                    value={spec.name ?? ""}
                  />
                  <Field.Error match>{errors.name}</Field.Error>
                </Field.Root>
                <Field.Root invalid={Boolean(errors.hostname)}>
                  <Field.Label>Hostname (선택)</Field.Label>
                  <Input
                    aria-label="Hostname"
                    disabled={immutableDisabled}
                    onValueChange={(hostname) => update("hostname", hostname || undefined)}
                    placeholder="web.local"
                    value={spec.hostname ?? ""}
                  />
                  <Field.Error match>{errors.hostname}</Field.Error>
                </Field.Root>
                <Field.Root>
                  <Field.Label>이미지 받기 정책</Field.Label>
                  <SelectControl
                    ariaLabel="이미지 받기 정책"
                    disabled={immutableDisabled}
                    onChange={(pullPolicy) =>
                      update(
                        "pullPolicy",
                        pullPolicy === "always" || pullPolicy === "never" ? pullPolicy : "missing",
                      )
                    }
                    options={[
                      { label: "없을 때만 받기", value: "missing" },
                      { label: "항상 새로 받기", value: "always" },
                      { label: "받지 않기", value: "never" },
                    ]}
                    value={spec.pullPolicy}
                  />
                </Field.Root>
              </Fieldset.Content>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>명령</Fieldset.Legend>
              <Fieldset.Description>
                셸로 해석하지 않고 입력 순서대로 Docker에 전달합니다.
              </Fieldset.Description>
              <Fieldset.Content>
                <CommandRows
                  disabled={immutableDisabled}
                  onChange={(command) => update("command", command)}
                  values={spec.command}
                />
              </Fieldset.Content>
              <Fieldset.Error>{errors.command}</Fieldset.Error>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>연결</Fieldset.Legend>
              <Fieldset.Description>
                호스트 포트를 비워 두면 충돌 없는 포트를 자동 배정합니다.
              </Fieldset.Description>
              <Fieldset.Content className="overseer-fieldset-stack">
                <PortRows
                  disabled={immutableDisabled}
                  onChange={(ports) => update("ports", ports)}
                  values={spec.ports}
                />
                <Field.Root invalid={Boolean(errors.networks)}>
                  <Field.Label>네트워크</Field.Label>
                  <Combobox.Root
                    disabled={immutableDisabled}
                    items={networkOptions}
                    multiple
                    onValueChange={(selected) => update("networks", selected)}
                    value={spec.networks}
                  >
                    <Combobox.InputGroup>
                      <Combobox.Chips>
                        <Combobox.InputRow>
                          <Combobox.Input placeholder="네트워크 추가" />
                          <Combobox.Clear aria-label="모든 네트워크 제거" />
                          <Combobox.Trigger />
                        </Combobox.InputRow>
                        <Combobox.Value>
                          {(selected: string[]) =>
                            selected.map((network) => (
                              <Combobox.Chip key={network}>
                                {network}
                                <Combobox.ChipRemove aria-label={`${network} 제거`} />
                              </Combobox.Chip>
                            ))
                          }
                        </Combobox.Value>
                      </Combobox.Chips>
                    </Combobox.InputGroup>
                    <Combobox.Portal>
                      <Combobox.Positioner>
                        <Combobox.Popup>
                          <Combobox.Empty>사용 가능한 네트워크가 없습니다.</Combobox.Empty>
                          <Combobox.List>
                            {(network: string) => (
                              <Combobox.Item key={network} value={network}>
                                <Combobox.ItemIndicator />
                                {network}
                              </Combobox.Item>
                            )}
                          </Combobox.List>
                        </Combobox.Popup>
                      </Combobox.Positioner>
                    </Combobox.Portal>
                  </Combobox.Root>
                  <Field.Error match>{errors.networks}</Field.Error>
                </Field.Root>
              </Fieldset.Content>
              <Fieldset.Error>{errors.ports}</Fieldset.Error>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>데이터</Fieldset.Legend>
              <Fieldset.Description>
                Overseer에 등록된 named volume만 연결할 수 있습니다.
              </Fieldset.Description>
              <Fieldset.Content>
                <VolumeRows
                  availableVolumes={volumes}
                  disabled={immutableDisabled}
                  onChange={(nextVolumes) => update("volumes", nextVolumes)}
                  values={spec.volumes}
                />
              </Fieldset.Content>
              <Fieldset.Error>{errors.volumes}</Fieldset.Error>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>환경 변수</Fieldset.Legend>
              <Fieldset.Content>
                <KeyValueRows
                  addLabel="환경 변수 추가"
                  disabled={immutableDisabled}
                  keyLabel="환경 변수 이름"
                  onChange={(environment) => update("environment", environment)}
                  valueLabel="환경 변수 값"
                  values={spec.environment}
                />
              </Fieldset.Content>
              <Fieldset.Error>{errors.environment}</Fieldset.Error>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>실행 정책과 리소스</Fieldset.Legend>
              <Fieldset.Content className="overseer-form-section-grid">
                <Field.Root invalid={Boolean(errors.restartPolicy)}>
                  <Field.Label>재시작 정책</Field.Label>
                  <SelectControl
                    ariaLabel="재시작 정책"
                    onChange={(mode) =>
                      update("restartPolicy", {
                        mode:
                          mode === "always" || mode === "on-failure" || mode === "unless-stopped"
                            ? mode
                            : "no",
                      })
                    }
                    options={[
                      { label: "재시작하지 않음", value: "no" },
                      { label: "실패 시", value: "on-failure" },
                      { label: "항상", value: "always" },
                      { label: "직접 중지 전까지", value: "unless-stopped" },
                    ]}
                    value={spec.restartPolicy.mode}
                  />
                  <Field.Error match>{errors.restartPolicy}</Field.Error>
                </Field.Root>
                {spec.restartPolicy.mode === "on-failure" ? (
                  <Field.Root>
                    <Field.Label>최대 재시도 횟수 (선택)</Field.Label>
                    <NumberControl
                      ariaLabel="최대 재시도 횟수"
                      min={0}
                      onChange={(maximumRetryCount) =>
                        update("restartPolicy", { mode: "on-failure", maximumRetryCount })
                      }
                      value={spec.restartPolicy.maximumRetryCount}
                    />
                  </Field.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.cpus)}>
                  <Field.Label>CPU 수 (선택)</Field.Label>
                  <NumberControl
                    ariaLabel="CPU 수"
                    min={0.1}
                    onChange={(cpus) => update("resources", { ...spec.resources, cpus })}
                    step={0.1}
                    value={spec.resources.cpus}
                  />
                  <Field.Error match>{errors.cpus}</Field.Error>
                </Field.Root>
                <Field.Root invalid={Boolean(errors.memoryMiB)}>
                  <Field.Label>메모리 MiB (선택)</Field.Label>
                  <NumberControl
                    ariaLabel="메모리 MiB"
                    min={1}
                    onChange={(memoryMiB) => update("resources", { ...spec.resources, memoryMiB })}
                    value={spec.resources.memoryMiB}
                  />
                  <Field.Error match>{errors.memoryMiB}</Field.Error>
                </Field.Root>
              </Fieldset.Content>
            </Fieldset.Root>

            <Fieldset.Root appearance="plain">
              <Fieldset.Legend>메타데이터</Fieldset.Legend>
              <Fieldset.Content>
                <KeyValueRows
                  addLabel="Label 추가"
                  disabled={immutableDisabled}
                  keyLabel="Label 이름"
                  onChange={(labels) => update("labels", labels)}
                  valueLabel="Label 값"
                  values={spec.labels}
                />
              </Fieldset.Content>
              <Fieldset.Error>{errors.labels}</Fieldset.Error>
            </Fieldset.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close render={<Button type="button" variant="outline" />}>취소</Dialog.Close>
            <Button disabled={submitting} type="submit">
              {submitting ? "요청 중…" : detail ? "설정 저장" : "컨테이너 실행"}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Popup>

      {pendingReplacement ? (
        <AlertDialog.Root onOpenChange={(open) => !open && setPendingReplacement(undefined)} open>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>컨테이너를 다시 만드시겠습니까?</AlertDialog.Title>
                <AlertDialog.Description>
                  기존 쓰기 레이어는 삭제되며 named volume은 유지됩니다. 실패하면 기존 컨테이너를
                  자동 복구합니다.
                </AlertDialog.Description>
                <div className="overseer-dialog-actions">
                  <AlertDialog.Cancel render={<Button variant="outline" />}>
                    취소
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    onClick={() => void submitSpec(pendingReplacement)}
                    render={<Button />}
                  >
                    다시 만들어 저장
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </>
  );
}

export function RunContainerDialog({
  disabled,
  images,
  networks,
  onSubmit,
  volumes,
}: {
  disabled: boolean;
  images: ImageSummary[];
  networks: NetworkSummary[];
  onSubmit: (spec: ContainerSpecInput) => Promise<void>;
  volumes: VolumeSummary[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger disabled={disabled} render={<Button size="sm" variant="primary" />}>
        <Plus aria-hidden="true" size={15} />
        컨테이너 실행
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <ContainerForm
            images={images}
            initialSpec={emptyContainerSpec()}
            key={String(open)}
            networks={networks}
            onClose={() => setOpen(false)}
            onSubmit={onSubmit}
            title="컨테이너 실행"
            volumes={volumes}
          />
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function EditContainerDialog({
  container,
  images,
  networks,
  onClose,
  onSubmit,
  volumes,
}: {
  container?: ContainerSummary;
  images: ImageSummary[];
  networks: NetworkSummary[];
  onClose: () => void;
  onSubmit: (detail: ContainerDetail, spec: ContainerSpecInput) => Promise<void>;
  volumes: VolumeSummary[];
}) {
  const [detail, setDetail] = useState<ContainerDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!container) {
      setDetail(undefined);
      setError(undefined);
      return;
    }
    setDetail(undefined);
    setError(undefined);
    let active = true;
    void apiRequest<{ container: ContainerDetail }>(`/containers/${container.id}`)
      .then(({ container: nextDetail }) => active && setDetail(nextDetail))
      .catch(
        (loadError: unknown) =>
          active &&
          setError(loadError instanceof Error ? loadError.message : "설정을 불러오지 못했습니다."),
      );
    return () => {
      active = false;
    };
  }, [container]);

  return (
    <Dialog.Root onOpenChange={(open) => !open && onClose()} open={Boolean(container)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          {error ? (
            <Dialog.Popup size="sm">
              <Dialog.Title>설정을 불러오지 못했습니다.</Dialog.Title>
              <Dialog.Description>{error}</Dialog.Description>
              <Dialog.Footer>
                <Dialog.Close render={<Button variant="outline" />}>닫기</Dialog.Close>
              </Dialog.Footer>
            </Dialog.Popup>
          ) : detail ? (
            <ContainerForm
              detail={detail}
              images={images}
              initialSpec={detail.spec}
              networks={networks}
              onClose={onClose}
              onSubmit={(spec) => onSubmit(detail, spec)}
              title={`${container?.name} 설정`}
              volumes={volumes}
            />
          ) : (
            <Dialog.Popup size="sm">
              <Dialog.Title>컨테이너 설정</Dialog.Title>
              <Dialog.Description>Docker 설정을 읽고 있습니다.</Dialog.Description>
              <Dialog.Body className="overseer-form-stack">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </Dialog.Body>
            </Dialog.Popup>
          )}
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
