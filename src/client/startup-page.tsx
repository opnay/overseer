import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Progress } from "@opnay/city-ds-react/progress";
import { Check, Copy, Download, PackageCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
  OperationSnapshot,
  StartupPrerequisiteId,
  StartupSnapshot,
} from "../shared/contracts.ts";

interface StartupPageProps {
  error?: string;
  onInstall(id: StartupPrerequisiteId): Promise<void>;
  onRefresh(): Promise<void>;
  operation?: OperationSnapshot;
  snapshot: StartupSnapshot;
}

export function StartupPage({
  error,
  onInstall,
  onRefresh,
  operation,
  snapshot,
}: StartupPageProps) {
  const [copied, setCopied] = useState(false);
  const prerequisite = snapshot.prerequisites.find(({ installed }) => !installed);

  if (!prerequisite) return null;

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
              {snapshot.prerequisites.map((item, index) => {
                const current = item.id === prerequisite.id;
                return (
                  <li aria-current={current ? "step" : undefined} key={item.id}>
                    <span>{index + 1}</span>
                    <div className="overseer-startup-step-copy">
                      <strong>{item.label}</strong>
                      <small>
                        {item.installed ? item.version || "설치됨" : current ? "준비 필요" : "대기"}
                      </small>
                      <span className="overseer-startup-step-status">
                        <Badge
                          aria-label={item.installed ? "완료" : current ? "현재 단계" : "대기"}
                          dot
                          size="sm"
                          tone={item.installed ? "success" : current ? "warning" : "neutral"}
                        />
                        {item.installed ? "완료" : current ? "현재 단계" : "대기"}
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
                  {snapshot.prerequisites.findIndex(({ id }) => id === prerequisite.id) + 1} /{" "}
                  {snapshot.prerequisites.length}
                </p>
                <h2 className="city-text-section-title" id="overseer-startup-current-title">
                  {prerequisite.label}를 설치해야 합니다.
                </h2>
                <span className="city-text-supporting">{prerequisite.description}</span>
              </div>
              <Button onClick={() => void onRefresh()} size="sm" variant="outline">
                <RefreshCw aria-hidden="true" size={14} />
                상태 새로고침
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

            <div aria-hidden="true" className="overseer-startup-divider">
              <span>또는</span>
            </div>

            {prerequisite.automaticInstall ? (
              <div className="overseer-startup-primary-action">
                <Button
                  disabled={active}
                  onClick={() => void onInstall(prerequisite.id).catch(() => undefined)}
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
                <Progress.Root
                  aria-label={`${prerequisite.label} 설치 진행 중`}
                  size="sm"
                  value={null}
                >
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
