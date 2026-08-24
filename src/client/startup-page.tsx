import { Alert } from "@opnay/city-ds-react/alert";
import { Accordion } from "@opnay/city-ds-react/accordion";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Checkbox } from "@opnay/city-ds-react/checkbox";
import { Field } from "@opnay/city-ds-react/field";
import { Fieldset } from "@opnay/city-ds-react/fieldset";
import { Progress } from "@opnay/city-ds-react/progress";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  PackageCheck,
  Play,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  DockerEngineConfiguration,
  DockerEngineConfigurationSnapshot,
  LimaVmType,
  OperationSnapshot,
  RuntimePhase,
  RuntimeSnapshot,
  StartupInstallTarget,
  StartupPrerequisite,
  StartupSnapshot,
  StartupStepId,
} from "../shared/contracts.ts";
import { apiRequest } from "./api.ts";
import {
  configurationToForm,
  validateDockerEngineConfiguration,
  type DockerEngineConfigurationErrors,
  type DockerEngineConfigurationForm,
} from "./docker-engine-configuration.ts";
import { DockerEngineNumberSetting } from "./docker-engine-number-setting.tsx";

interface StartupPageProps {
  composeSkipped: boolean;
  engineBusy: boolean;
  error?: string;
  onContinue(): void;
  onInstall(target: StartupInstallTarget): Promise<void>;
  onRefresh(): Promise<void>;
  onSkipCompose(): void;
  onStartEngine(configuration?: DockerEngineConfiguration): Promise<void>;
  operation?: OperationSnapshot;
  preview: boolean;
  refreshing: boolean;
  runtime: RuntimeSnapshot;
  snapshot: StartupSnapshot;
  step: StartupStepId;
}

interface StartupDisplayStep extends Omit<StartupPrerequisite, "id"> {
  id: StartupStepId;
}

const engineStatus: Record<
  RuntimePhase,
  { label: string; tone: "destructive" | "info" | "neutral" | "success" | "warning" }
> = {
  error: { label: "확인 필요", tone: "destructive" },
  missing: { label: "설정 필요", tone: "neutral" },
  running: { label: "준비 완료", tone: "success" },
  starting: { label: "준비 중", tone: "info" },
  stopped: { label: "시작 필요", tone: "warning" },
  stopping: { label: "중지 중", tone: "info" },
};

const HOMEBREW_ZSHRC_COMMAND = String.raw`BREW_BIN=/opt/homebrew/bin/brew
[ -x "$BREW_BIN" ] || BREW_BIN=/usr/local/bin/brew
SHELLENV_LINE="eval \"\$($BREW_BIN shellenv zsh)\""
grep -qxF "$SHELLENV_LINE" ~/.zshrc 2>/dev/null || printf '\n%s\n' "$SHELLENV_LINE" >> ~/.zshrc
eval "$("$BREW_BIN" shellenv zsh)"`;

