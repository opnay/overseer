import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const WorkspaceNavigationContext = createContext<{
  enabled: boolean;
  target: HTMLDivElement | null;
  setTarget(target: HTMLDivElement | null): void;
} | null>(null);

export function WorkspaceNavigationProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ enabled, target, setTarget }), [enabled, target]);

  return (
    <WorkspaceNavigationContext.Provider value={value}>
      {children}
    </WorkspaceNavigationContext.Provider>
  );
}

export function WorkspaceNavigationOutlet({ hidden }: { hidden?: boolean }) {
  const navigation = useContext(WorkspaceNavigationContext);
  return (
    <div
      className="overseer-workspace-navigation-outlet"
      hidden={hidden}
      ref={navigation?.setTarget}
    />
  );
}

export function useWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext);
}
