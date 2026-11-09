import { apiRequest, useOperationClient } from "@/shared/api";
import type { OperationAccepted } from "@contracts/contracts.ts";
import { OperationsPage } from "./operations-page.tsx";

export function OperationsWorkspace({
  refreshToken,
  category,
}: {
  refreshToken: string;
  category: "all" | "lima" | "docker-cli";
}) {
  const { submitting, mutate } = useOperationClient();

  const retryOperation = (id: string) =>
    mutate({
      key: `operation-retry-${id}`,
      request: () =>
        apiRequest<OperationAccepted>(`/operations/${encodeURIComponent(id)}/retry`, {
          method: "POST",
        }),
    });

  return (
    <OperationsPage
      category={category}
      key={category}
      busyId={submitting?.startsWith("operation-retry-") ? submitting.slice(16) : undefined}
      onRetry={retryOperation}
      refreshToken={refreshToken}
    />
  );
}
