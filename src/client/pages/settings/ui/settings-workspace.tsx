import { apiRequest, useOperationClient } from "@/shared/api";
import type {
  DashboardSnapshot,
  OperationAccepted,
  UpdateDockerDaemonConfigurationSectionInput,
} from "@contracts/contracts.ts";
import { SettingsPage } from "./settings-page.tsx";

export function SettingsWorkspace({
  dashboard,
  runtimeBusy,
  refreshToken,
}: {
  dashboard: DashboardSnapshot | undefined;
  runtimeBusy: boolean;
  refreshToken: string;
}) {
  const { mutate, submitting } = useOperationClient();
  const settingsRefreshToken = refreshToken;
  const applyDockerDaemonConfiguration = (input: UpdateDockerDaemonConfigurationSectionInput) => {
    const { section, ...body } = input;
    return mutate({
      key: `runtime-daemon-configure-${section}`,
      request: () =>
        apiRequest<OperationAccepted>(`/runtime/engine/configuration/${section}`, {
          body: JSON.stringify(body),
          method: "PATCH",
        }),
    });
  };

  return dashboard ? (
    <SettingsPage
      busy={runtimeBusy || Boolean(submitting)}
      dashboard={dashboard}
      onApplyDaemonConfiguration={applyDockerDaemonConfiguration}
      refreshToken={settingsRefreshToken}
    />
  ) : null;
}
