import { OperationClientProvider } from "@/shared/api";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useAppLocation } from "../routing/use-app-location.ts";
import { usePageRefresh } from "../routing/use-page-refresh.ts";
import { useStartupSnapshot } from "../startup/use-startup-snapshot.ts";
import { useDashboard } from "./use-dashboard.ts";
import { useOperations } from "./use-operations.ts";
import { useToolUpdates } from "./use-tool-updates.ts";
function useSessionState() {
  const [imageView, setImageView] = useState<"id" | "tag">("tag");
  const navigation = useAppLocation();
  const startup = useStartupSnapshot(navigation.startupRoute);
  const dashboard = useDashboard(startup.refreshStartup);
  const [keepPolling, setKeepPolling] = useState(false);
  const operations = useOperations(dashboard.refreshResource, keepPolling);
  const pluginUpdates = useToolUpdates({
    operations: operations.operations,
    mutate: operations.mutate,
    loadOperations: operations.loadOperations,
    setKeepPolling,
  });
  const revisions = usePageRefresh(navigation.resourcePath, operations.operations);
  return {
    ...navigation,
    ...startup,
    ...dashboard,
    ...operations,
    ...revisions,
    pluginUpdates,
    imageView,
    setImageView,
  };
}
const Context = createContext<ReturnType<typeof useSessionState> | undefined>(undefined);
export function AppSessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionState();
  return (
    <Context.Provider value={session}>
      <OperationClientProvider
        value={{
          operations: session.operations,
          submitting: session.submitting,
          mutate: session.mutate,
          setSubmitting: session.setSubmitting,
          setError: session.setOperationError,
        }}
      >
        {children}
      </OperationClientProvider>
    </Context.Provider>
  );
}
export function useAppSession() {
  const session = useContext(Context);
  if (!session) throw new Error("AppSessionProvider가 필요합니다.");
  return session;
}
