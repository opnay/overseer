import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Item } from "@opnay/city-ds-react/item";
import { ArrowRight, PackageCheck } from "lucide-react";
import type {
  DashboardSnapshot,
  OperationSnapshot,
  RuntimePhase,
  ToolUpdateId,
  UpdateDockerDaemonConfigurationSectionInput,
} from "@contracts/contracts.ts";
import { useUrlSection } from "@/shared/lib/url-section";
import { APP_SETTINGS_SECTIONS } from "@/shared/routes";
import { DockerDaemonSettings } from "./docker-daemon-settings.tsx";
import { ToolUpdatesSection } from "./tool-updates-section.tsx";

interface SettingsPageProps {
  busy: boolean;
  dashboard: DashboardSnapshot;
  onApplyDaemonConfiguration(input: UpdateDockerDaemonConfigurationSectionInput): Promise<void>;
  onCheckToolUpdates(): Promise<void>;
  onUpdateTool(id: ToolUpdateId): Promise<void>;
  refreshToken: string;
  toolOperation?: OperationSnapshot;
  toolRequestPending: boolean;
}

const settingsSections = APP_SETTINGS_SECTIONS.map(({ value }) => value);

const runtimeStatus: Record<
  RuntimePhase,
  { label: string; tone: "destructive" | "info" | "neutral" | "success" | "warning" }
> = {
  error: { label: "오류", tone: "destructive" },
  missing: { label: "설정 필요", tone: "neutral" },
  running: { label: "실행 중", tone: "success" },
  starting: { label: "준비 중", tone: "info" },
  stopped: { label: "중지됨", tone: "warning" },
  stopping: { label: "중지 중", tone: "info" },
};

export function SettingsPage({
  busy,
  dashboard,
  onApplyDaemonConfiguration,
  onCheckToolUpdates,
  onUpdateTool,
  refreshToken,
  toolOperation,
  toolRequestPending,
}: SettingsPageProps) {
  const [section] = useUrlSection({
    defaultValue: dashboard.runtime.phase === "running" ? "general" : "engine",
    values: settingsSections,
  });

  const status = runtimeStatus[dashboard.runtime.phase];

  return (
    <section className="overseer-settings" aria-label="설정">
      <div className="overseer-settings-panel">
        {section === "general" ? (
          <>
            <Item.Root
              appearance="outline"
              aria-labelledby="overseer-settings-startup"
              className="overseer-settings-general-section bg-city-surface-raised p-5"
              render={<section />}
            >
              <Item.Media
                aria-hidden="true"
                variant="icon"
                className="size-(--city-control-lg) rounded-city-sm bg-city-muted text-city-muted-foreground"
              >
                <PackageCheck size={18} strokeWidth={1.8} />
              </Item.Media>
              <Item.Content>
                <Item.Title
                  render={<h2 className="city-text-subsection-title" />}
                  id="overseer-settings-startup"
                >
                  시작 준비
                </Item.Title>
                <Item.Description>
                  필수 도구와 Docker Engine 준비 과정을 다시 확인합니다.
                </Item.Description>
              </Item.Content>
              <Item.Actions>
                <Button nativeButton={false} render={<a href="/startup" />} variant="outline">
                  시작 준비 열기
                  <ArrowRight aria-hidden="true" size={15} />
                </Button>
              </Item.Actions>
            </Item.Root>
            <ToolUpdatesSection
              onCheck={onCheckToolUpdates}
              onUpdate={onUpdateTool}
              operation={toolOperation}
              refreshToken={refreshToken}
              requestPending={toolRequestPending}
            />
          </>
        ) : null}

        {section !== "general" ? (
          <div className="overseer-settings-form">
            {section === "engine" ? (
              <>
                <section aria-label="Docker Engine 상태" className="overseer-settings-status">
                  <div>
                    <span>상태</span>
                    <strong className="overseer-settings-status-value">
                      <Badge dot size="sm" tone={status.tone} />
                      {status.label}
                    </strong>
                  </div>
                  <div>
                    <span>인스턴스</span>
                    <strong>{dashboard.runtime.instance}</strong>
                  </div>
                  <div>
                    <span>Docker</span>
                    <strong>{dashboard.runtime.dockerVersion ?? "-"}</strong>
                  </div>
                </section>

                <DockerDaemonSettings
                  busy={busy}
                  mode="engine"
                  onApply={onApplyDaemonConfiguration}
                  refreshToken={refreshToken}
                />
              </>
            ) : (
              <DockerDaemonSettings
                busy={busy}
                mode="network"
                onApply={onApplyDaemonConfiguration}
                refreshToken={refreshToken}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
