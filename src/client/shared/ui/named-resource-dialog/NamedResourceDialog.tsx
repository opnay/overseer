import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { isResourceName } from "@contracts/validation.ts";
import { ApiRequestError } from "@/shared/api";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function NamedResourceDialog({
  busy,
  description,
  disabled,
  label,
  onSubmit,
  placeholder,
}: {
  busy: boolean;
  description: string;
  disabled: boolean;
  label: "네트워크" | "볼륨";
  onSubmit: (name: string) => Promise<void>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; name?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!isResourceName(name)) {
      setErrors({ name: "영문·숫자로 시작하고 점·밑줄·하이픈만 사용하십시오." });
      return;
    }
    try {
      await onSubmit(name);
      setOpen(false);
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.code === "invalid_name") {
        setErrors({ name: submitError.message });
        return;
      }
      setErrors({ form: errorMessage(submitError) });
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setErrors({});
      }}
      open={open}
    >
      <Dialog.Trigger disabled={disabled} render={<Button size="sm" variant="primary" />}>
        <Plus aria-hidden="true" size={15} />
        {label} 만들기
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="sm">
            <Dialog.Title>{label} 만들기</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                {errors.form ? (
                  <Alert.Root tone="destructive">
                    <Alert.Title level={3}>{label}을 만들지 못했습니다.</Alert.Title>
                    <Alert.Description>{errors.form}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.name)}>
                  <Field.Label>
                    이름 <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    autoFocus
                    name="name"
                    onValueChange={() => setErrors((current) => ({ ...current, name: undefined }))}
                    placeholder={placeholder}
                    required
                  />
                  <Field.Description>
                    영문·숫자로 시작하고 점·밑줄·하이픈을 사용할 수 있습니다.
                  </Field.Description>
                  <Field.Error match>{errors.name}</Field.Error>
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={busy} type="submit">
                  {busy ? "만드는 중…" : `${label} 만들기`}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
