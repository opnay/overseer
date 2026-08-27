import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Menu } from "@opnay/city-ds-react/menu";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import type { ComposeProjectSummary } from "@contracts/contracts.ts";

export function RemoteComposeActions({
  busy,
  onApply,
  onCheck,
  onRemove,
  onUpdate,
  project,
}: {
  busy: boolean;
  onApply: () => Promise<void>;
  onCheck: () => Promise<void>;
  onRemove: () => Promise<void>;
  onUpdate: () => Promise<void>;
  project: ComposeProjectSummary;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  if (!project.remote) return null;

  return (
    <>
      <Menu.Root density="compact">
        <Menu.Trigger
          disabled={busy}
          render={
            <Button
              aria-label={`${project.name} URL Compose 관리 메뉴`}
              iconOnly
              size="sm"
              variant="ghost"
            />
          }
        >
          <Ellipsis aria-hidden="true" size={16} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6}>
            <Menu.Popup>
              <Menu.Item onClick={() => void onCheck().catch(() => undefined)}>
                업데이트 확인
              </Menu.Item>
              <Menu.Item
                disabled={!project.remote.updateAvailable}
                onClick={() => void onUpdate().catch(() => undefined)}
              >
                업데이트 적용
              </Menu.Item>
              <Menu.Item onClick={() => void onApply().catch(() => undefined)}>
                Compose 적용
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={() => setRemoveOpen(true)} variant="destructive">
                등록 해제
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {removeOpen ? (
        <AlertDialog.Root onOpenChange={setRemoveOpen} open>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>URL Compose 등록을 해제하시겠습니까?</AlertDialog.Title>
                <AlertDialog.Description>
                  SQLite의 URL과 compose.yaml을 제거합니다. named volume과 이미지는 유지되며 실행
                  중인 프로젝트는 먼저 내려야 합니다.
                </AlertDialog.Description>
                <div className="overseer-dialog-actions">
                  <AlertDialog.Cancel render={<Button variant="outline" />}>
                    취소
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    destructive
                    onClick={() => void onRemove().catch(() => undefined)}
                    render={<Button variant="destructive" />}
                  >
                    등록 해제
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
