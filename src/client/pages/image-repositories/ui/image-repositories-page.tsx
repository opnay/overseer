import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Cloud, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { AddImageRepositoryInput, ImageRepositorySummary } from "@contracts/contracts.ts";
import { normalizeImageRepository } from "@contracts/validation.ts";
import { ApiRequestError, apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { followLink } from "@/shared/lib/follow-link";
import { imageRepositoryDetailPath } from "@/shared/routes";
import { ConfirmAction } from "@/shared/ui/confirm-action";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function AddImageRepositoryDialog({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit(input: AddImageRepositoryInput): Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const repository = normalizeImageRepository(String(form.get("repository") ?? ""));
    if (!repository) {
      setError("저장소 주소는 Docker 이미지 이름과 같은 형식으로 입력하십시오.");
      return;
    }
    try {
      await onSubmit({ repository });
      setOpen(false);
    } catch (submitError) {
      setError(
        submitError instanceof ApiRequestError
          ? submitError.message
          : "이미지 저장소를 추가하지 못했습니다.",
      );
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setError(undefined);
      }}
      open={open}
    >
      <Dialog.Trigger disabled={busy} render={<Button size="sm" />}>
        <Plus aria-hidden="true" size={14} />
        저장소 추가
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="sm">
            <Dialog.Title>이미지 저장소 추가</Dialog.Title>
            <Dialog.Description>Docker 이미지 저장소 주소를 등록합니다.</Dialog.Description>
            <form onSubmit={submit}>
              <Dialog.Body className="overseer-form-stack">
                <Field.Root invalid={Boolean(error)}>
                  <Field.Label>
                    저장소 주소 <span aria-hidden="true">*</span>
                  </Field.Label>
                  <Input
                    aria-label="저장소 주소"
                    autoComplete="off"
                    autoFocus
                    name="repository"
                    onValueChange={() => setError(undefined)}
                    placeholder="ghcr.io/opnay/overseer"
                    required
                  />
                  <Field.Description>
                    nginx, namespace/name, registry.example.com/team/image 형식을 지원합니다.
                  </Field.Description>
                  <Field.Error match>{error}</Field.Error>
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button type="button" variant="outline" />}>
                  취소
                </Dialog.Close>
                <Button disabled={busy} type="submit">
                  <Plus aria-hidden="true" size={14} />
                  {busy ? "추가 중…" : "추가"}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ImageRepositoriesPage({
  isBusy,
  onInspect,
  onRemove,
  onSync,
  refreshToken,
}: {
  isBusy(repository: ImageRepositorySummary): boolean;
  onInspect(repository: ImageRepositorySummary): void;
  onRemove(repository: ImageRepositorySummary): Promise<void>;
  onSync(repository: ImageRepositorySummary): Promise<void>;
  refreshToken: string;
}) {
  const [error, setError] = useState<string>();
  const [repositories, setRepositories] = useState<ImageRepositorySummary[]>();
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setError(undefined);
    void apiRequest<{ repositories: ImageRepositorySummary[] }>("/image-repositories")
      .then(({ repositories: nextRepositories }) => {
        if (active) setRepositories(nextRepositories);
      })
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)));
    return () => {
      active = false;
    };
  }, [refreshToken, requestRevision]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>이미지 저장소를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
        <Alert.Action>
          <Button onClick={() => setRequestRevision((value) => value + 1)} size="sm">
            다시 시도
          </Button>
        </Alert.Action>
      </Alert.Root>
    );
  }

  if (!repositories) return <Skeleton className="overseer-loading-table" />;

  return (
    <section className="overseer-panel" id="image-repositories">
      <DataTableRegion label="이미지 저장소 표">
        <Table.Root aria-label="이미지 저장소 목록" className="overseer-table" size="sm">
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">저장소 주소</Table.Head>
              <Table.Head>태그</Table.Head>
              <Table.Head>마지막 동기화</Table.Head>
              <Table.Head aria-label="작업" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {repositories.length === 0 ? (
              <Table.StateRow colSpan={4}>
                <EmptyState.Root density="compact">
                  <EmptyState.Icon>
                    <Cloud aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>등록된 이미지 저장소가 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    저장소를 추가하면 태그 수와 마지막 동기화 시점을 관리할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              </Table.StateRow>
            ) : (
              repositories.map((repository) => (
                <Table.Row key={repository.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <a
                      className="overseer-detail-link"
                      href={imageRepositoryDetailPath(repository.id)}
                      onClick={(event) => followLink(event, () => onInspect(repository))}
                    >
                      {repository.repository}
                    </a>
                    {repository.official ? (
                      <Badge className="ml-2" size="sm" tone="info">
                        Official
                      </Badge>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>{repository.tagCount ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {repository.lastSyncedAt ? (
                      <time dateTime={repository.lastSyncedAt}>
                        {formatDateTime(repository.lastSyncedAt)}
                      </time>
                    ) : (
                      <Badge size="sm" tone="neutral">
                        동기화 필요
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      <Button
                        aria-label={`${repository.repository} 동기화`}
                        disabled={isBusy(repository)}
                        iconOnly
                        onClick={() => void onSync(repository).catch(() => undefined)}
                        size="sm"
                        variant="ghost"
                      >
                        <RefreshCw aria-hidden="true" size={14} />
                      </Button>
                      <ConfirmAction
                        actionLabel="저장소 제거"
                        ariaLabel={`${repository.repository} 저장소 제거`}
                        disabled={isBusy(repository)}
                        description="Overseer의 등록 정보만 제거하며 원격 저장소의 이미지는 변경하지 않습니다."
                        iconOnly
                        onConfirm={() => onRemove(repository)}
                        title={`${repository.repository} 저장소를 제거하시겠습니까?`}
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
