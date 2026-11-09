import { apiRequest } from "@/shared/api";
import type {
  OperationAccepted,
  OperationResource,
  OperationSnapshot,
} from "@contracts/contracts.ts";
import { toast } from "@opnay/city-ds-react/toast";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OperationMutation } from "@/shared/api";
function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function useOperations(
  refreshResource: (resource: OperationResource) => Promise<void>,
  keepPolling: boolean,
) {
  const [operationError, setOperationError] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);
  const notifiedOperations = useRef(new Set<string>());
  const operationsInitialized = useRef(false);
  const loadOperations = useCallback(async () => {
    try {
      const result = await apiRequest<{ operations: OperationSnapshot[] }>("/operations");
      const nextOperations = Array.isArray(result.operations) ? result.operations : [];
      if (!operationsInitialized.current) {
        for (const operation of nextOperations) {
          if (operation.status !== "queued" && operation.status !== "running") {
            notifiedOperations.current.add(operation.id);
          }
        }
        operationsInitialized.current = true;
      }
      setOperations(nextOperations);
      return nextOperations;
    } catch (error) {
      setOperationError(actionError(error));
      return undefined;
    }
  }, []);
  const hasActiveOperations = operations.some(
    ({ status }) => status === "queued" || status === "running",
  );
  const shouldPollOperations = hasActiveOperations || keepPolling;
  const operationsRefreshToken = operations
    .map(({ id, status, step }) => `${id}:${status}:${step}`)
    .join("|");
  const mutate = async ({ key, onAccepted, request }: OperationMutation) => {
    setSubmitting(key);
    setOperationError(undefined);
    try {
      const { operation } = await request();
      if (!operation) throw new Error("작업 응답을 확인하지 못했습니다.");
      setOperations((current) => [operation, ...current.filter(({ id }) => id !== operation.id)]);
      onAccepted?.(operation);
      toast.info("작업을 시작했습니다.", {
        description: operation.title,
        id: `operation-${operation.id}-started`,
        testId: `operation-${operation.id}-started`,
      });
    } catch (error) {
      const message = actionError(error);
      setOperationError(message);
      throw error;
    } finally {
      setSubmitting(undefined);
    }
  };
  const cancelOperation = async (id: string) => {
    try {
      const { operation } = await apiRequest<{ operation: OperationSnapshot }>(
        `/operations/${id}`,
        { method: "DELETE" },
      );
      setOperations((current) =>
        current.map((candidate) => (candidate.id === operation.id ? operation : candidate)),
      );
    } catch (error) {
      setOperationError(actionError(error));
      await loadOperations();
    }
  };
  const retryOperation = (id: string) =>
    mutate({
      key: `operation-retry-${id}`,
      request: () =>
        apiRequest<OperationAccepted>(`/operations/${encodeURIComponent(id)}/retry`, {
          method: "POST",
        }),
    });
  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);
  useEffect(() => {
    if (!shouldPollOperations) return;
    const interval = window.setInterval(() => void loadOperations(), 1_000);
    return () => window.clearInterval(interval);
  }, [shouldPollOperations, loadOperations]);
  useEffect(() => {
    for (const operation of operations) {
      if (
        operation.status === "queued" ||
        operation.status === "running" ||
        notifiedOperations.current.has(operation.id)
      ) {
        continue;
      }
      notifiedOperations.current.add(operation.id);
      if (operation.status === "succeeded") {
        toast.success("작업을 완료했습니다.", {
          description: operation.successMessage,
          id: `operation-${operation.id}-succeeded`,
          testId: `operation-${operation.id}-succeeded`,
        });
        const resources = new Set<OperationResource>([operation.target.resource]);
        if (operation.kind === "container.create" || operation.kind === "container.update") {
          resources.add("image");
        }
        if (operation.target.resource === "compose") {
          resources.add("container");
          resources.add("image");
          resources.add("network");
        }
        for (const resource of resources) void refreshResource(resource);
      } else if (operation.status === "failed") {
        toast.warning("작업이 실패했습니다.", {
          description: operation.error?.message ?? "작업을 완료하지 못했습니다.",
          id: `operation-${operation.id}-failed`,
          testId: `operation-${operation.id}-failed`,
        });
        if (operation.target.resource === "runtime" || operation.target.resource === "startup") {
          void refreshResource(operation.target.resource);
        }
      }
    }
  }, [operations, refreshResource]);
  return {
    operations,
    operationError,
    submitting,
    setSubmitting,
    setOperationError,
    mutate,
    cancelOperation,
    retryOperation,
    loadOperations,
    operationsRefreshToken,
  };
}
