import { Accordion } from "@opnay/city-ds-react/accordion";
import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Input, Textarea } from "@opnay/city-ds-react/input";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Switch } from "@opnay/city-ds-react/switch";
import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  DockerDaemonConfigurationSection,
  DockerDaemonConfigurationSnapshot,
  DockerDaemonLogDriver,
  UpdateDockerDaemonConfigurationSectionInput,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import {
  dockerDaemonConfigurationToForm,
  dockerDaemonConfigurationFormSection,
  preserveDockerDaemonConfigurationDrafts,
  resetDockerDaemonConfigurationSection,
  validateDockerDaemonConfigurationSection,
  type DockerDaemonConfigurationErrors,
  type DockerDaemonConfigurationForm,
} from "./docker-daemon-configuration.ts";
import { DockerEngineNumberSetting } from "./docker-engine-number-setting.tsx";

interface DockerDaemonSettingsProps {
  busy: boolean;
  mode: "engine" | "network";
  onApply(input: UpdateDockerDaemonConfigurationSectionInput): Promise<void>;
  refreshToken: string;
}

const sectionLabels: Record<DockerDaemonConfigurationSection, string> = {
  advanced: "고급 JSON",
  logging: "컨테이너 로그",
  network: "네트워크",
  proxy: "프록시",
  registry: "Registry",
  stability: "daemon 동작 및 진단",
  transfer: "전송",
};

function SettingSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onCheckedChange(checked: boolean): void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="overseer-daemon-switch-row">
      <span>
        <strong id={labelId}>{label}</strong>
        <span id={descriptionId}>{description}</span>
      </span>
      <Switch
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        size="sm"
      />
    </div>
  );
}

function SectionActions({
  busy,
  error,
  onReset,
  onSave,
  pending,
  section,
}: {
  busy: boolean;
  error?: string;
  onReset(): void;
  onSave(): void;
  pending: boolean;
  section: DockerDaemonConfigurationSection;
}) {
  const label = sectionLabels[section];
  return (
    <>
      {error ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={3}>{label} 설정을 적용하지 못했습니다.</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      ) : null}
      <div className="overseer-daemon-section-actions">
        <Button
          aria-label={`${label} 설정 초기화`}
          disabled={busy}
          onClick={onReset}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw aria-hidden="true" size={14} />
          초기화
        </Button>
        <Button
          aria-label={`${label} 설정 저장`}
          disabled={busy}
          onClick={onSave}
          size="sm"
          type="button"
          variant="primary"
        >
          <Save aria-hidden="true" size={14} />
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </>
  );
}

