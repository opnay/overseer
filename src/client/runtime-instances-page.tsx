import type {
  CreateRuntimeInstanceInput,
  DeleteRuntimeInstanceInput,
  UpdateRuntimeInstanceInput,
} from "../shared/contracts.ts";
import { RuntimeInstancesSettings } from "./runtime-instances-settings.tsx";

export interface RuntimeInstanceMutationProps {
  busy: boolean;
  onCreate(input: CreateRuntimeInstanceInput): Promise<void>;
  onDelete(name: string, input: DeleteRuntimeInstanceInput): Promise<void>;
  onPrepare(name: string): Promise<void>;
  onSelect(name: string): Promise<void>;
  onStart(name: string): Promise<void>;
  onStop(name: string): Promise<void>;
  onUpdate(name: string, input: UpdateRuntimeInstanceInput): Promise<void>;
  refreshToken: string;
}

export function RuntimeInstancesPage({
  busy,
  onDelete,
  onOpenDetail,
  onPrepare,
  onSelect,
  onStart,
  onStop,
  onUpdate,
  refreshToken,
}: Omit<RuntimeInstanceMutationProps, "onCreate"> & { onOpenDetail(name: string): void }) {
  return (
    <div className="overseer-runtime-instances-page">
      <RuntimeInstancesSettings
        busy={busy}
        onDelete={onDelete}
        onOpenDetail={onOpenDetail}
        onPrepare={onPrepare}
        onSelect={onSelect}
        onStart={onStart}
        onStop={onStop}
        onUpdate={onUpdate}
        refreshToken={refreshToken}
      />
    </div>
  );
}
