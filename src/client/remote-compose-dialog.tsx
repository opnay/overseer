import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Link2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { RegisterRemoteComposeInput } from "../shared/contracts.ts";
import { isComposeProjectName } from "../shared/validation.ts";
import { ApiRequestError } from "./api.ts";

function validPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}

export function RemoteComposeDialog({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (input: RegisterRemoteComposeInput) => Promise<void>;
}) {
  const [errors, setErrors] = useState<{ form?: string; name?: string; url?: string }>({});
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUrl = url.trim();
    const normalizedName = name.trim();
    const nextErrors: typeof errors = {};
    if (!validPublicHttpsUrl(normalizedUrl)) {
      nextErrors.url = "인증 정보가 없는 공개 HTTPS URL을 입력하십시오.";
    }
    if (normalizedName && !isComposeProjectName(normalizedName)) {
      nextErrors.name = "소문자·숫자로 시작하고 소문자·숫자·밑줄·하이픈만 사용하십시오.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        ...(normalizedName ? { name: normalizedName } : {}),
        url: normalizedUrl,
      });
      setOpen(false);
    } catch (error) {
      setErrors({
        form:
          error instanceof ApiRequestError
            ? error.message
            : "URL Compose 작업을 시작하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setErrors({});
          setName("");
          setUrl("");
        }
      }}
      open={open}
    >
      <Dialog.Trigger disabled={disabled} render={<Button size="sm" />}>
        <Link2 aria-hidden="true" size={14} />
        URL로 등록
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="md">
            <Dialog.Header>
              <div>
                <Dialog.Title>URL Compose 등록</Dialog.Title>
                <Dialog.Description>
                  공개 HTTPS 주소의 raw compose.yaml 내용을 SQLite에 저장합니다.
                </Dialog.Description>
              </div>
            </Dialog.Header>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                {errors.form ? (
                  <Alert.Root tone="destructive">
                    <Alert.Title level={3}>등록 요청을 시작하지 못했습니다.</Alert.Title>
                    <Alert.Description>{errors.form}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.url)}>
                  <Field.Label>
                    Compose URL <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    aria-label="Compose URL"
                    autoFocus
                    onValueChange={(value) => {
                      setUrl(value);
                      setErrors((current) => ({ ...current, url: undefined }));
                    }}
                    placeholder="https://raw.githubusercontent.com/owner/repo/main/compose.yaml"
                    required
                    type="url"
                    value={url}
                  />
                  <Field.Description>
                    GitHub Raw처럼 인증 없이 파일 내용이 바로 열리는 주소를 사용하십시오.
                  </Field.Description>
                  <Field.Error match>{errors.url}</Field.Error>
                </Field.Root>
                <Field.Root invalid={Boolean(errors.name)}>
                  <Field.Label>프로젝트 이름 (선택)</Field.Label>
                  <Input
                    aria-label="프로젝트 이름"
                    onValueChange={(value) => {
                      setName(value);
                      setErrors((current) => ({ ...current, name: undefined }));
                    }}
                    placeholder="비워 두면 URL에서 만듭니다"
                    value={name}
                  />
                  <Field.Description>
                    소문자·숫자·밑줄·하이픈만 사용할 수 있습니다.
                  </Field.Description>
                  <Field.Error match>{errors.name}</Field.Error>
                </Field.Root>
                <Alert.Root tone="warning">
                  <Alert.Title level={3}>build context는 실행할 수 없습니다.</Alert.Title>
                  <Alert.Description>
                    build가 포함된 파일도 등록되지만 로컬 소스가 없으므로 Compose 적용 작업은
                    실패합니다.
                  </Alert.Description>
                </Alert.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={submitting} type="submit">
                  {submitting ? "요청 중…" : "URL 등록"}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
