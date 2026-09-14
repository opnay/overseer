import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Select } from "@opnay/city-ds-react/select";
import { Plus, ServerCog } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CreateRuntimeInstanceInput,
  DockerEngineConfigurationSnapshot,
  LimaVmType,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { RuntimeInstanceResourceFields } from "./runtime-instance-resource-fields.tsx";

const DEFAULT_CONFIGURATION: CreateRuntimeInstanceInput["configuration"] = {
  cpus: 4,
  diskGiB: 100,
  memoryGiB: 4,
  provider: "lima",
  vmType: "vz",
};

interface RuntimeInstanceCreateDialogProps {
  busy: boolean;
  onSubmit(input: CreateRuntimeInstanceInput): Promise<void>;
  refreshToken: string;
}

export function RuntimeInstanceCreateDialog({
  busy,
  onSubmit,
  refreshToken,
}: RuntimeInstanceCreateDialogProps) {
  const [snapshot, setSnapshot] = useState<DockerEngineConfigurationSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIGURATION);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoadError(undefined);
    void apiRequest<DockerEngineConfigurationSnapshot>("/runtime/configuration")
      .then((next) => active && setSnapshot(next))
      .catch(
        (error: unknown) =>
          active &&
          setLoadError(
            error instanceof Error ? error.message : "VM 생성 설정을 불러오지 못했습니다.",
          ),
      );
    return () => {
      active = false;
    };
  }, [refreshToken]);

  const submit = async () => {
    setFormError(undefined);
    try {
      await onSubmit({ configuration, name });
      setOpen(false);
      setName("");
      setConfiguration(DEFAULT_CONFIGURATION);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "인스턴스를 만들지 못했습니다.");
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setConfiguration(DEFAULT_CONFIGURATION);
          setFormError(undefined);
          setName("");
        }
      }}
      open={open}
    >
      <Dialog.Trigger
        disabled={busy || !snapshot}
        render={<Button size="sm" type="button" />}
        title={loadError}
      >
        <Plus aria-hidden="true" size={14} />
        인스턴스 만들기
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup scroll="body" size="md">
            <Dialog.Header>
              <Dialog.Title>VM 인스턴스 만들기</Dialog.Title>
              <Dialog.Description>
                선택한 드라이버와 자원으로 Lima VM을 만듭니다.
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
                <div className="overseer-settings-grid">
                  <Field.Root>
                    <Field.Label>실행 환경</Field.Label>
                    <Input aria-label="실행 환경" disabled value="Lima VM" />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>VM 드라이버</Field.Label>
                    <Select.Root
                      items={Object.fromEntries(
                        (snapshot?.vmTypes ?? []).map(({ label, value }) => [value, label]),
                      )}
                      onValueChange={(value) =>
                        value &&
                        setConfiguration((current) => ({
                          ...current,
                          vmType: String(value) as LimaVmType,
                        }))
                      }
                      value={configuration.vmType}
                    >
                      <Select.Trigger aria-label="VM 드라이버">
                        <Select.Value />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Positioner>
                          <Select.Popup>
                            <Select.List>
                              {snapshot?.vmTypes.map((option) => (
                                <Select.Item
                                  disabled={!option.available}
                                  key={option.value}
                                  value={option.value}
                                >
                                  <Select.ItemIndicator />
                                  <Select.ItemText>{option.label}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.List>
                          </Select.Popup>
                        </Select.Positioner>
                      </Select.Portal>
                    </Select.Root>
                  </Field.Root>
                </div>
                <RuntimeInstanceResourceFields
                  configuration={configuration}
                  onChange={(resources) =>
                    setConfiguration((current) => ({ ...current, ...resources }))
                  }
                />
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
              <Button disabled={busy || !name.trim()} onClick={() => void submit()} type="button">
                <ServerCog aria-hidden="true" size={14} />
                인스턴스 만들기
              </Button>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
