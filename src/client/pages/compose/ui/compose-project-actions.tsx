import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Menu } from "@opnay/city-ds-react/menu";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import type { ComposeBuilderInput, ComposeProjectSummary } from "@contracts/contracts.ts";
import { BuilderComposeDialog } from "./builder-compose-dialog.tsx";

type Confirmation = "delete" | "down";

export function ComposeProjectActions({
  busy,
  onApply,
  onBuilderUpdate,
  onCheck,
  onDelete,
  onDown,
  onRemoteUpdate,
  project,
}: {
  busy: boolean;
  onApply: () => Promise<void>;
  onBuilderUpdate: (input: ComposeBuilderInput, expectedConfigHash: string) => Promise<void>;
  onCheck: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDown: () => Promise<void>;
  onRemoteUpdate: () => Promise<void>;
  project: ComposeProjectSummary;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [editOpen, setEditOpen] = useState(false);
  const managed = Boolean(project.builder || project.remote);
  const running = project.status !== "blocked" && project.status !== "registered";

  const deleteDescription = project.remote
    ? "SQLite에 저장된 URL과 compose.yaml을 삭제하여 목록에서 제거합니다. named volume과 이미지는 유지됩니다."
    : "SQLite에 저장된 작성 설정과 compose.yaml을 삭제하여 목록에서 제거합니다. named volume과 이미지는 유지됩니다.";

  return (
    <>
      <Menu.Root density="compact">
        <Menu.Trigger
          disabled={busy}
          render={
            <Button
              aria-label={`${project.name} Compose 관리 메뉴`}
              iconOnly
              size="sm"
              variant="ghost"
            />
          }
        >
          <Ellipsis aria-hidden="true" size={16} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6}>
            <Menu.Popup>
              {project.builder ? (
                <Menu.Item onClick={() => setEditOpen(true)}>구성 편집</Menu.Item>
              ) : null}
              {project.remote ? (
                <>
                  <Menu.Item onClick={() => void onCheck().catch(() => undefined)}>
                    업데이트 확인
                  </Menu.Item>
                  <Menu.Item
                    disabled={!project.remote.updateAvailable}
                    onClick={() => void onRemoteUpdate().catch(() => undefined)}
                  >
                    업데이트 적용
                  </Menu.Item>
                </>
              ) : null}
              {managed ? (
                <Menu.Item onClick={() => void onApply().catch(() => undefined)}>
                  Compose 적용
                </Menu.Item>
              ) : null}
              {managed ? <Menu.Separator /> : null}
              <Menu.Item onClick={() => setConfirmation("down")}>Compose Down</Menu.Item>
              {managed ? (
                <Menu.Item
                  disabled={running}
                  onClick={() => setConfirmation("delete")}
                  variant="destructive"
                >
                  Compose 삭제
                </Menu.Item>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {project.builder ? (
        <BuilderComposeDialog
          onOpenChange={setEditOpen}
          onSubmit={(input, expectedConfigHash) => {
            if (!expectedConfigHash) throw new Error("Compose config hash를 찾을 수 없습니다.");
            return onBuilderUpdate(input, expectedConfigHash);
          }}
          open={editOpen}
          projectName={project.name}
        />
      ) : null}
      {confirmation ? (
        <AlertDialog.Root onOpenChange={(open) => !open && setConfirmation(undefined)} open>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Viewport>
              <AlertDialog.Popup>
                <AlertDialog.Title>
                  {confirmation === "down"
                    ? `${project.name} 프로젝트를 내리시겠습니까?`
                    : `${project.name} Compose를 삭제하시겠습니까?`}
                </AlertDialog.Title>
                <AlertDialog.Description>
                  {confirmation === "down"
                    ? "컨테이너와 기본 네트워크를 제거합니다. Compose 등록 정보, named volume과 이미지는 유지됩니다."
                    : deleteDescription}
                </AlertDialog.Description>
                <div className="overseer-dialog-actions">
                  <AlertDialog.Cancel render={<Button variant="outline" />}>
                    취소
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    destructive
                    onClick={() =>
                      void (confirmation === "down" ? onDown() : onDelete()).catch(() => undefined)
                    }
                    render={<Button variant="destructive" />}
                  >
                    {confirmation === "down" ? "Compose Down" : "Compose 삭제"}
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
