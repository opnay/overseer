import type {
  OperationAccepted,
  OperationResource,
  OperationSnapshot,
} from "@contracts/contracts.ts";
import { createContext, useContext, type ReactNode } from "react";

export interface OperationMutation {
  key: string;
  onAccepted?: (operation: OperationSnapshot) => void;
  request: () => Promise<OperationAccepted>;
}

export interface OperationClient {
  operations: OperationSnapshot[];
  submitting?: string;
  mutate(options: OperationMutation): Promise<void>;
  setSubmitting(key: string | undefined): void;
  setError(error: string | undefined): void;
}

const Context = createContext<OperationClient | undefined>(undefined);

export function OperationClientProvider({
  value,
  children,
}: {
  value: OperationClient;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOperationClient() {
  const client = useContext(Context);
  if (!client) throw new Error("OperationClientProvider가 필요합니다.");
  const active = client.operations.filter(
    ({ status }) => status === "queued" || status === "running",
  );
  return {
    ...client,
    targetBusy: (resource: OperationResource, identifier: string) =>
      active.some(
        ({ target }) =>
          target.resource === resource && (target.id === identifier || target.name === identifier),
      ),
  };
}
