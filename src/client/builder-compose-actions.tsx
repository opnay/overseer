import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Menu } from "@opnay/city-ds-react/menu";
import { useState } from "react";
import type { ComposeBuilderSpec, ComposeProjectSummary } from "../shared/contracts.ts";
import { BuilderComposeDialog } from "./builder-compose-dialog.tsx";

export function BuilderComposeActions({
  busy,
  onApply,
  onRemove,
  onUpdate,
  project,
}: {
  busy: boolean;
  onApply: () => Promise<void>;
  onRemove: () => Promise<void>;
  onUpdate: (spec: ComposeBuilderSpec, expectedConfigHash: string) => Promise<void>;
  project: ComposeProjectSummary;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  if (!project.builder) return null;

  return (
    <>
      <Menu.Root density="compact">
        <Menu.Trigger disabled={busy} render={<Button size="sm" variant="ghost" />}>
          폼 관리
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6}>
            <Menu.Popup>
              <Menu.Item onClick={() => setEditOpen(true)}>구성 편집</Menu.Item>
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
      <BuilderComposeDialog
        onOpenChange={setEditOpen}
        onSubmit={(spec, expectedConfigHash) => {
          if (!expectedConfigHash) throw new Error("Compose config hash를 찾을 수 없습니다.");
          return onUpdate(spec, expectedConfigHash);
        }}
        open={editOpen}
        projectName={project.name}
      />
      {removeOpen ? (
        <AlertDialog.Root onOpenChange={setRemoveOpen} open>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>폼 Compose 등록을 해제하시겠습니까?</AlertDialog.Title>
                <AlertDialog.Description>
                  SQLite의 폼 설정과 생성된 compose.yaml을 제거합니다. named volume과 이미지는
                  유지되며 실행 중인 프로젝트는 먼저 내려야 합니다.
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
