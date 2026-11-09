import { isTauri } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { pagePresentation } from "../model/page-presentation.ts";
import { useNavigationMode } from "../model/use-navigation-mode.ts";
import { useAppSession } from "../runtime/AppSession.tsx";
import { AppTopbar } from "./AppTopbar.tsx";

export function WindowFrame({ children }: { children: ReactNode }) {
  const { dashboard, startup, startupRoute, resourcePath, navigationSearch } = useAppSession();
  const navigationMode = useNavigationMode();
  const { currentRoute, settingsSection } = pagePresentation(
    resourcePath,
    navigationSearch,
    dashboard,
  );
  const minimal =
    startupRoute ||
    !startup ||
    startup.prerequisites.some(({ installed, required }) => required && !installed);
  return (
    <div className="overseer-window" data-native-window={isTauri() || undefined}>
      <AppTopbar
        navigationMode={navigationMode}
        currentPath={currentRoute.path}
        settingsSection={settingsSection}
        minimal={minimal}
      />
      {children}
    </div>
  );
}