export function DockerDaemonSettings({
  busy,
  mode,
  onApply,
  refreshToken,
}: DockerDaemonSettingsProps) {
  const [snapshot, setSnapshot] = useState<DockerDaemonConfigurationSnapshot>();
  const [form, setForm] = useState<DockerDaemonConfigurationForm>();
  const [errors, setErrors] = useState<DockerDaemonConfigurationErrors>({});
  const [loadError, setLoadError] = useState<string>();
  const [pendingSection, setPendingSection] = useState<DockerDaemonConfigurationSection>();
  const [sectionError, setSectionError] = useState<{
    message: string;
    section: DockerDaemonConfigurationSection;
  }>();
  const dirtySections = useRef(new Set<DockerDaemonConfigurationSection>());
  const networkMode = mode === "network";
  const controlsBusy = busy || pendingSection !== undefined;

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const next = await apiRequest<DockerDaemonConfigurationSnapshot>(
        "/runtime/engine/configuration",
      );
      const fresh = dockerDaemonConfigurationToForm(next);
      setSnapshot(next);
      setForm((current) =>
        current
          ? preserveDockerDaemonConfigurationDrafts(fresh, current, dirtySections.current)
          : fresh,
      );
      setErrors({});
      setSectionError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "daemon 설정을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const update = <Key extends keyof DockerDaemonConfigurationForm>(
    key: Key,
    value: DockerDaemonConfigurationForm[Key],
  ) => {
    dirtySections.current.add(dockerDaemonConfigurationFormSection(key));
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const apply = async (section: DockerDaemonConfigurationSection) => {
    if (!form || !snapshot?.available) return;
    const result = validateDockerDaemonConfigurationSection(form, section);
    setErrors(result.errors);
    if (!result.input) return;
    setSectionError(undefined);
    setPendingSection(section);
    try {
      await onApply(result.input);
      dirtySections.current.delete(section);
    } catch (error) {
      setSectionError({
        message: error instanceof Error ? error.message : "설정을 적용하지 못했습니다.",
        section,
      });
    } finally {
      setPendingSection(undefined);
    }
  };

  const reset = (section: DockerDaemonConfigurationSection) => {
    if (!snapshot || !form) return;
    setForm(resetDockerDaemonConfigurationSection(form, snapshot, section));
    dirtySections.current.delete(section);
    setErrors({});
    setSectionError((current) => (current?.section === section ? undefined : current));
  };

  return (
    <section
      aria-label={networkMode ? "Docker 네트워크 설정" : "Docker daemon 설정"}
      className="overseer-daemon-settings"
    >
      <div className="overseer-daemon-source">
        <span>설정 파일</span>
        <code>{snapshot?.path ?? "~/.config/docker/daemon.json"}</code>
      </div>

      {!snapshot && !loadError ? (
        <div aria-label="daemon 설정 불러오는 중" className="overseer-daemon-loading">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {loadError ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={3}>daemon 설정을 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>{loadError}</Alert.Description>
          <Alert.Action>
            <Button onClick={() => void load()} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}

      {snapshot && !snapshot.available ? (
        <Alert.Root appearance="subtle" tone="info">
          <Alert.Title level={3}>Docker Engine 준비가 필요합니다.</Alert.Title>
          <Alert.Description>{snapshot.message}</Alert.Description>
        </Alert.Root>
      ) : null}

      {snapshot?.available && form ? (
        <div className="overseer-daemon-settings-form">
          {!networkMode ? (
            <>
              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">
                  daemon 동작 및 진단
                </Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  daemon 재시작 동작과 문제 진단 출력을 제어합니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-daemon-switch-grid">
                  <SettingSwitch
                    checked={form.liveRestore}
                    description="daemon이 중단되어도 실행 중인 컨테이너를 유지합니다."
                    label="Live restore"
                    onCheckedChange={(checked) => update("liveRestore", checked)}
                  />
                  <SettingSwitch
                    checked={form.debug}
                    description="문제 진단을 위한 상세 daemon 로그를 기록합니다."
                    label="Debug mode"
                    onCheckedChange={(checked) => update("debug", checked)}
                  />
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "stability" ? sectionError.message : undefined}
                  onReset={() => reset("stability")}
                  onSave={() => void apply("stability")}
                  pending={pendingSection === "stability"}
                  section="stability"
                />
              </Fieldset.Root>

              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">
                  컨테이너 로그
                </Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  변경값은 새로 만드는 컨테이너부터 적용됩니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-daemon-log-grid">
                  <Field.Root>
                    <Field.Label>로그 드라이버</Field.Label>
                    <Select.Root
                      items={{ "json-file": "JSON file", local: "Local" }}
                      onValueChange={(value) =>
                        value && update("logDriver", String(value) as DockerDaemonLogDriver)
                      }
                      value={form.logDriver}
                    >
                      <Select.Trigger aria-label="로그 드라이버">
                        <Select.Value />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Positioner>
                          <Select.Popup>
                            <Select.List>
                              <Select.Item value="local">
                                <Select.ItemIndicator />
                                <Select.ItemText>Local</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="json-file">
                                <Select.ItemIndicator />
                                <Select.ItemText>JSON file</Select.ItemText>
                              </Select.Item>
                            </Select.List>
                          </Select.Popup>
                        </Select.Positioner>
                      </Select.Portal>
                    </Select.Root>
                    <Field.Description>Local은 기본 로그 회전을 제공합니다.</Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>파일당 최대 크기</Field.Label>
                    <Input
                      aria-label="로그 파일당 최대 크기"
                      onChange={(event) => update("logMaxSize", event.target.value)}
                      placeholder="예: 10m"
                      value={form.logMaxSize}
                    />
                    <Field.Description>비우면 드라이버 기본값을 사용합니다.</Field.Description>
                  </Field.Root>
                  <DockerEngineNumberSetting
                    description="비우면 드라이버 기본값"
                    error={errors.logMaxFile}
                    label="보관 파일 수"
                    min={1}
                    onChange={(value) => update("logMaxFile", value)}
                    value={form.logMaxFile}
                  />
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "logging" ? sectionError.message : undefined}
                  onReset={() => reset("logging")}
                  onSave={() => void apply("logging")}
                  pending={pendingSection === "logging"}
                  section="logging"
                />
              </Fieldset.Root>
            </>
          ) : null}

          {networkMode ? (
            <>
              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">
                  네트워크
                </Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  DNS는 컨테이너 전체에, 주소 풀은 새 네트워크부터 적용됩니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-settings-grid">
                  <Field.Root>
                    <Field.Label>DNS 서버</Field.Label>
                    <Textarea
                      aria-label="DNS 서버"
                      onChange={(event) => update("dns", event.target.value)}
                      placeholder={"1.1.1.1\n8.8.8.8"}
                      rows={3}
                      value={form.dns}
                    />
                    <Field.Description>
                      IPv4 또는 IPv6 주소를 한 줄에 하나씩 입력합니다.
                    </Field.Description>
                  </Field.Root>
                  <Field.Root invalid={Boolean(errors.addressPools)}>
                    <Field.Label>네트워크 주소 풀</Field.Label>
                    <Textarea
                      aria-label="네트워크 주소 풀"
                      onChange={(event) => update("addressPools", event.target.value)}
                      placeholder="172.30.0.0/16,24"
                      rows={3}
                      value={form.addressPools}
                    />
                    <Field.Description>CIDR과 네트워크 크기를 쉼표로 구분합니다.</Field.Description>
                    <Field.Error match>{errors.addressPools}</Field.Error>
                  </Field.Root>
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "network" ? sectionError.message : undefined}
                  onReset={() => reset("network")}
                  onSave={() => void apply("network")}
                  pending={pendingSection === "network"}
                  section="network"
                />
              </Fieldset.Root>
              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">
                  Registry
                </Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  이미지 다운로드 경로와 신뢰할 수 없는 Registry 예외를 관리합니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-settings-grid">
                  <Field.Root>
                    <Field.Label>Registry mirror</Field.Label>
                    <Textarea
                      aria-label="Registry mirror"
                      onChange={(event) => update("registryMirrors", event.target.value)}
                      placeholder="https://mirror.gcr.io"
                      rows={3}
                      value={form.registryMirrors}
                    />
                    <Field.Description>
                      HTTP 또는 HTTPS URL을 한 줄에 하나씩 입력합니다.
                    </Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Insecure registry</Field.Label>
                    <Textarea
                      aria-label="Insecure registry"
                      onChange={(event) => update("insecureRegistries", event.target.value)}
                      placeholder="registry.local:5000"
                      rows={3}
                      value={form.insecureRegistries}
                    />
                    <Field.Description>
                      TLS 검증을 생략할 대상을 한 줄에 하나씩 입력합니다.
                    </Field.Description>
                  </Field.Root>
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "registry" ? sectionError.message : undefined}
                  onReset={() => reset("registry")}
                  onSave={() => void apply("registry")}
                  pending={pendingSection === "registry"}
                  section="registry"
                />
              </Fieldset.Root>

              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">프록시</Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  이미지 pull·push 등 daemon의 외부 통신에 사용합니다. 인증 정보가 포함되면 VM 설정
                  파일에 그대로 저장됩니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-daemon-proxy-grid">
                  <Field.Root>
                    <Field.Label>HTTP Proxy</Field.Label>
                    <Input
                      aria-label="HTTP Proxy"
                      onChange={(event) => update("httpProxy", event.target.value)}
                      placeholder="http://proxy.example.com:3128"
                      value={form.httpProxy}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>HTTPS Proxy</Field.Label>
                    <Input
                      aria-label="HTTPS Proxy"
                      onChange={(event) => update("httpsProxy", event.target.value)}
                      placeholder="http://proxy.example.com:3128"
                      value={form.httpsProxy}
                    />
                  </Field.Root>
                  <Field.Root className="overseer-daemon-proxy-exclusions">
                    <Field.Label>No Proxy</Field.Label>
                    <Textarea
                      aria-label="No Proxy"
                      onChange={(event) => update("noProxy", event.target.value)}
                      placeholder={"localhost\n127.0.0.1\n.example.com"}
                      rows={3}
                      value={form.noProxy}
                    />
                    <Field.Description>
                      프록시를 우회할 대상을 한 줄에 하나씩 입력합니다.
                    </Field.Description>
                  </Field.Root>
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "proxy" ? sectionError.message : undefined}
                  onReset={() => reset("proxy")}
                  onSave={() => void apply("proxy")}
                  pending={pendingSection === "proxy"}
                  section="proxy"
                />
              </Fieldset.Root>
            </>
          ) : null}

          {!networkMode ? (
            <>
              <Fieldset.Root appearance="plain" className="overseer-daemon-section">
                <Fieldset.Legend className="overseer-daemon-section-title">전송</Fieldset.Legend>
                <Fieldset.Description className="overseer-daemon-section-description">
                  동시에 처리할 이미지 레이어 수를 제한합니다.
                </Fieldset.Description>
                <Fieldset.Content className="overseer-settings-grid">
                  <DockerEngineNumberSetting
                    description="0은 제한 없음"
                    error={errors.maxConcurrentDownloads}
                    label="최대 동시 다운로드"
                    min={0}
                    onChange={(value) => update("maxConcurrentDownloads", value)}
                    value={form.maxConcurrentDownloads}
                  />
                  <DockerEngineNumberSetting
                    description="0은 제한 없음"
                    error={errors.maxConcurrentUploads}
                    label="최대 동시 업로드"
                    min={0}
                    onChange={(value) => update("maxConcurrentUploads", value)}
                    value={form.maxConcurrentUploads}
                  />
                </Fieldset.Content>
                <SectionActions
                  busy={controlsBusy}
                  error={sectionError?.section === "transfer" ? sectionError.message : undefined}
                  onReset={() => reset("transfer")}
                  onSave={() => void apply("transfer")}
                  pending={pendingSection === "transfer"}
                  section="transfer"
                />
              </Fieldset.Root>

              <section
                aria-label="추가 daemon.json 설정"
                className="overseer-daemon-section overseer-daemon-advanced-section"
              >
                <Accordion.Root className="overseer-daemon-advanced">
                  <Accordion.Item value="additional-daemon-json">
                    <Accordion.Header>
                      <Accordion.Trigger className="overseer-daemon-advanced-trigger">
                        추가 daemon.json 설정
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Panel>
                      <Field.Root invalid={Boolean(errors.additionalJson)}>
                        <Field.Label>추가 JSON</Field.Label>
                        <Textarea
                          aria-label="추가 daemon.json 설정"
                          className="overseer-daemon-json"
                          onChange={(event) => update("additionalJson", event.target.value)}
                          rows={10}
                          spellCheck={false}
                          value={form.additionalJson}
                        />
                        <Field.Description>
                          위 폼에서 관리하지 않는 키만 입력합니다. 기존 기능 설정은 보존됩니다.
                        </Field.Description>
                        <Field.Error match>{errors.additionalJson}</Field.Error>
                      </Field.Root>
                      <SectionActions
                        busy={controlsBusy}
                        error={
                          sectionError?.section === "advanced" ? sectionError.message : undefined
                        }
                        onReset={() => reset("advanced")}
                        onSave={() => void apply("advanced")}
                        pending={pendingSection === "advanced"}
                        section="advanced"
                      />
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion.Root>
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
