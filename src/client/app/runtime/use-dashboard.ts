import { apiRequest } from "@/shared/api";
import type {
  ComposeProjectSummary,
  ContainerSummary,
  DashboardSnapshot,
  ImageSummary,
  NetworkSummary,
  OperationResource,
  VolumeSummary,
} from "@contracts/contracts.ts";
import { useCallback, useEffect, useState } from "react";

function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}

export function useDashboard(refreshStartup: () => Promise<void>) {
  const [dashboard, setDashboard] = useState<DashboardSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoadError(undefined);
    try {
      setDashboard(await apiRequest<DashboardSnapshot>("/dashboard"));
    } catch (error) {
      setLoadError(actionError(error));
    }
  }, []);
  const refreshResource = useCallback(
    async (resource: OperationResource) => {
      try {
        if (resource === "startup") {
          await Promise.all([refreshStartup(), refresh(true)]);
          return;
        }
        if (resource === "runtime") {
          await refresh(true);
          return;
        }
        if (resource === "dockerPlugin" || resource === "imageRepository") return;
        if (resource === "compose") {
          const { projects } = await apiRequest<{ projects: ComposeProjectSummary[] }>(
            "/compose/projects",
          );
          setDashboard((current) =>
            current ? { ...current, composeProjects: projects } : current,
          );
          return;
        }
        if (resource === "container") {
          const { containers } = await apiRequest<{ containers: ContainerSummary[] }>(
            "/containers",
          );
          setDashboard((current) => (current ? { ...current, containers } : current));
          return;
        }
        if (resource === "image") {
          const { images } = await apiRequest<{ images: ImageSummary[] }>("/images");
          setDashboard((current) => (current ? { ...current, images } : current));
          return;
        }
        if (resource === "volume") {
          const { volumes } = await apiRequest<{ volumes: VolumeSummary[] }>("/volumes");
          setDashboard((current) => (current ? { ...current, volumes } : current));
          return;
        }
        const { networks } = await apiRequest<{ networks: NetworkSummary[] }>("/networks");
        setDashboard((current) => (current ? { ...current, networks } : current));
      } catch (error) {
        setLoadError(actionError(error));
      }
    },
    [refresh, refreshStartup],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { dashboard, loadError, refresh, refreshResource };
}
