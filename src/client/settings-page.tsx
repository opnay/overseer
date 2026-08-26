import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Field } from "@opnay/city-ds-react/field";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ArrowRight, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  CreateRuntimeInstanceInput,
  DashboardSnapshot,
  DockerEngineConfigurationSnapshot,
  LimaVmType,
  OperationSnapshot,
  RuntimePhase,
  ToolUpdateId,
  UpdateDockerDaemonConfigurationSectionInput,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import { DockerDaemonSettings } from "./docker-daemon-settings.tsx";
import {
  configurationToForm,
  type DockerEngineConfigurationForm,
} from "./docker-engine-configuration.ts";
import { RuntimeInstancesSettings } from "./runtime-instances-settings.tsx";
import { ToolUpdatesSection } from "./tool-updates-section.tsx";

interface SettingsPageProps {
  busy: boolean;
  dashboard: DashboardSnapshot;
  onApplyDaemonConfiguration(input: UpdateDockerDaemonConfigurationSectionInput): Promise<void>;
  onCheckToolUpdates(): Promise<void>;
  onCreateInstance(input: CreateRuntimeInstanceInput): Promise<void>;
  onPrepareInstance(name: string): Promise<void>;
  onSelectInstance(name: string): Promise<void>;
  onStartInstance(name: string): Promise<void>;
  onStopInstance(name: string): Promise<void>;
  onUpdateTool(id: ToolUpdateId): Promise<void>;
  refreshToken: string;
  toolOperation?: OperationSnapshot;
  toolRequestPending: boolean;
}

type SettingsSection = "engine" | "general" | "instances" | "network";

const sectionPresentation: Record<
  SettingsSection,
  { category: string; description: string; title: string }
