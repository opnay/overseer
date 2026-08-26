import { Button } from "@opnay/city-ds-react/button";
import { CircleStop, Play, Wrench } from "lucide-react";
import type {
  DeleteRuntimeInstanceInput,
  RuntimeInstanceSummary,
  UpdateRuntimeInstanceInput,
} from "@contracts/contracts.ts";
import { RuntimeInstanceActions } from "./runtime-instance-actions.tsx";

export interface RuntimeInstanceHeaderState {
  instance: RuntimeInstanceSummary;
  selectionLocked: boolean;
}

export function RuntimeInstanceHeaderActions({
  busy,
  instance,
  onDelete,
  onPrepare,
  onSelect,
  onStart,
  onStop,
  onUpdate,
  selectionLocked,
}: RuntimeInstanceHeaderState & {
  busy: boolean;
  onDelete(name: string, input: DeleteRuntimeInstanceInput): Promise<void>;
  onPrepare(name: string): Promise<void>;
  onSelect(name: string): Promise<void>;
  onStart(name: string): Promise<void>;
  onStop(name: string): Promise<void>;
  onUpdate(name: string, input: UpdateRuntimeInstanceInput): Promise<void>;
}) {
  const running = instance.status.toLowerCase() === "running";

  return (
    <div className="overseer-instance-header-actions">
      {!instance.prepared && instance.compatible ? (
        <Button
          disabled={busy || selectionLocked}
          onClick={() => void onPrepare(instance.name).catch(() => undefined)}
          size="sm"
          variant="outline"
        >
          <Wrench aria-hidden="true" size={14} />
          사용 준비
        </Button>
      ) : null}
      {instance.compatible ? (
        running ? (
          <Button
            aria-label={`${instance.name} 인스턴스 중지`}
            disabled={busy}
            onClick={() => void onStop(instance.name).catch(() => undefined)}
            size="sm"
            variant="outline"
          >
            <CircleStop aria-hidden="true" size={14} />
            중지
          </Button>
        ) : (
          <Button
            aria-label={`${instance.name} 인스턴스 시작`}
            disabled={busy}
            onClick={() => void onStart(instance.name).catch(() => undefined)}
            size="sm"
          >
            <Play aria-hidden="true" size={14} />
            시작
          </Button>
        )
      ) : null}
      <RuntimeInstanceActions
        busy={busy}
        instance={instance}
        onDelete={onDelete}
        onSelect={onSelect}
        onUpdate={onUpdate}
        selectionLocked={selectionLocked}
      />
    </div>
  );
}
