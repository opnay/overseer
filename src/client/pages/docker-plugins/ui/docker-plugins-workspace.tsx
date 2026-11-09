import { apiRequest, useOperationClient } from "@/shared/api";
import type { DockerCliPluginId, OperationAccepted } from "@contracts/contracts.ts";
import type { DockerPluginUpdates } from "../model/plugin-updates.ts";
import { DockerCliPluginsPage } from "./docker-cli-plugins-page.tsx";

export function DockerPluginsWorkspace({
  refreshToken,
  updates,
}: {
  refreshToken: string;
  updates: DockerPluginUpdates;
}) {
  const { mutate, submitting, operations } = useOperationClient();
  const activeOperations = operations.filter(
    ({ status }) => status === "queued" || status === "running",
  );
  const dockerPluginOperationRefreshToken = operations
    .filter(
      ({ target, status }) =>
        target.resource === "dockerPlugin" && status !== "queued" && status !== "running",
    )
    .map(({ id, status }) => `${id}:${status}`)
    .join("|");

  const installDockerPlugin = (id: DockerCliPluginId) =>
    mutate({
      key: `docker-plugin-install-${id}`,
      request: () =>
        apiRequest<OperationAccepted>(`/docker-cli/plugins/${id}/install`, {
          method: "POST",
        }),
    });
  const checkDockerPluginUpdates = () =>
    mutate({
      key: "docker-plugin-update-check",
      request: () =>
        apiRequest<OperationAccepted>("/docker-cli/plugins/updates/check", { method: "POST" }),
    });

  return (
    <DockerCliPluginsPage
      busy={
        Boolean(submitting) ||
        activeOperations.some(
          ({ kind }) => kind.startsWith("docker.plugin.") || kind.startsWith("startup."),
        )
      }
      onCheck={checkDockerPluginUpdates}
      onClearBulkResult={updates.resetResult}
      onInstall={installDockerPlugin}
      onUpdate={updates.update}
      onUpdateAll={updates.updateAll}
      operation={operations.find(({ target }) => target.resource === "dockerPlugin")}
      bulkOperation={updates.bulkOperation}
      bulkProgress={
        updates.bulkUpdate
          ? {
              currentId: updates.bulkUpdate.ids[updates.bulkUpdate.index]!,
              index: updates.bulkUpdate.index,
              total: updates.bulkUpdate.ids.length,
            }
          : undefined
      }
      bulkResult={updates.bulkResult}
      refreshToken={`${refreshToken}:${dockerPluginOperationRefreshToken}`}
    />
  );
}
