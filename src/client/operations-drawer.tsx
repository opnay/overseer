import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Progress } from "@opnay/city-ds-react/progress";
import { Activity, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import type { OperationSnapshot, OperationStatus } from "../shared/contracts.ts";

const statusPresentation: Record<
  OperationStatus,
  { label: string; tone: "destructive" | "neutral" | "success" | "warning" }
> = {
  cancelled: { label: "취소됨", tone: "neutral" },
  failed: { label: "실패", tone: "destructive" },
  queued: { label: "대기 중", tone: "warning" },
  running: { label: "진행 중", tone: "warning" },
  succeeded: { label: "완료", tone: "success" },
};

function elapsed(operation: OperationSnapshot): string {
  const start = new Date(operation.startedAt ?? operation.createdAt).getTime();
  const end = operation.finishedAt ? new Date(operation.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function useCompactDrawer(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 48rem)");
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return compact;
}

export function OperationsDrawer({
  onCancel,
  operations,
}: {
  onCancel: (id: string) => Promise<void>;
  operations: OperationSnapshot[];
}) {
  const compact = useCompactDrawer();
  const side = compact ? "bottom" : "right";
  const active = operations.filter(({ status }) => status === "queued" || status === "running");

  return (
    <Drawer.Root modal={compact} swipeDirection={compact ? "down" : "right"}>
      <Drawer.Trigger render={<Button size="sm" variant="outline" />}>
        <Activity aria-hidden="true" size={14} />
        작업
        {active.length > 0 ? <Badge size="sm">{active.length}</Badge> : null}
      </Drawer.Trigger>
      <Drawer.Portal>
        {compact ? <Drawer.Backdrop /> : null}
        <Drawer.Viewport side={side}>
          <Drawer.Popup side={side} size={compact ? "xl" : "md"}>
            <Drawer.Header>
              <div>
                <Drawer.Title>작업</Drawer.Title>
                <Drawer.Description>
                  진행 중인 Docker 작업과 최근 결과입니다. 서버를 재시작하면 기록이 초기화됩니다.
                </Drawer.Description>
              </div>
              {!compact ? (
                <Drawer.Close render={<Button size="sm" variant="outline" />}>닫기</Drawer.Close>
              ) : null}
            </Drawer.Header>
            <Drawer.Body>
              {operations.length === 0 ? (
                <EmptyState.Root density="compact">
                  <EmptyState.Icon>
                    <ListChecks aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>작업 기록이 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    생성·수정·삭제 작업을 시작하면 여기에 표시됩니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              ) : (
                <ol className="overseer-operation-list">
                  {operations.map((operation) => {
                    const presentation = statusPresentation[operation.status];
                    const activeOperation =
                      operation.status === "queued" || operation.status === "running";
                    return (
                      <li className="overseer-operation-item" key={operation.id}>
                        <div className="overseer-operation-heading">
                          <div>
                            <strong>{operation.title}</strong>
                            <span>{operation.target.name}</span>
                          </div>
                          <Badge size="sm" tone={presentation.tone}>
                            {presentation.label}
                          </Badge>
                        </div>
                        {activeOperation ? (
                          <Progress.Root
                            aria-label={`${operation.title} ${presentation.label}`}
                            size="sm"
                            value={null}
                          >
                            <Progress.Track>
                              <Progress.Indicator />
                            </Progress.Track>
                          </Progress.Root>
                        ) : null}
                        <div className="overseer-operation-meta">
                          <span>{operation.step}</span>
                          <span>{elapsed(operation)}</span>
                        </div>
                        {operation.error ? (
                          <p className="overseer-operation-error">{operation.error.message}</p>
                        ) : null}
                        {operation.output.length > 0 ? (
                          <pre className="overseer-operation-output">
                            <code>{operation.output.slice(-12).join("\n")}</code>
                          </pre>
                        ) : null}
                        {operation.status === "queued" ? (
                          <Button
                            onClick={() => void onCancel(operation.id)}
                            size="sm"
                            variant="ghost"
                          >
                            대기 작업 취소
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Drawer.Body>
            {compact ? (
              <Drawer.Footer>
                <Drawer.Close render={<Button variant="outline" />}>닫기</Drawer.Close>
              </Drawer.Footer>
            ) : null}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
