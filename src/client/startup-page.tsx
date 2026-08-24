import { Alert } from "@opnay/city-ds-react/alert";
import { Accordion } from "@opnay/city-ds-react/accordion";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Progress } from "@opnay/city-ds-react/progress";
import { Check, Copy, Download, PackageCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
  OperationSnapshot,
  StartupInstallTarget,
  StartupSnapshot,
} from "../shared/contracts.ts";

interface StartupPageProps {
  composeSkipped: boolean;
  error?: string;
  onInstall(target: StartupInstallTarget): Promise<void>;
  onRefresh(): Promise<void>;
  onSkipCompose(): void;
  operation?: OperationSnapshot;
  refreshing: boolean;
  snapshot: StartupSnapshot;
}

export function StartupPage({
  composeSkipped,
  error,
  onInstall,
  onRefresh,
  onSkipCompose,
  operation,
  refreshing,
  snapshot,
}: StartupPageProps) {
  const [copied, setCopied] = useState(false);
  const requiredPrerequisites = snapshot.prerequisites.filter(({ required }) => required);
  const compose = snapshot.prerequisites.find(({ id }) => id === "compose");
  const firstMissingRequired = requiredPrerequisites.find(({ installed }) => !installed);
  const composeDecisionPending = Boolean(
    compose &&
    !compose.installed &&
    !composeSkipped &&
    snapshot.prerequisites.find(({ id }) => id === "docker")?.installed &&
    firstMissingRequired?.id !== "homebrew" &&
    firstMissingRequired?.id !== "docker",
  );
  const prerequisite = composeDecisionPending ? compose : firstMissingRequired;

  if (!prerequisite) return null;

  const composeOptional = prerequisite.id === "compose";
  const currentStepId = composeOptional ? "docker" : prerequisite.id;
  const active = operation?.status === "queued" || operation?.status === "running";
  const failed = operation?.status === "failed";
  const copyCommand = async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(prerequisite.installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overseer-startup-shell">
      <main className="overseer-startup">
        <header className="overseer-startup-header">
          <div className="overseer-startup-brand">
            <span aria-hidden="true">
              <PackageCheck size={22} strokeWidth={1.8} />
            </span>
            <strong>Overseer</strong>
          </div>
          <p>STARTUP</p>
          <h1 className="city-text-page-title">시작 준비</h1>
          <span className="city-text-supporting">
            로컬 Docker Engine을 만들기 전에 필수 도구를 순서대로 준비합니다.
          </span>
        </header>

        <div className="overseer-startup-workflow">
          <aside className="overseer-startup-step-panel">
            <span>준비 단계</span>
            <ol aria-label="시작 준비 단계" className="overseer-startup-steps">
              {requiredPrerequisites.map((item, index) => {
                const current = item.id === currentStepId;
                const statusLabel =
                  current && composeOptional
                    ? "선택 사항"
                    : item.installed
                      ? "완료"
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
                            current && composeOptional
                              ? "info"
                              : item.installed
                                ? "success"
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
                  {composeOptional
                    ? "Docker Compose를 설치할까요?"
                    : `${prerequisite.label}를 설치해야 합니다.`}
                </h2>
                <span className="city-text-supporting">{prerequisite.description}</span>
              </div>
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

            <div className="overseer-startup-command">
              <div>
                <span>Terminal에서 실행</span>
                <Button onClick={() => void copyCommand()} size="sm" variant="ghost">
                  {copied ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <Copy aria-hidden="true" size={14} />
                  )}
                  {copied ? "복사됨" : "복사"}
                </Button>
              </div>
              <pre aria-label={`${prerequisite.label} 설치 명령`} tabIndex={0}>
                <code>{prerequisite.installCommand}</code>
              </pre>
            </div>

            {prerequisite.id === "docker" ? (
              <Accordion.Root className="overseer-startup-compose-option">
                <Accordion.Item value="compose">
                  <Accordion.Header>
                    <Accordion.Trigger>Docker Compose도 함께 설치</Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Panel>
                    <div className="overseer-startup-compose-option-content">
                      <p>
                        Compose 프로젝트를 사용할 계획이라면 함께 설치할 수 있습니다. 나중에 별도로
                        설치하거나 건너뛰어도 됩니다.
                      </p>
                      <code>brew install docker docker-compose</code>
                      <Button
                        disabled={active}
                        onClick={() => void onInstall("docker-with-compose").catch(() => undefined)}
                        size="sm"
                        variant="outline"
                      >
                        <Download aria-hidden="true" size={14} />
                        Docker CLI와 Compose 자동 설치
                      </Button>
                    </div>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion.Root>
            ) : null}

            <div aria-hidden="true" className="overseer-startup-divider">
              <span>또는</span>
            </div>

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
                    if (prerequisite.id === "docker") onSkipCompose();
                    void onInstall(prerequisite.id).catch(() => undefined);
                  }}
                >
                  <Download aria-hidden="true" size={16} />
                  {active ? `${prerequisite.label} 설치 중…` : `${prerequisite.label} 자동 설치`}
                </Button>
              </div>
            ) : (
              <div className="overseer-startup-manual">
                <Alert.Root appearance="subtle" tone="info">
                  <Alert.Title level={3}>Terminal에서 설치하십시오.</Alert.Title>
                  <Alert.Description>
                    {prerequisite.automaticInstallUnavailableReason}
                  </Alert.Description>
                </Alert.Root>
                <div className="overseer-startup-primary-action">
                  <Button disabled={active} onClick={() => void onRefresh()}>
                    <RefreshCw aria-hidden="true" size={16} />
                    설치 확인
                  </Button>
                </div>
              </div>
            )}

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
