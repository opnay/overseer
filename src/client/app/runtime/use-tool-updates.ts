import { apiRequest } from "@/shared/api";
import type {
  DockerCliPluginId,
  OperationAccepted,
  OperationSnapshot,
} from "@contracts/contracts.ts";
import { useEffect, useRef, useState } from "react";

import type { DockerPluginBulkUpdate, DockerPluginBulkUpdateResult } from "@/pages/docker-plugins";
import type { OperationMutation } from "@/shared/api";
import type { Dispatch, SetStateAction } from "react";
export function useToolUpdates({
  operations,
  mutate,
  loadOperations,
  setKeepPolling,
}: {
  operations: OperationSnapshot[];
  mutate(options: OperationMutation): Promise<void>;
  loadOperations(): Promise<OperationSnapshot[] | undefined>;
  setKeepPolling: Dispatch<SetStateAction<boolean>>;
}) {
  const [dockerPluginBulkUpdate, setDockerPluginBulkUpdate] = useState<DockerPluginBulkUpdate>();
  const [dockerPluginBulkResult, setDockerPluginBulkResult] =
    useState<DockerPluginBulkUpdateResult>();
  const handledDockerPluginBulkOperations = useRef(new Set<string>());
  const checkingDockerPluginBulkOperationId = useRef<string | undefined>(undefined);
  const dockerPluginBulkOperation = dockerPluginBulkUpdate
    ? operations.find(({ id }) => id === dockerPluginBulkUpdate.operationId)
    : undefined;
  const updateDockerPlugin = async (id: DockerCliPluginId): Promise<OperationSnapshot> => {
    let acceptedOperation: OperationSnapshot | undefined;
    await mutate({
      key: `docker-plugin-update-${id}`,
      onAccepted: (operation) => {
        acceptedOperation = operation;
      },
      request: () =>
        apiRequest<OperationAccepted>(`/docker-cli/plugins/${id}/update`, { method: "POST" }),
    });
    if (!acceptedOperation) throw new Error("작업 응답을 확인하지 못했습니다.");
    return acceptedOperation;
  };
  const updateAllDockerPlugins = async (ids: DockerCliPluginId[]) => {
    if (ids.length === 0) return;

    setDockerPluginBulkResult(undefined);
    handledDockerPluginBulkOperations.current.clear();
    const firstOperation = await updateDockerPlugin(ids[0]!);
    setDockerPluginBulkUpdate({ ids, index: 0, operationId: firstOperation.id });
  };
  const resetDockerPluginBulkResult = () => setDockerPluginBulkResult(undefined);
  useEffect(() => {
    const bulkUpdate = dockerPluginBulkUpdate;
    if (!bulkUpdate) {
      checkingDockerPluginBulkOperationId.current = undefined;
      return;
    }

    const operation = dockerPluginBulkOperation;
    if (!operation) {
      if (checkingDockerPluginBulkOperationId.current === bulkUpdate.operationId) return;
      checkingDockerPluginBulkOperationId.current = bulkUpdate.operationId;
      void loadOperations().then((latestOperations) => {
        if (checkingDockerPluginBulkOperationId.current !== bulkUpdate.operationId) return;
        if (!latestOperations) {
          checkingDockerPluginBulkOperationId.current = undefined;
          return;
        }
        if (latestOperations.some(({ id }) => id === bulkUpdate.operationId)) {
          checkingDockerPluginBulkOperationId.current = undefined;
          return;
        }
        checkingDockerPluginBulkOperationId.current = undefined;
        setDockerPluginBulkResult({
          completed: bulkUpdate.index,
          status: "failed",
          trackingLost: true,
        });
        setDockerPluginBulkUpdate((current) =>
          current?.operationId === bulkUpdate.operationId ? undefined : current,
        );
      });
      return;
    }

    checkingDockerPluginBulkOperationId.current = undefined;
    if (operation.status === "queued" || operation.status === "running") return;
    if (handledDockerPluginBulkOperations.current.has(operation.id)) return;
    handledDockerPluginBulkOperations.current.add(operation.id);

    if (operation.status !== "succeeded") {
      setDockerPluginBulkResult({
        completed: bulkUpdate.index,
        status: operation.status === "cancelled" ? "cancelled" : "failed",
      });
      setDockerPluginBulkUpdate(undefined);
      return;
    }

    const nextIndex = bulkUpdate.index + 1;
    if (nextIndex === bulkUpdate.ids.length) {
      setDockerPluginBulkResult({ completed: bulkUpdate.ids.length, status: "succeeded" });
      setDockerPluginBulkUpdate(undefined);
      return;
    }

    const currentOperationId = bulkUpdate.operationId;
    const nextId = bulkUpdate.ids[nextIndex]!;
    void updateDockerPlugin(nextId)
      .then((nextOperation) => {
        setDockerPluginBulkUpdate((current) =>
          current?.operationId === currentOperationId
            ? { ...current, index: nextIndex, operationId: nextOperation.id }
            : current,
        );
      })
      .catch(() => {
        setDockerPluginBulkResult({ completed: nextIndex, status: "failed" });
        setDockerPluginBulkUpdate((current) =>
          current?.operationId === currentOperationId ? undefined : current,
        );
      });
  }, [
    dockerPluginBulkOperation,
    dockerPluginBulkUpdate,
    loadOperations,
    operations,
    updateDockerPlugin,
  ]);
  useEffect(() => {
    setKeepPolling(Boolean(dockerPluginBulkUpdate));
  }, [Boolean(dockerPluginBulkUpdate), setKeepPolling]);
  return {
    update: updateDockerPlugin,
    updateAll: updateAllDockerPlugins,
    resetResult: resetDockerPluginBulkResult,
    bulkOperation: dockerPluginBulkOperation,
    bulkUpdate: dockerPluginBulkUpdate,
    bulkResult: dockerPluginBulkResult,
  };
}
