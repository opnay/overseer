import { Alert } from "@opnay/city-ds-react/alert";
import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Input } from "@opnay/city-ds-react/input";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ArrowRight, PackageCheck, RotateCcw, ServerCog } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  DashboardSnapshot,
  DockerEngineConfiguration,
  DockerEngineConfigurationSnapshot,
  LimaVmType,
  RecreateDockerEngineInput,
  RuntimePhase,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import {
  configurationToForm,
  validateDockerEngineConfiguration,
  type DockerEngineConfigurationErrors,
  type DockerEngineConfigurationForm,
} from "./docker-engine-configuration.ts";
import { DockerEngineNumberSetting } from "./docker-engine-number-setting.tsx";

interface SettingsPageProps {
  busy: boolean;
  dashboard: DashboardSnapshot;
  onCreate(configuration: DockerEngineConfiguration): Promise<void>;
  onRecreate(input: RecreateDockerEngineInput): Promise<void>;
  refreshToken: string;
}

type SettingsSection = "engine" | "environment" | "general";

const sectionPresentation: Record<
  SettingsSection,
  { category: string; description: string; title: string }
> = {
  engine: {
    category: "Docker Engine",
    description: "Docker Engine 상태와 단일 overseer VM의 자원을 관리합니다.",
    title: "엔진 설정",
  },
  environment: {
    category: "Docker Engine",
    description: "Docker Engine을 실행할 환경과 Lima VM 드라이버를 선택합니다.",
    title: "실행 환경",
  },
  general: {
    category: "Overseer",
    description: "Overseer의 기본 동작을 관리합니다.",
    title: "일반",
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
  onCreate,
  onRecreate,
  refreshToken,
}: SettingsPageProps) {
  const [snapshot, setSnapshot] = useState<DockerEngineConfigurationSnapshot>();
  const [form, setForm] = useState<DockerEngineConfigurationForm>();
  const [errors, setErrors] = useState<DockerEngineConfigurationErrors>({});
  const [loadError, setLoadError] = useState<string>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmationError, setConfirmationError] = useState<string>();
  const [section, setSection] = useState<SettingsSection>("general");

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const next = await apiRequest<DockerEngineConfigurationSnapshot>("/runtime/configuration");
      setSnapshot(next);
      setForm(configurationToForm(next.configuration));
      setErrors({});
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Docker Engine 설정을 불러오지 못했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const configuration = (): DockerEngineConfiguration | undefined => {
    if (!form || !snapshot) return undefined;
    const result = validateDockerEngineConfiguration(form, snapshot);
    setErrors(result.errors);
    return result.configuration;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = configuration();
    if (!next || !snapshot) return;
    setErrors({});
    if (snapshot.source === "instance") {
      setConfirmationOpen(true);
      return;
    }
    try {
      await onCreate(next);
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : "Docker Engine을 만들지 못했습니다.",
      });
    }
  };

  const recreate = async () => {
    const next = configuration();
    if (!next || confirmation !== "overseer") return;
    setConfirmationError(undefined);
    try {
      await onRecreate({ configuration: next, confirmation });
      setConfirmationOpen(false);
      setConfirmation("");
    } catch (error) {
      setConfirmationError(
        error instanceof Error ? error.message : "Docker Engine을 재생성하지 못했습니다.",
      );
    }
  };

  const selectedVmType = form
    ? snapshot?.vmTypes.find(({ value }) => value === form.vmType)
    : undefined;
  const qemu = snapshot?.vmTypes.find(({ value }) => value === "qemu");
  const status = runtimeStatus[dashboard.runtime.phase];
  const customNetworks = dashboard.networks.filter(({ builtIn }) => !builtIn).length;
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
                  aria-current={section === "environment" ? "page" : undefined}
                  onClick={() => setSection("environment")}
                  type="button"
                >
                  실행 환경
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
              <form className="overseer-settings-form" onSubmit={submit}>
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

                    <Fieldset.Root appearance="plain">
                      <Fieldset.Legend>VM 리소스</Fieldset.Legend>
                      <Fieldset.Description>
                        모든 값은 전역 단일 overseer VM에 적용됩니다.
                      </Fieldset.Description>
                      <Fieldset.Content className="overseer-settings-resource-grid">
                        <DockerEngineNumberSetting
                          description="가상 CPU 수"
                          error={errors.cpus}
                          label="CPU"
                          min={1}
                          onChange={(cpus) =>
                            setForm((current) => (current ? { ...current, cpus } : current))
                          }
                          value={form.cpus}
                        />
                        <DockerEngineNumberSetting
                          description="GiB 단위"
                          error={errors.memoryGiB}
                          label="메모리"
                          min={1}
                          onChange={(memoryGiB) =>
                            setForm((current) => (current ? { ...current, memoryGiB } : current))
                          }
                          value={form.memoryGiB}
                        />
                        <DockerEngineNumberSetting
                          description="GiB 단위, 최소 10GiB"
                          error={errors.diskGiB}
                          label="디스크"
                          min={10}
                          onChange={(diskGiB) =>
                            setForm((current) => (current ? { ...current, diskGiB } : current))
                          }
                          value={form.diskGiB}
                        />
                      </Fieldset.Content>
                    </Fieldset.Root>

                    {errors.form ? (
                      <Alert.Root tone="destructive">
                        <Alert.Title level={3}>설정을 적용하지 못했습니다.</Alert.Title>
                        <Alert.Description>{errors.form}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <div className="overseer-settings-actions">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setForm(configurationToForm(snapshot.configuration));
                          setErrors({});
                        }}
                        type="button"
                        variant="outline"
                      >
                        <RotateCcw aria-hidden="true" size={14} />
                        현재 값으로 초기화
                      </Button>
                      <Button
                        disabled={busy || selectedVmType?.available !== true}
                        type="submit"
                        variant="primary"
                      >
                        <ServerCog aria-hidden="true" size={15} />
                        {busy
                          ? "처리 중…"
                          : snapshot.source === "instance"
                            ? "Docker Engine 재생성"
                            : "Docker Engine 만들기"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Fieldset.Root appearance="plain">
                      <Fieldset.Legend>실행 환경</Fieldset.Legend>
                      <Fieldset.Description>
                        단일 overseer VM에서 하나의 Docker Engine을 실행합니다.
                      </Fieldset.Description>
                      <Fieldset.Content className="overseer-settings-grid">
                        <Field.Root>
                          <Field.Label>실행 환경</Field.Label>
                          <Select.Root
                            items={Object.fromEntries(
                              snapshot.providers.map(({ label, value }) => [value, label]),
                            )}
                            onValueChange={(value) =>
                              value &&
                              setForm((current) => current && { ...current, provider: "lima" })
                            }
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
                          <Field.Description>
                            다른 실행 환경은 실제 구현이 추가될 때 선택지로 확장합니다.
                          </Field.Description>
                        </Field.Root>

                        <Field.Root invalid={Boolean(errors.vmType)}>
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
                          <Field.Error match>{errors.vmType}</Field.Error>
                        </Field.Root>
                      </Fieldset.Content>
                    </Fieldset.Root>

                    {!qemu?.available ? (
                      <Alert.Root appearance="subtle" tone="info">
                        <Alert.Title level={3}>QEMU 사용 준비가 필요합니다.</Alert.Title>
                        <Alert.Description>{qemu?.unavailableReason}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <div className="overseer-settings-environment-actions">
                      <Button onClick={() => setSection("engine")} type="button" variant="outline">
                        엔진 설정에서 적용
                      </Button>
                    </div>
                  </>
                )}
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <AlertDialog.Root
        onOpenChange={(open) => {
          setConfirmationOpen(open);
          if (!open) {
            setConfirmation("");
            setConfirmationError(undefined);
          }
        }}
        open={confirmationOpen}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Viewport>
            <AlertDialog.Popup>
              <AlertDialog.Title>Docker Engine을 재생성하시겠습니까?</AlertDialog.Title>
              <AlertDialog.Description>
                단일 overseer VM을 삭제한 뒤 선택한 설정으로 다시 만듭니다. 이 작업은 되돌릴 수
                없습니다.
              </AlertDialog.Description>
              <ul className="overseer-recreate-impact">
                <li>컨테이너 {dashboard.containers.length}개</li>
                <li>이미지 {dashboard.images.length}개</li>
                <li>볼륨 {dashboard.volumes.length}개</li>
                <li>사용자 네트워크 {customNetworks}개</li>
                <li>VM 내부 Compose 데이터</li>
              </ul>
              <p className="city-text-supporting overseer-recreate-preserved">
                호스트 SQLite의 Compose 등록 정보와 작업 기록은 유지됩니다.
              </p>
              {confirmationError ? (
                <Alert.Root appearance="subtle" tone="destructive">
                  <Alert.Title level={3}>재생성 요청을 접수하지 못했습니다.</Alert.Title>
                  <Alert.Description>{confirmationError}</Alert.Description>
                </Alert.Root>
              ) : null}
              <Field.Root invalid={Boolean(confirmation) && confirmation !== "overseer"}>
                <Field.Label>확인을 위해 overseer 입력</Field.Label>
                <Input
                  autoComplete="off"
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  value={confirmation}
                />
                <Field.Error match>overseer를 정확히 입력하십시오.</Field.Error>
              </Field.Root>
              <div className="overseer-dialog-actions">
                <AlertDialog.Cancel render={<Button variant="outline" />}>취소</AlertDialog.Cancel>
                <Button
                  disabled={busy || confirmation !== "overseer"}
                  onClick={() => void recreate()}
                  variant="destructive"
                >
                  Docker Engine 재생성
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
