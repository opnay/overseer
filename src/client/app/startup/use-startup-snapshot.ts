import { apiRequest } from "@/shared/api";
import type { StartupSnapshot } from "@contracts/contracts.ts";
import { useCallback, useEffect, useRef, useState } from "react";

const STARTUP_REFRESH_FEEDBACK_MS = 500;
function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function useStartupSnapshot(startupRoute: boolean) {
  const [startup, setStartup] = useState<StartupSnapshot>();
  const [startupError, setStartupError] = useState<string>();
  const [startupRefreshing, setStartupRefreshing] = useState(false);
  const startupLoaded = useRef(false);
  const startupRefreshQueued = useRef(false);
  const startupRefreshInFlight = useRef(false);
  const refreshStartup = useCallback(async () => {
    if (startupRefreshInFlight.current) {
      startupRefreshQueued.current = true;
      return;
    }
    do {
      startupRefreshQueued.current = false;
      startupRefreshInFlight.current = true;
      const showFeedback = startupLoaded.current;
      if (showFeedback) setStartupRefreshing(true);
      setStartupError(undefined);
      const startedAt = Date.now();
      try {
        setStartup(await apiRequest<StartupSnapshot>("/startup"));
      } catch (error) {
        setStartupError(actionError(error));
      } finally {
        const remaining = STARTUP_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
        if (showFeedback && remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        startupLoaded.current = true;
        startupRefreshInFlight.current = false;
        if (showFeedback) setStartupRefreshing(false);
      }
    } while (startupRefreshQueued.current);
  }, []);
  useEffect(() => {
    void refreshStartup();
  }, [refreshStartup, startupRoute]);
  return { startup, startupError, startupRefreshing, refreshStartup };
}
