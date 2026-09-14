import { Alert } from "@opnay/city-ds-react/alert";
import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Field } from "@opnay/city-ds-react/field";
import { Input } from "@opnay/city-ds-react/input";
import { Menu } from "@opnay/city-ds-react/menu";
import { Ellipsis, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  DeleteRuntimeInstanceInput,
  RuntimeInstanceResources,
  RuntimeInstanceSummary,
  UpdateRuntimeInstanceInput,
} from "@contracts/contracts.ts";
import { RuntimeInstanceResourceFields } from "./runtime-instance-resource-fields.tsx";

function instanceResources(instance: RuntimeInstanceSummary): RuntimeInstanceResources | undefined {
  const configuration = instance.configuration;
  if (!configuration) return undefined;
  return {
    cpus: configuration.cpus,
    diskGiB: configuration.diskGiB,
    memoryGiB: configuration.memoryGiB,
  };
}

function resourcesEqual(
  left: RuntimeInstanceResources | undefined,
  right: RuntimeInstanceResources | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.cpus === right.cpus &&
    left.diskGiB === right.diskGiB &&
    left.memoryGiB === right.memoryGiB,
  );
}

export function RuntimeInstanceActions({
  busy,
  instance,
  onDelete,
  onForceStop,
  onSelect,
  onUpdate,
  selectionLocked,
}: {
  busy: boolean;
  instance: RuntimeInstanceSummary;
  onDelete(name: string, input: DeleteRuntimeInstanceInput): Promise<void>;
  onForceStop(name: string): Promise<void>;
  onSelect(name: string): Promise<void>;
  onUpdate(name: string, input: UpdateRuntimeInstanceInput): Promise<void>;
  selectionLocked: boolean;
}) {
  const initialResources = instanceResources(instance);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forceStopOpen, setForceStopOpen] = useState(false);
  const [resources, setResources] = useState(initialResources);
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string>();
  const editable = instance.managed && Boolean(initialResources);
  const deletable = instance.managed && !(selectionLocked && instance.active);
  const unavailableReason = !instance.managed
    ? "Overseer 관리 대상 아님"
    : selectionLocked && instance.active
      ? "환경 변수로 고정됨"
      : undefined;

  const openEdit = () => {
    setResources(instanceResources(instance));
    setFormError(undefined);
    setEditOpen(true);
  };

  const update = async () => {
    if (!resources) return;
    setFormError(undefined);
    try {
      await onUpdate(instance.name, { configuration: resources });
      setEditOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "인스턴스를 수정하지 못했습니다.");
    }
  };

  return (
    <>
      <Menu.Root density="compact">
        <Menu.Trigger
          disabled={busy}
          render={
            <Button
              aria-label={`${instance.name} 인스턴스 메뉴`}
              iconOnly
              size="sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Ellipsis aria-hidden="true" size={16} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6}>
            <Menu.Popup>
              <Menu.Item
                disabled={instance.active || !instance.prepared || selectionLocked}
                onClick={() => void onSelect(instance.name).catch(() => undefined)}
              >
                {instance.active ? "현재 Docker Engine으로 사용 중" : "Docker Engine으로 사용"}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item disabled={!editable} onClick={openEdit}>
                수정
              </Menu.Item>
              {instance.status.toLowerCase() === "broken" ? (
                <>
                  <Menu.Separator />
                  <Menu.Item onClick={() => setForceStopOpen(true)} variant="destructive">
                    강제 중지
                  </Menu.Item>
                </>
              ) : null}
              <Menu.Separator />
              <Menu.Item
                disabled={!deletable}
                onClick={() => setDeleteOpen(true)}
                variant="destructive"
              >
                삭제
              </Menu.Item>
              {unavailableReason ? (
                <>
                  <Menu.Separator />
                  <Menu.Item disabled>{unavailableReason}</Menu.Item>
                </>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root onOpenChange={setEditOpen} open={editOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup scroll="body" size="md">
              <Dialog.Header>
                <Dialog.Title>{instance.name} 인스턴스 수정</Dialog.Title>
                <Dialog.Description>
                  CPU·메모리·디스크를 변경합니다. 실행 중이면 VM을 중지하고 수정한 뒤 다시
                  시작합니다.
                </Dialog.Description>
              </Dialog.Header>
              <Dialog.Body>
                <div className="overseer-instance-create-form">
                  {resources ? (
                    <RuntimeInstanceResourceFields
                      configuration={resources}
                      minimumDiskGiB={initialResources?.diskGiB}
                      onChange={setResources}
                    />
                  ) : null}
                  {formError ? (
                    <Alert.Root tone="destructive">
                      <Alert.Title level={3}>인스턴스를 수정하지 못했습니다.</Alert.Title>
                      <Alert.Description>{formError}</Alert.Description>
                    </Alert.Root>
                  ) : null}
                </div>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Close render={<Button variant="outline" />}>취소</Dialog.Close>
                <Button
                  disabled={busy || !resources || resourcesEqual(resources, initialResources)}
                  onClick={() => void update()}
                  type="button"
                >
                  <Save aria-hidden="true" size={14} />
                  저장
                </Button>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      {forceStopOpen ? (
        <AlertDialog.Root onOpenChange={setForceStopOpen} open>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>
                  {instance.name} 인스턴스를 강제로 중지하시겠습니까?
                </AlertDialog.Title>
                <AlertDialog.Description>
                  응답하지 않는 VM 프로세스를 정리합니다. VM과 디스크는 삭제하지 않지만 실행 중인
                  작업은 즉시 중단될 수 있습니다.
                </AlertDialog.Description>
                <div className="overseer-dialog-actions">
                  <AlertDialog.Cancel render={<Button variant="outline" />}>
                    취소
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    destructive
                    disabled={busy}
                    onClick={() => void onForceStop(instance.name).catch(() => undefined)}
                    render={<Button variant="destructive" />}
                  >
                    강제 중지
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}

      {deleteOpen ? (
        <AlertDialog.Root
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) setConfirmation("");
          }}
          open
        >
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>{instance.name} 인스턴스를 삭제하시겠습니까?</AlertDialog.Title>
                <AlertDialog.Description>
                  VM 내부의 컨테이너·이미지·볼륨·네트워크가 모두 삭제됩니다. 호스트의 Compose 등록
                  정보와 작업 기록은 유지됩니다.
                  {instance.active ? " 활성 Docker Engine 연결도 해제됩니다." : ""}
                </AlertDialog.Description>
                <Field.Root>
                  <Field.Label>인스턴스 이름 확인</Field.Label>
                  <Input
                    aria-label="인스턴스 이름 확인"
                    autoComplete="off"
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={instance.name}
                    value={confirmation}
                  />
                  <Field.Description>위 인스턴스 이름을 정확히 입력하십시오.</Field.Description>
                </Field.Root>
                <div className="overseer-dialog-actions">
                  <AlertDialog.Cancel render={<Button variant="outline" />}>
                    취소
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    destructive
                    disabled={busy || confirmation !== instance.name}
                    onClick={() =>
                      void onDelete(instance.name, { confirmation }).catch(() => undefined)
                    }
                    render={<Button variant="destructive" />}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    삭제
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