> = {
  engine: {
    category: "Docker Engine",
    description: "활성 Docker Engine의 상태와 동작을 관리합니다.",
    title: "엔진 설정",
  },
  instances: {
    category: "Docker Engine",
    description: "Lima 인스턴스를 발견하고 활성 Docker Engine을 선택합니다.",
    title: "인스턴스 설정",
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
  onCreateInstance,
  onPrepareInstance,
  onSelectInstance,
  onStartInstance,
  onStopInstance,
  onUpdateTool,
  refreshToken,
  toolOperation,
  toolRequestPending,
}: SettingsPageProps) {
  const [snapshot, setSnapshot] = useState<DockerEngineConfigurationSnapshot>();
  const [form, setForm] = useState<DockerEngineConfigurationForm>();
  const [loadError, setLoadError] = useState<string>();
  const [section, setSection] = useState<SettingsSection>(() =>
    dashboard.runtime.phase === "running" ? "general" : "engine",
  );

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const next = await apiRequest<DockerEngineConfigurationSnapshot>("/runtime/configuration");
      setSnapshot(next);
      setForm(configurationToForm(next.configuration));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Docker Engine 설정을 불러오지 못했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const status = runtimeStatus[dashboard.runtime.phase];
  const presentation = sectionPresentation[section];

  return (
    <section className="overseer-settings" aria-label="설정">
      <div className="overseer-settings-layout">
        <aside className="overseer-settings-sidebar">
          <nav aria-label="설정 상세 메뉴">
            <div
              aria-labelledby="overseer-settings-general"
              className="overseer-settings-nav-group"
              role="group"
            >
              <span className="overseer-settings-nav-label" id="overseer-settings-general">
                Overseer
              </span>
              <div className="overseer-settings-nav-items">
                <button
                  aria-current={section === "general" ? "page" : undefined}
                  onClick={() => setSection("general")}
                  type="button"
                >
                  일반
                </button>
              </div>
            </div>
            <div
              aria-labelledby="overseer-settings-docker-engine"
              className="overseer-settings-nav-group"
              role="group"
            >
              <span className="overseer-settings-nav-label" id="overseer-settings-docker-engine">
                Docker Engine
              </span>
              <div className="overseer-settings-nav-items">
                <button
                  aria-current={section === "engine" ? "page" : undefined}
                  onClick={() => setSection("engine")}
                  type="button"
                >
                  엔진 설정
                </button>
                <button
                  aria-current={section === "network" ? "page" : undefined}
                  onClick={() => setSection("network")}
                  type="button"
                >
                  네트워크 설정
                </button>
                <button
                  aria-current={section === "instances" ? "page" : undefined}
                  onClick={() => setSection("instances")}
                  type="button"
                >
                  인스턴스 설정
                </button>
              </div>
            </div>
          </nav>
        </aside>

        <div className="overseer-settings-content">
          <header className="overseer-settings-content-header">
            <p>{presentation.category}</p>
            <h2 className="city-text-section-title">{presentation.title}</h2>
            <span className="city-text-supporting">{presentation.description}</span>
          </header>

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
                      <h3 id="overseer-settings-startup">시작 준비</h3>
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

            {section !== "general" && !snapshot && !loadError ? (
              <div
                aria-label="Docker Engine 설정 불러오는 중"
                className="overseer-settings-loading"
              >
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : null}

            {section !== "general" && loadError ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={2}>Docker Engine 설정을 불러오지 못했습니다.</Alert.Title>
                <Alert.Description>{loadError}</Alert.Description>
                <Alert.Action>
                  <Button onClick={() => void load()} size="sm" variant="outline">
                    다시 시도
                  </Button>
                </Alert.Action>
              </Alert.Root>
            ) : null}

            {section !== "general" && snapshot && form ? (
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
                ) : section === "network" ? (
                  <DockerDaemonSettings
                    busy={busy}
                    mode="network"
                    onApply={onApplyDaemonConfiguration}
                    refreshToken={refreshToken}
                  />
                ) : (
                  <>
                    <Fieldset.Root appearance="plain">
                      <Fieldset.Legend>가상화 설정</Fieldset.Legend>
                      <Fieldset.Description>
                        새 Lima 인스턴스에 적용할 가상화 환경과 VM 드라이버를 선택합니다.
                      </Fieldset.Description>
                      <Fieldset.Content className="overseer-settings-grid">
                        <Field.Root>
                          <Field.Label>실행 환경</Field.Label>
                          <Select.Root
                            disabled
                            items={Object.fromEntries(
                              snapshot.providers.map(({ label, value }) => [value, label]),
                            )}
                            value={form.provider}
                          >
                            <Select.Trigger aria-label="실행 환경">
                              <Select.Value />
                              <Select.Icon />
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Positioner>
                                <Select.Popup>
                                  <Select.List>
                                    {snapshot.providers.map((option) => (
                                      <Select.Item key={option.value} value={option.value}>
                                        <Select.ItemIndicator />
                                        <Select.ItemText>{option.label}</Select.ItemText>
                                      </Select.Item>
                                    ))}
                                  </Select.List>
                                </Select.Popup>
                              </Select.Positioner>
                            </Select.Portal>
                          </Select.Root>
                          <Field.Description>현재는 Lima VM만 지원합니다.</Field.Description>
                        </Field.Root>

                        <Field.Root>
                          <Field.Label>VM 드라이버</Field.Label>
                          <Select.Root
                            items={Object.fromEntries(
                              snapshot.vmTypes.map(({ label, value }) => [value, label]),
                            )}
                            onValueChange={(value) =>
                              value &&
                              setForm((current) =>
                                current
                                  ? { ...current, vmType: String(value) as LimaVmType }
                                  : current,
                              )
                            }
                            value={form.vmType}
                          >
                            <Select.Trigger aria-label="VM 드라이버">
                              <Select.Value />
                              <Select.Icon />
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Positioner>
                                <Select.Popup>
                                  <Select.List>
                                    {snapshot.vmTypes.map((option) => (
                                      <Select.Item
                                        disabled={!option.available}
                                        key={option.value}
                                        value={option.value}
                                      >
                                        <Select.ItemIndicator />
                                        <Select.ItemText>
                                          {option.label}
                                          {!option.available ? " · 설치 필요" : ""}
                                        </Select.ItemText>
                                      </Select.Item>
                                    ))}
                                  </Select.List>
                                </Select.Popup>
                              </Select.Positioner>
                            </Select.Portal>
                          </Select.Root>
                          <Field.Description>
                            VZ는 macOS 기본 드라이버이며 QEMU는 별도 설치가 필요합니다.
                          </Field.Description>
                        </Field.Root>
                      </Fieldset.Content>
                    </Fieldset.Root>

                    <RuntimeInstancesSettings
                      busy={busy}
                      defaultConfiguration={{
                        cpus: 4,
                        diskGiB: 100,
                        memoryGiB: 4,
                        provider: "lima",
                        vmType: form.vmType,
                      }}
                      onCreate={onCreateInstance}
                      onPrepare={onPrepareInstance}
                      onSelect={onSelectInstance}
                      onStart={onStartInstance}
                      onStop={onStopInstance}
                      refreshToken={refreshToken}
                    />
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