export function StartupPage({
  composeSkipped,
  engineBusy,
  error,
  onContinue,
  onInstall,
  onRefresh,
  onSkipCompose,
  onStartEngine,
  operation,
  preview,
  refreshing,
  runtime,
  snapshot,
  step,
}: StartupPageProps) {
  const [copiedCommand, setCopiedCommand] = useState<string>();
  const [includeCompose, setIncludeCompose] = useState(!composeSkipped);
  const [engineConfiguration, setEngineConfiguration] =
    useState<DockerEngineConfigurationSnapshot>();
  const [engineConfigurationError, setEngineConfigurationError] = useState<string>();
  const [engineForm, setEngineForm] = useState<DockerEngineConfigurationForm>();
  const [engineFormErrors, setEngineFormErrors] = useState<DockerEngineConfigurationErrors>({});

  useEffect(() => {
    setCopiedCommand(undefined);
  }, [step]);

  const loadEngineConfiguration = useCallback(async () => {
    setEngineConfigurationError(undefined);
    try {
      const next = await apiRequest<DockerEngineConfigurationSnapshot>("/runtime/configuration");
      setEngineConfiguration(next);
      setEngineForm(configurationToForm(next.configuration));
      setEngineFormErrors({});
    } catch (loadError) {
      setEngineConfigurationError(
        loadError instanceof Error
          ? loadError.message
          : "Docker Engine 설정을 불러오지 못했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    if (step === "engine" && runtime.phase === "missing") void loadEngineConfiguration();
  }, [loadEngineConfiguration, runtime.phase, step]);

  const engineInstalled = !preview && runtime.phase === "running";
  const startupSteps: StartupDisplayStep[] = [
    ...snapshot.prerequisites.filter(({ required }) => required),
    {
      automaticInstall: false,
      description: engineInstalled
        ? "Overseer 전용 Lima VM과 Docker Engine이 실행 중입니다."
        : runtime.phase === "stopped"
          ? "기존 overseer VM을 시작해 Docker Engine을 준비합니다."
          : "Overseer 전용 Lima VM의 드라이버와 자원을 선택해 Docker Engine을 만듭니다.",
      id: "engine",
      installCommand: "",
      installed: engineInstalled,
      label: "Docker Engine",
      required: true,
      ...(runtime.dockerVersion ? { version: runtime.dockerVersion } : {}),
    },
  ];
  const prerequisite =
    step === "engine"
      ? startupSteps.find(({ id }) => id === step)
      : snapshot.prerequisites.find(({ id }) => id === step);

  if (!prerequisite) return null;

  const engineSetup = prerequisite.id === "engine";
  const composeOptional = prerequisite.id === "compose";
  const detected = prerequisite.installed || (composeOptional && composeSkipped);
  const currentStepId = composeOptional ? "docker" : prerequisite.id;
  const dockerWithCompose = prerequisite.id === "docker" && includeCompose;
  const displayedInstallCommand = dockerWithCompose
    ? "brew install docker docker-compose"
    : prerequisite.installCommand;
  const installTarget: StartupInstallTarget | undefined =
    prerequisite.id === "engine"
      ? undefined
      : dockerWithCompose
        ? "docker-with-compose"
        : prerequisite.id;
  const automaticInstallLabel = dockerWithCompose
    ? "Docker CLI와 Compose 자동 설치"
    : `${prerequisite.label} 자동 설치`;
  const installCommands = engineSetup
    ? []
    : prerequisite.id === "homebrew"
      ? [
          {
            accessibleLabel: "Homebrew CLI 설치 명령",
            command: displayedInstallCommand,
            id: "homebrew-cli",
            label: "CLI 설치",
          },
          {
            accessibleLabel: "Homebrew zshrc 등록 명령",
            command: HOMEBREW_ZSHRC_COMMAND,
            id: "homebrew-zshrc",
            label: "zshrc 등록",
          },
        ]
      : [
          {
            accessibleLabel: `${dockerWithCompose ? "Docker CLI와 Compose" : prerequisite.label} 설치 명령`,
            command: displayedInstallCommand,
            id: "install",
            label: "Terminal에서 실행",
          },
        ];
  const active = operation?.status === "queued" || operation?.status === "running";
  const failed = operation?.status === "failed";
  const succeeded = operation?.status === "succeeded";
  const engineTitle = detected
    ? "Docker Engine 준비를 마쳤습니다."
    : runtime.phase === "stopped"
      ? "Docker Engine을 시작할 차례입니다."
      : runtime.phase === "starting" || runtime.phase === "stopping"
        ? "Docker Engine을 준비하고 있습니다."
        : "Docker Engine을 설정할 차례입니다.";
  const enginePreparing =
    runtime.phase === "starting" || runtime.phase === "stopping" || active || engineBusy;
  const selectedVmType = engineForm
    ? engineConfiguration?.vmTypes.find(({ value }) => value === engineForm.vmType)
    : undefined;
  const qemu = engineConfiguration?.vmTypes.find(({ value }) => value === "qemu");

  const submitEngineConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!engineForm || !engineConfiguration) return;
    const result = validateDockerEngineConfiguration(engineForm, engineConfiguration);
    setEngineFormErrors(result.errors);
    if (!result.configuration) return;
    await onStartEngine(result.configuration).catch(() => undefined);
  };

  const copyCommand = async (command: string, id: string) => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(command);
      setCopiedCommand(id);
      window.setTimeout(
        () => setCopiedCommand((current) => (current === id ? undefined : current)),
        1_500,
      );
    } catch {
      setCopiedCommand(undefined);
    }
  };

  return (
    <div className="overseer-startup-shell">
      <main className="overseer-startup">
        <header className="overseer-startup-header">
          <div className="overseer-startup-brand">
            <span aria-hidden="true" className="overseer-startup-brand-icon">
              <PackageCheck size={22} strokeWidth={1.8} />
            </span>
            <strong>Overseer</strong>
            {preview ? (
              <Badge size="sm" tone="info">
                미리보기
              </Badge>
            ) : null}
          </div>
          <p>STARTUP</p>
          <h1 className="city-text-page-title">시작 준비</h1>
        </header>

        <div className="overseer-startup-workflow">
          <aside className="overseer-startup-step-panel">
            <span>준비 단계</span>
            <ol aria-label="시작 준비 단계" className="overseer-startup-steps">
              {startupSteps.map((item, index) => {
                const current = item.id === currentStepId;
                const currentOptionalComplete = current && composeOptional && detected;
                const statusLabel =
                  item.installed || currentOptionalComplete
                    ? "완료"
                    : current && composeOptional
                      ? "선택 사항"
                      : current
                        ? "현재 단계"
                        : "대기";
                return (
                  <li aria-current={current ? "step" : undefined} key={item.id}>
                    <span>{index + 1}</span>
                    <div className="overseer-startup-step-copy">
                      <strong>{item.label}</strong>
                      {item.installed && item.version ? <small>{item.version}</small> : null}
                      <span className="overseer-startup-step-status">
                        <Badge
                          aria-label={statusLabel}
                          dot
                          size="sm"
                          tone={
                            item.installed || currentOptionalComplete
                              ? "success"
                              : current && composeOptional
                                ? "info"
                                : current
                                  ? "warning"
                                  : "neutral"
                          }
                        />
                        {statusLabel}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section
            aria-labelledby="overseer-startup-current-title"
            className="overseer-startup-content"
          >
            <header className="overseer-startup-content-header">
              <div>
                <p>
                  {startupSteps.findIndex(({ id }) => id === currentStepId) + 1} /{" "}
                  {startupSteps.length}
                </p>
                <h2 className="city-text-section-title" id="overseer-startup-current-title">
                  {engineSetup
                    ? engineTitle
                    : detected
                      ? composeOptional && composeSkipped && !prerequisite.installed
                        ? "Docker Compose 설치를 건너뛰었습니다."
                        : `${prerequisite.label} 설치를 확인했습니다.`
                      : composeOptional
                        ? "Docker Compose를 설치할까요?"
                        : `${prerequisite.label}를 설치해야 합니다.`}
                </h2>
                <span className="city-text-supporting">{prerequisite.description}</span>
              </div>
              {!detected ? (
                <Button
                  disabled={refreshing}
                  onClick={() => void onRefresh()}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={refreshing ? "animate-spin" : undefined}
                    size={14}
                  />
                  {refreshing ? "새로고침 중…" : "상태 새로고침"}
                </Button>
              ) : null}
            </header>

            {error ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={3}>
                  {engineSetup
                    ? "Docker Engine 준비를 시작하지 못했습니다."
                    : "설치 요청을 시작하지 못했습니다."}
                </Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Root>
            ) : null}

            {failed ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={3}>
                  {engineSetup
                    ? "Docker Engine 준비에 실패했습니다."
                    : `${prerequisite.label} 설치에 실패했습니다.`}
                </Alert.Title>
                <Alert.Description>
                  {operation.error?.message ?? "작업 출력을 확인한 뒤 다시 시도하십시오."}
                </Alert.Description>
              </Alert.Root>
            ) : null}

            {!detected && prerequisite.id === "docker" ? (
              <Accordion.Root className="overseer-startup-compose-option">
                <Accordion.Item value="compose">
                  <Accordion.Header>
                    <Accordion.Trigger>Docker 설치 옵션</Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Panel>
                    <div className="overseer-startup-compose-option-control">
                      <Checkbox
                        aria-labelledby="overseer-compose-option-label"
                        checked={includeCompose}
                        disabled={active}
                        onCheckedChange={(checked) => {
                          setIncludeCompose(checked === true);
                          setCopiedCommand(undefined);
                        }}
                      />
                      <div id="overseer-compose-option-label">
                        <strong>Docker Compose</strong>
                        <span>Compose 화면과 프로젝트 관리 기능을 바로 사용할 수 있습니다.</span>
                      </div>
                    </div>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion.Root>
            ) : null}

            {engineSetup ? (
              <div className="overseer-startup-engine-step">
                <section
                  aria-label="Docker Engine 준비 상태"
                  className="overseer-startup-engine-status"
                >
                  <div>
                    <span>상태</span>
                    <strong>
                      <Badge dot size="sm" tone={engineStatus[runtime.phase].tone} />
                      {engineStatus[runtime.phase].label}
                    </strong>
                  </div>
                  <div>
                    <span>인스턴스</span>
                    <strong>{runtime.instance}</strong>
                  </div>
                  <div>
                    <span>Docker</span>
                    <strong>{runtime.dockerVersion ?? "-"}</strong>
                  </div>
                </section>

                {runtime.phase === "error" ? (
                  <Alert.Root appearance="subtle" tone="destructive">
                    <Alert.Title level={3}>Docker Engine 설정을 확인해야 합니다.</Alert.Title>
                    <Alert.Description>{runtime.message}</Alert.Description>
                  </Alert.Root>
                ) : null}

                {enginePreparing && !active ? (
                  <div className="overseer-startup-engine-progress">
                    <Progress.Root aria-label="Docker Engine 준비 중" size="sm" value={null}>
                      <Progress.Track>
                        <Progress.Indicator />
                      </Progress.Track>
                    </Progress.Root>
                  </div>
                ) : null}

                {runtime.phase === "missing" && !enginePreparing ? (
                  <div className="overseer-startup-engine-configuration">
                    {!engineConfiguration && !engineConfigurationError ? (
                      <div
                        aria-label="Docker Engine 설정 불러오는 중"
                        className="overseer-startup-engine-loading"
                      >
                        <Skeleton />
                        <Skeleton />
                        <Skeleton />
                      </div>
                    ) : null}

                    {engineConfigurationError ? (
                      <Alert.Root appearance="subtle" tone="destructive">
                        <Alert.Title level={3}>
                          Docker Engine 설정을 불러오지 못했습니다.
                        </Alert.Title>
                        <Alert.Description>{engineConfigurationError}</Alert.Description>
                        <Alert.Action>
                          <Button
                            onClick={() => void loadEngineConfiguration()}
                            size="sm"
                            variant="outline"
                          >
                            다시 시도
                          </Button>
                        </Alert.Action>
                      </Alert.Root>
                    ) : null}

                    {engineConfiguration && engineForm ? (
                      <form
                        className="overseer-startup-engine-form"
                        onSubmit={submitEngineConfiguration}
                      >
                        <Fieldset.Root appearance="plain">
                          <Fieldset.Legend>실행 환경</Fieldset.Legend>
                          <Fieldset.Content className="overseer-startup-engine-environment-grid">
                            <Field.Root>
                              <Field.Label>실행 환경</Field.Label>
                              <Select.Root
                                disabled={engineBusy}
                                items={Object.fromEntries(
                                  engineConfiguration.providers.map(({ label, value }) => [
                                    value,
                                    label,
                                  ]),
                                )}
                                onValueChange={(value) =>
                                  value &&
                                  setEngineForm((current) =>
                                    current ? { ...current, provider: "lima" } : current,
                                  )
                                }
                                value={engineForm.provider}
                              >
                                <Select.Trigger aria-label="실행 환경">
                                  <Select.Value />
                                  <Select.Icon />
                                </Select.Trigger>
                                <Select.Portal>
                                  <Select.Positioner>
                                    <Select.Popup>
                                      <Select.List>
                                        {engineConfiguration.providers.map((option) => (
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
                            </Field.Root>

                            <Field.Root invalid={Boolean(engineFormErrors.vmType)}>
                              <Field.Label>VM 드라이버</Field.Label>
                              <Select.Root
                                disabled={engineBusy}
                                items={Object.fromEntries(
                                  engineConfiguration.vmTypes.map(({ label, value }) => [
                                    value,
                                    label,
                                  ]),
                                )}
                                onValueChange={(value) =>
                                  value &&
                                  setEngineForm((current) =>
                                    current
                                      ? { ...current, vmType: String(value) as LimaVmType }
                                      : current,
                                  )
                                }
                                value={engineForm.vmType}
                              >
                                <Select.Trigger aria-label="VM 드라이버">
                                  <Select.Value />
                                  <Select.Icon />
                                </Select.Trigger>
                                <Select.Portal>
                                  <Select.Positioner>
                                    <Select.Popup>
                                      <Select.List>
                                        {engineConfiguration.vmTypes.map((option) => (
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
                              <Field.Error match>{engineFormErrors.vmType}</Field.Error>
                            </Field.Root>
                          </Fieldset.Content>
                        </Fieldset.Root>

                        <Fieldset.Root appearance="plain">
                          <Fieldset.Legend>VM 리소스</Fieldset.Legend>
                          <Fieldset.Content className="overseer-startup-engine-resource-grid">
                            <DockerEngineNumberSetting
                              error={engineFormErrors.cpus}
                              label="CPU"
                              min={1}
                              onChange={(cpus) =>
                                setEngineForm((current) =>
                                  current ? { ...current, cpus } : current,
                                )
                              }
                              value={engineForm.cpus}
                            />
                            <DockerEngineNumberSetting
                              error={engineFormErrors.memoryGiB}
                              label="메모리"
                              min={1}
                              onChange={(memoryGiB) =>
                                setEngineForm((current) =>
                                  current ? { ...current, memoryGiB } : current,
                                )
                              }
                              value={engineForm.memoryGiB}
                            />
                            <DockerEngineNumberSetting
                              error={engineFormErrors.diskGiB}
                              label="디스크"
                              min={10}
                              onChange={(diskGiB) =>
                                setEngineForm((current) =>
                                  current ? { ...current, diskGiB } : current,
                                )
                              }
                              value={engineForm.diskGiB}
                            />
                          </Fieldset.Content>
                        </Fieldset.Root>

                        {!qemu?.available ? (
                          <p className="city-text-supporting overseer-startup-engine-note">
                            {qemu?.unavailableReason}
                          </p>
                        ) : null}

                        <div className="overseer-startup-primary-action">
                          <Button
                            disabled={engineBusy || selectedVmType?.available !== true}
                            type="submit"
                          >
                            <ServerCog aria-hidden="true" size={16} />
                            {engineBusy ? "Docker Engine 만드는 중…" : "Docker Engine 만들기"}
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                ) : null}

                {!detected &&
                !enginePreparing &&
                (runtime.phase === "stopped" || runtime.phase === "error") ? (
                  <div className="overseer-startup-primary-action">
                    {runtime.phase === "stopped" ? (
                      <Button onClick={() => void onStartEngine().catch(() => undefined)}>
                        <Play aria-hidden="true" size={16} />
                        Docker Engine 시작
                      </Button>
                    ) : runtime.phase === "error" ? (
                      <Button onClick={() => void onStartEngine().catch(() => undefined)}>
                        <Play aria-hidden="true" size={16} />
                        Docker Engine 다시 준비
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {detected && !active ? (
                  <div className="overseer-startup-primary-action">
                    <Button onClick={onContinue}>
                      다음
                      <ArrowRight aria-hidden="true" size={16} />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!engineSetup ? (
              <div className="overseer-startup-install-group">
                {installCommands.map(({ accessibleLabel, command, id, label }) => {
                  const copied = copiedCommand === id;
                  return (
                    <div className="overseer-startup-command" key={id}>
                      <div>
                        <span>{label}</span>
                        <Button
                          aria-label={`${label} 명령 복사`}
                          onClick={() => void copyCommand(command, id)}
                          size="sm"
                          variant="ghost"
                        >
                          {copied ? (
                            <Check aria-hidden="true" size={14} />
                          ) : (
                            <Copy aria-hidden="true" size={14} />
                          )}
                          {copied ? "복사됨" : "복사"}
                        </Button>
                      </div>
                      <pre aria-label={accessibleLabel} tabIndex={0}>
                        <code>{command}</code>
                      </pre>
                    </div>
                  );
                })}

                {!detected && prerequisite.automaticInstall ? (
                  <div aria-hidden="true" className="overseer-startup-divider">
                    <span>또는</span>
                  </div>
                ) : null}

                {!detected && prerequisite.automaticInstall ? (
                  <div
                    className={
                      composeOptional
                        ? "overseer-startup-decision-actions"
                        : "overseer-startup-primary-action"
                    }
                  >
                    {composeOptional ? (
                      <Button disabled={active} onClick={onSkipCompose} variant="outline">
                        건너뛰기
                      </Button>
                    ) : null}
                    <Button
                      disabled={active}
                      onClick={() => {
                        if (!installTarget) return;
                        if (prerequisite.id === "docker" && !includeCompose) onSkipCompose();
                        void onInstall(installTarget).catch(() => undefined);
                      }}
                    >
                      <Download aria-hidden="true" size={16} />
                      {active ? `${prerequisite.label} 설치 중…` : automaticInstallLabel}
                    </Button>
                  </div>
                ) : null}

                {!detected && !prerequisite.automaticInstall ? (
                  <div className="overseer-startup-manual">
                    <p>다음 단계부터 Docker CLI와 Lima를 자동 설치할 수 있습니다.</p>
                    <div className="overseer-startup-decision-actions">
                      <Button
                        nativeButton={false}
                        render={<a href="https://brew.sh/" rel="noreferrer" target="_blank" />}
                        variant="outline"
                      >
                        <ExternalLink aria-hidden="true" size={16} />
                        공식 홈페이지
                      </Button>
                      <Button disabled={active} onClick={() => void onRefresh()}>
                        <RefreshCw aria-hidden="true" size={16} />
                        설치 확인
                      </Button>
                    </div>
                  </div>
                ) : null}

                {detected && succeeded && operation ? (
                  <Accordion.Root>
                    <Accordion.Item value="automatic-install-log">
                      <Accordion.Header>
                        <Accordion.Trigger>자동 설치 로그</Accordion.Trigger>
                      </Accordion.Header>
                      <Accordion.Panel>
                        <pre
                          aria-label={`${operation.title} 로그`}
                          className="overseer-startup-output"
                          tabIndex={0}
                        >
                          <code>
                            {operation.output.length > 0
                              ? operation.output.slice(-12).join("\n")
                              : operation.step}
                          </code>
                        </pre>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion.Root>
                ) : null}

                {detected && !active ? (
                  <div className="overseer-startup-primary-action overseer-startup-completion-action">
                    <Button onClick={onContinue}>
                      다음
                      <ArrowRight aria-hidden="true" size={16} />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {active && operation ? (
              <section aria-live="polite" className="overseer-startup-progress">
                <Progress.Root aria-label={`${operation.title} 진행 중`} size="sm" value={null}>
                  <Progress.Track>
                    <Progress.Indicator />
                  </Progress.Track>
                </Progress.Root>
                <strong>{operation.step}</strong>
                {operation.output.length > 0 ? (
                  <pre tabIndex={0}>
                    <code>{operation.output.slice(-12).join("\n")}</code>
                  </pre>
                ) : null}
              </section>
            ) : null}

            {failed && operation?.output.length ? (
              <pre className="overseer-startup-output" tabIndex={0}>
                <code>{operation.output.slice(-12).join("\n")}</code>
              </pre>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
