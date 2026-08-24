import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Progress } from "@opnay/city-ds-react/progress";
import { Activity, ListChecks, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { OperationSnapshot } from "../shared/contracts.ts";
import { operationElapsed, operationStatusPresentation } from "./operation-presentation.ts";

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
  compactTrigger = false,
  onCancel,
  onRetry,
  onViewAll,
  operations,
}: {
  compactTrigger?: boolean;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onViewAll: () => void;
  operations: OperationSnapshot[];
}) {
  const compact = useCompactDrawer();
  const side = compact ? "bottom" : "right";
  const visible = operations.filter(
    ({ status }) => status === "queued" || status === "running" || status === "failed",
  );
  const hasFailures = visible.some(({ status }) => status === "failed");

  return (
    <Drawer.Root modal={compact} swipeDirection={compact ? "down" : "right"}>
      <Drawer.Trigger
        render={
          <Button
            aria-label={
              compactTrigger ? `작업${visible.length > 0 ? ` ${visible.length}개` : ""}` : undefined
            }
            iconOnly={compactTrigger}
            size="sm"
            variant={compactTrigger ? "ghost" : "outline"}
          />
        }
      >
        <Activity aria-hidden="true" size={14} />
        {compactTrigger ? null : "작업"}
        {visible.length > 0 ? (
          <Badge
            className={compactTrigger ? "overseer-operation-trigger-count" : undefined}
            size="sm"
            tone={hasFailures ? "destructive" : "warning"}
          >
            {visible.length}
          </Badge>
        ) : null}
      </Drawer.Trigger>
      <Drawer.Portal>
        {compact ? <Drawer.Backdrop /> : null}
        <Drawer.Viewport side={side}>
          <Drawer.Popup side={side} size={compact ? "xl" : "md"}>
            <Drawer.Header>
              <div>
                <Drawer.Title>작업</Drawer.Title>
                <Drawer.Description>
                  대기·진행 중인 작업과 실패한 작업만 표시합니다.
                </Drawer.Description>
              </div>
              {!compact ? (
                <Drawer.Close render={<Button size="sm" variant="outline" />}>닫기</Drawer.Close>
              ) : null}
            </Drawer.Header>
            <Drawer.Body>
              {visible.length === 0 ? (
                <EmptyState.Root density="compact">
                  <EmptyState.Icon>
                    <ListChecks aria-hidden="true" />
                  </EmptyState.Icon>
                  <EmptyState.Title level={2}>확인할 작업이 없습니다.</EmptyState.Title>
                  <EmptyState.Description>
                    완료·취소 기록은 작업 페이지에서 확인할 수 있습니다.
                  </EmptyState.Description>
                </EmptyState.Root>
              ) : (
                <ol className="overseer-operation-list">
                  {visible.map((operation) => {
                    const presentation = operationStatusPresentation[operation.status];
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
                          <span>{operationElapsed(operation)}</span>
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
                        {operation.retryable ? (
                          <Button
                            onClick={() => void onRetry(operation.id).catch(() => undefined)}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcw aria-hidden="true" size={14} />
                            재시도
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Drawer.Body>
            <Drawer.Footer>
              <Drawer.Close
                onClick={onViewAll}
                render={<Button variant={compact ? "primary" : "outline"} />}
              >
                전체 작업 보기
              </Drawer.Close>
              {compact ? (
                <Drawer.Close render={<Button variant="outline" />}>닫기</Drawer.Close>
              ) : null}
            </Drawer.Footer>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
