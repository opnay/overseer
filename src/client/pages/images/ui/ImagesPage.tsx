import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Table } from "@opnay/city-ds-react/table";
import { Download, HardDrive, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ImageSummary } from "@contracts/contracts.ts";
import { isImageReference } from "@contracts/validation.ts";
import { ApiRequestError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { followLink } from "@/shared/lib/follow-link";
import { imageDetailPath } from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { imageDisplayReference } from "../lib/image-presentation.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function PullImageDialog({
  busy,
  disabled,
  onSubmit,
}: {
  busy: boolean;
  disabled: boolean;
  onSubmit: (image: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; image?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const form = new FormData(event.currentTarget);
    const image = String(form.get("image") ?? "").trim();
    if (!isImageReference(image)) {
      setErrors({ image: "유효한 레지스트리 경로와 이미지 태그를 입력하십시오." });
      return;
    }
    try {
      await onSubmit(image);
      setOpen(false);
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.code === "invalid_image") {
        setErrors({ image: submitError.message });
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
        <Download aria-hidden="true" size={15} />
        이미지 받기
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="sm">
            <Dialog.Title>이미지 받기</Dialog.Title>
            <Dialog.Description>표준 OCI/Docker 이미지 경로를 입력하십시오.</Dialog.Description>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                {errors.form ? (
                  <Alert.Root tone="destructive">
                    <Alert.Title level={3}>이미지를 받지 못했습니다.</Alert.Title>
                    <Alert.Description>{errors.form}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root invalid={Boolean(errors.image)}>
                  <Field.Label>
                    이미지 <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    autoFocus
                    name="image"
                    onValueChange={() => setErrors((current) => ({ ...current, image: undefined }))}
                    placeholder="alpine:latest"
                    required
                  />
                  <Field.Error match>{errors.image}</Field.Error>
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={busy} type="submit">
                  {busy ? "받는 중…" : "이미지 받기"}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ImagesPage({
  images,
  isBusy,
  onInspect,
  onRemove,
}: {
  images: ImageSummary[];
  isBusy: (image: ImageSummary) => boolean;
  onInspect: (image: ImageSummary) => void;
  onRemove: (image: ImageSummary) => void;
}) {
  return (
    <DataTableRegion
      className="overseer-data-table-region"
      hint="모든 열을 보려면 표를 가로로 스크롤하십시오."
      label="이미지 표"
    >
      <Table.Root
        aria-label="이미지 목록"
        className="overseer-table overseer-table--images"
        size="sm"
      >
        <Table.Caption className="overseer-table-caption">
          Lima overseer 인스턴스의 로컬 이미지
        </Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head className="overseer-table-column-wide">이미지</Table.Head>
            <Table.Head>플랫폼</Table.Head>
            <Table.Head>이미지 ID</Table.Head>
            <Table.Head>생성</Table.Head>
            <Table.Head>크기</Table.Head>
            <Table.Head className="overseer-actions-column">작업</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {images.length === 0 ? (
            <Table.StateRow colSpan={6}>
              <EmptyState.Root className="overseer-table-empty-state" density="compact">
                <EmptyState.Icon>
                  <HardDrive aria-hidden="true" />
                </EmptyState.Icon>
                <EmptyState.Title level={2}>로컬 이미지가 없습니다.</EmptyState.Title>
                <EmptyState.Description>
                  필요한 이미지를 먼저 받을 수 있습니다.
                </EmptyState.Description>
              </EmptyState.Root>
            </Table.StateRow>
          ) : (
            images.map((image) => (
              <Table.Row key={`${image.id}-${image.repository}-${image.tag}`}>
                <Table.Cell className="overseer-table-column-wide">
                  <div className="overseer-primary-cell">
                    <a
                      className="overseer-detail-link"
                      href={imageDetailPath(image.id)}
                      onClick={(event) => followLink(event, () => onInspect(image))}
                    >
                      {imageDisplayReference(image)}
                    </a>
                    <div className="overseer-primary-meta">
                      <code>{image.url}</code>
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.platform}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{image.id}</code>
                </Table.Cell>
                <Table.Cell>
                  <time dateTime={image.createdAt}>{formatDateTime(image.createdAt)}</time>
                </Table.Cell>
                <Table.Cell>{image.size}</Table.Cell>
                <Table.Cell>
                  <div className="overseer-row-actions">
                    <ConfirmAction
                      actionLabel="이미지 삭제"
                      ariaLabel={`${imageDisplayReference(image)} 이미지 삭제`}
                      disabled={isBusy(image)}
                      description="이 이미지를 사용하는 컨테이너가 있으면 삭제되지 않습니다."
                      onConfirm={() => onRemove(image)}
                      iconOnly
                      title={`${imageDisplayReference(image)} 이미지를 삭제하시겠습니까?`}
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
  );
}
