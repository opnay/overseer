import { Alert } from "@opnay/city-ds-react/alert";
import { Accordion } from "@opnay/city-ds-react/accordion";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Checkbox } from "@opnay/city-ds-react/checkbox";
import { Progress } from "@opnay/city-ds-react/progress";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  OperationSnapshot,
  StartupInstallTarget,
  StartupPrerequisiteId,
  StartupSnapshot,
} from "../shared/contracts.ts";

interface StartupPageProps {
  composeSkipped: boolean;
  error?: string;
  onContinue(): void;
  onInstall(target: StartupInstallTarget): Promise<void>;
  onRefresh(): Promise<void>;
  onSkipCompose(): void;
  operation?: OperationSnapshot;
  preview: boolean;
  refreshing: boolean;
  snapshot: StartupSnapshot;
  step: StartupPrerequisiteId;
}

const HOMEBREW_ZSHRC_COMMAND = String.raw`BREW_BIN=/opt/homebrew/bin/brew
[ -x "$BREW_BIN" ] || BREW_BIN=/usr/local/bin/brew
SHELLENV_LINE="eval \"\$($BREW_BIN shellenv zsh)\""
grep -qxF "$SHELLENV_LINE" ~/.zshrc 2>/dev/null || printf '\n%s\n' "$SHELLENV_LINE" >> ~/.zshrc
eval "$("$BREW_BIN" shellenv zsh)"`;

export function StartupPage({
  composeSkipped,
  error,
  onContinue,
  onInstall,
  onRefresh,
  onSkipCompose,
  operation,
  preview,
  refreshing,
  snapshot,
  step,
}: StartupPageProps) {
  const [copiedCommand, setCopiedCommand] = useState<string>();
  const [includeCompose, setIncludeCompose] = useState(!composeSkipped);

  useEffect(() => {
    setCopiedCommand(undefined);
  }, [step]);

  const requiredPrerequisites = snapshot.prerequisites.filter(({ required }) => required);
  const prerequisite = snapshot.prerequisites.find(({ id }) => id === step);

  if (!prerequisite) return null;

  const composeOptional = prerequisite.id === "compose";
  const detected = prerequisite.installed || (composeOptional && composeSkipped);
  const currentStepId = composeOptional ? "docker" : prerequisite.id;
  const dockerWithCompose = prerequisite.id === "docker" && includeCompose;
  const displayedInstallCommand = dockerWithCompose
    ? "brew install docker docker-compose"
    : prerequisite.installCommand;
  const installTarget: StartupInstallTarget = dockerWithCompose
    ? "docker-with-compose"
    : prerequisite.id;
  const automaticInstallLabel = dockerWithCompose
    ? "Docker CLI와 Compose 자동 설치"
    : `${prerequisite.label} 자동 설치`;
  const installCommands =
    prerequisite.id === "homebrew"
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
              {requiredPrerequisites.map((item, index) => {
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
                  {requiredPrerequisites.findIndex(({ id }) => id === currentStepId) + 1} /{" "}
                  {requiredPrerequisites.length}
                </p>
                <h2 className="city-text-section-title" id="overseer-startup-current-title">
                  {detected
                    ? composeOptional && composeSkipped && !prerequisite.installed
                      ? "Docker Compose 설치를 건너뛰었습니다."
                      : `${prerequisite.label} 설치를 확인했습니다.`
                    : composeOptional
                      ? "Docker Compose를 설치할까요?"
                      : `${prerequisite.label}를 설치해야 합니다.`}
                </h2>
                {!detected ? (
                  <span className="city-text-supporting">{prerequisite.description}</span>
                ) : null}
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
                <Alert.Title level={3}>설치 요청을 시작하지 못했습니다.</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Root>
            ) : null}

            {failed ? (
              <Alert.Root tone="destructive">
                <Alert.Title level={3}>{prerequisite.label} 설치에 실패했습니다.</Alert.Title>
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

            {!detected ? (
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

                {prerequisite.automaticInstall ? (
                  <div aria-hidden="true" className="overseer-startup-divider">
                    <span>또는</span>
                  </div>
                ) : null}

                {prerequisite.automaticInstall ? (
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
                        if (prerequisite.id === "docker" && !includeCompose) onSkipCompose();
                        void onInstall(installTarget).catch(() => undefined);
                      }}
                    >
                      <Download aria-hidden="true" size={16} />
                      {active ? `${prerequisite.label} 설치 중…` : automaticInstallLabel}
                    </Button>
                  </div>
                ) : (
                  <div className="overseer-startup-manual">
                    <p>다음 단계부터 Docker CLI와 Lima를 자동 설치할 수 있습니다.</p>
                    <div className="overseer-startup-decision-actions">
                      <Button
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
                )}
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

            {detected && succeeded && operation ? (
              <Accordion.Root className="overseer-startup-operation-log">
                <Accordion.Item value="automatic-install-log">
                  <Accordion.Header>
                    <Accordion.Trigger>자동 설치 로그</Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Panel>
                    <div className="overseer-startup-operation-log-content">
                      <strong>{operation.step}</strong>
                      {operation.output.length > 0 ? (
                        <pre
                          aria-label={`${operation.title} 로그`}
                          className="overseer-startup-output"
                          tabIndex={0}
                        >
                          <code>{operation.output.slice(-12).join("\n")}</code>
                        </pre>
                      ) : null}
                    </div>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion.Root>
            ) : null}

            {detected && !active ? (
              <div className="overseer-startup-primary-action">
                <Button onClick={onContinue}>
                  다음
                  <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
