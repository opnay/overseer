import type { DockerCliPluginId, OperationSnapshot } from "@contracts/contracts.ts";
export interface DockerPluginBulkUpdate {
  ids: DockerCliPluginId[];
  index: number;
  operationId: string;
}

export interface DockerPluginBulkUpdateResult {
  completed: number;
  status: "cancelled" | "failed" | "succeeded";
  trackingLost?: boolean;
}

export interface DockerPluginUpdates {
  update(id: DockerCliPluginId): Promise<OperationSnapshot>;
  updateAll(ids: DockerCliPluginId[]): Promise<void>;
  resetResult(): void;
  bulkOperation?: OperationSnapshot;
  bulkUpdate?: DockerPluginBulkUpdate;
  bulkResult?: DockerPluginBulkUpdateResult;
}
