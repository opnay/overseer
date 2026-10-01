import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { ArrowRight, PackageCheck } from "lucide-react";
import type {
  DashboardSnapshot,
  OperationSnapshot,
  RuntimePhase,
  ToolUpdateId,
  UpdateDockerDaemonConfigurationSectionInput,
} from "@contracts/contracts.ts";
import { useUrlSection } from "@/shared/lib/url-section";
import {
  SectionedWorkspace,
  useWorkspaceNavigation,
  type SectionedWorkspaceGroup,
} from "@/shared/ui/sectioned-workspace";
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

type SettingsSection = "engine" | "general" | "network";
const settingsSections: SettingsSection[] = ["general", "engine", "network"];

const settingsNavigation = [
  {
    items: [{ label: "일반", value: "general" }],
    label: "Overseer",
  },
  {
    items: [
      { label: "엔진 설정", value: "engine" },
      { label: "네트워크 설정", value: "network" },
    ],
    label: "Docker Engine",
  },
] satisfies ReadonlyArray<SectionedWorkspaceGroup<SettingsSection>>;

const sectionPresentation: Record<
  SettingsSection,
  { category: string; description: string; title: string }
> = {
  engine: {
    category: "Docker Engine",
    description: "활성 Docker Engine의 상태와 동작을 관리합니다.",
    title: "엔진 설정",
  },
  general: {
    category: "Overseer",
    description: "Overseer의 기본 동작을 관리합니다.",
    title: "일반",
  },
  network: {
    category: "Docker Engine",
    description: "Docker Engine의 네트워크와 외부 연결을 구성합니다.",
    title: "네트워크 설정",
  },
};

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
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: dashboard.runtime.phase === "running" ? "general" : "engine",
    values: settingsSections,
  });

  const status = runtimeStatus[dashboard.runtime.phase];
  const presentation = sectionPresentation[section];
  const navigation = useWorkspaceNavigation();
  const groups = navigation?.enabled
    ? settingsNavigation.filter(({ label }) =>
        section === "general" ? label === "Overseer" : label === "Docker Engine",
      )
    : settingsNavigation;

  return (
    <section className="overseer-settings" aria-label="설정">
      <SectionedWorkspace<SettingsSection>
        category={presentation.category}
        description={presentation.description}
        getSectionHref={getSectionHref}
        groups={groups}
        navigationLabel="설정 상세 메뉴"
        onSectionChange={setSection}
        section={section}
        title={presentation.title}
      >
        <div className="overseer-settings-panel">
          {section === "general" ? (
            <>
              <section
                aria-labelledby="overseer-settings-startup"
                className="overseer-settings-general-section"
              >
                <div className="overseer-settings-general-copy">
                  <span aria-hidden="true">
                    <PackageCheck size={18} strokeWidth={1.8} />
                  </span>
                  <div>
                    <h3 className="city-text-subsection-title" id="overseer-settings-startup">
                      시작 준비
                    </h3>
                    <p>필수 도구와 Docker Engine 준비 과정을 다시 확인합니다.</p>
                  </div>
                </div>
                <Button nativeButton={false} render={<a href="/startup" />} variant="outline">
                  시작 준비 열기
                  <ArrowRight aria-hidden="true" size={15} />
                </Button>
              </section>
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
      </SectionedWorkspace>
    </section>
  );
}
