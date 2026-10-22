import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Item } from "@opnay/city-ds-react/item";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { ArrowRight, Blocks, Download, Layers, RefreshCw, Server, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DockerCliPluginId,
  DockerCliPluginSnapshot,
  DockerCliPluginSummary,
  OperationSnapshot,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CLI 도구 상태를 확인하지 못했습니다.";
}

function status(tool: DockerCliPluginSummary) {
  if (!tool.installed) return { label: "설치 필요", tone: "neutral" } as const;
  if (tool.source !== "homebrew" || !tool.automaticUpdate) {
    return { label: "수동 관리", tone: "neutral" } as const;
  }
  if (tool.updateAvailable === undefined) return { label: "확인 전", tone: "neutral" } as const;
  return tool.updateAvailable
    ? ({ label: "업데이트 있음", tone: "warning" } as const)
    : ({ label: "최신", tone: "success" } as const);
}

const icons = { buildx: Blocks, compose: Layers, docker: Terminal, lima: Server };

interface BulkUpdateResult {
  completed: number;
  status: "cancelled" | "failed" | "succeeded";
  trackingLost?: boolean;
}

export function DockerCliPluginsPage({
  busy,
  bulkOperation,
  bulkProgress,
  bulkResult,
  onCheck,
  onClearBulkResult,
  onInstall,
  onUpdate,
  onUpdateAll,
  operation,
  refreshToken,
}: {
  busy: boolean;
  bulkOperation?: OperationSnapshot;
  bulkProgress?: { currentId: DockerCliPluginId; index: number; total: number };
  bulkResult?: BulkUpdateResult;
  onCheck(): Promise<void>;
  onClearBulkResult(): void;
  onInstall(id: DockerCliPluginId): Promise<void>;
  onUpdate(id: DockerCliPluginId): Promise<OperationSnapshot>;
  onUpdateAll(ids: DockerCliPluginId[]): Promise<void>;
  operation?: OperationSnapshot;
  refreshToken: string;
}) {
  const [error, setError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<DockerCliPluginSnapshot>();
  const currentOperation = bulkOperation ?? operation;
  const active = currentOperation?.status === "queued" || currentOperation?.status === "running";
  const updateableTools =
    snapshot?.plugins.filter(
      (tool) =>
        tool.installed &&
        tool.source === "homebrew" &&
        tool.automaticUpdate &&
        tool.updateAvailable === true,
    ) ?? [];
  const awaitingUpdateCheck =
    snapshot?.plugins.some(
      (tool) =>
        tool.installed &&
        tool.source === "homebrew" &&
        tool.automaticUpdate &&
        tool.updateAvailable === undefined,
    ) ?? false;
  const disabled = busy || pending || loading || bulkProgress !== undefined;
  const currentBulkTool = bulkProgress
    ? snapshot?.plugins.find(({ id }) => id === bulkProgress.currentId)
    : undefined;

  useEffect(() => {
    let active = true;
    setError(undefined);
    setLoading(true);
    void apiRequest<DockerCliPluginSnapshot>("/docker-cli/plugins")
      .then((value) => active && setSnapshot(value))
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refreshToken, requestRevision]);

  const start = async (action: () => Promise<unknown>) => {
    if (disabled) return;
    setRequestError(undefined);
    onClearBulkResult();
    setPending(true);
    try {
      await action();
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const startBulkUpdate = () => onUpdateAll(updateableTools.map(({ id }) => id));

  return (
    <section
      aria-label="CLI 도구 관리"
      aria-busy={loading || active || pending || bulkProgress !== undefined}
      className="overseer-cli-tools"
    >
      <header className="overseer-cli-tools-header">
        <div>
          <p className="city-text-supporting">
            최신 버전은 Homebrew 배포 버전을 기준으로 표시합니다.
          </p>
          <span aria-live="polite" className="city-text-caption">
            {bulkProgress
              ? `${currentBulkTool?.label ?? "도구"} 업데이트 중 (${bulkProgress.index + 1}/${bulkProgress.total})${bulkOperation?.step ? ` · ${bulkOperation.step}` : ""}`
              : active && currentOperation
                ? currentOperation.step
                : snapshot?.checkedAt
                  ? `마지막 확인 ${formatDateTime(snapshot.checkedAt)}`
                  : "아직 업데이트를 확인하지 않았습니다."}
          </span>
          {snapshot && updateableTools.length === 0 ? (
            <span aria-live="polite" className="city-text-caption">
              {awaitingUpdateCheck
                ? "업데이트 확인을 먼저 실행하십시오."
                : "업데이트할 도구가 없습니다."}
            </span>
          ) : null}
        </div>
        <div className="overseer-cli-tools-header-actions">
          <Button
            disabled={disabled}
            onClick={() => void start(onCheck)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw
              aria-hidden="true"
              className={
                active && currentOperation?.kind === "docker.plugin.update.check"
                  ? "animate-spin"
                  : undefined
              }
              size={14}
            />
            {active && currentOperation?.kind === "docker.plugin.update.check"
              ? "업데이트 확인 중…"
              : "업데이트 확인"}
          </Button>
          <Button
            disabled={disabled || updateableTools.length === 0}
            onClick={() => void start(startBulkUpdate)}
            size="sm"
            type="button"
            variant="primary"
          >
            <RefreshCw
              aria-hidden="true"
              className={bulkProgress ? "animate-spin" : undefined}
              size={14}
            />
            {bulkProgress ? "전체 업데이트 중…" : "전체 업데이트"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert.Root tone="destructive" appearance="subtle">
          <Alert.Title level={2}>CLI 도구 상태를 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
          <Alert.Action>
            <Button
              onClick={() => setRequestRevision((value) => value + 1)}
              size="sm"
              variant="outline"
            >
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}
      {requestError ? (
        <Alert.Root tone="destructive" appearance="subtle">
          <Alert.Title level={2}>작업을 시작하지 못했습니다.</Alert.Title>
          <Alert.Description>{requestError}</Alert.Description>
        </Alert.Root>
      ) : null}
      {currentOperation?.status === "failed" ? (
        <Alert.Root tone="destructive" appearance="subtle">
          <Alert.Title level={2}>{currentOperation.title}에 실패했습니다.</Alert.Title>
          <Alert.Description>
            {currentOperation.error?.message ?? "작업 기록에서 출력을 확인하십시오."}
          </Alert.Description>
          <Alert.Action>
            <Button
              nativeButton={false}
              render={<a href="/operations" />}
              size="sm"
              variant="outline"
            >
              작업 기록 보기
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}
      {bulkResult ? (
        <Alert.Root
          appearance="subtle"
          tone={
            bulkResult.status === "succeeded"
              ? "success"
              : bulkResult.status === "cancelled"
                ? "warning"
                : "destructive"
          }
        >
          <Alert.Title level={2}>
            {bulkResult.status === "succeeded"
              ? "전체 업데이트를 완료했습니다."
              : bulkResult.status === "cancelled"
                ? "전체 업데이트가 취소되었습니다."
                : "전체 업데이트가 중단되었습니다."}
          </Alert.Title>
          <Alert.Description>
            {bulkResult.status === "succeeded"
              ? `${bulkResult.completed}개 도구를 업데이트했습니다.`
              : bulkResult.status === "cancelled"
                ? `${bulkResult.completed}개 도구 업데이트를 마쳤습니다. 남은 작업은 취소했습니다.`
                : bulkResult.trackingLost
                  ? `${bulkResult.completed}개 도구 업데이트를 마친 뒤 현재 업데이트 ID를 찾지 못해 중단했습니다. 남은 업데이트는 시작하지 않았습니다.`
                  : `${bulkResult.completed}개 도구 업데이트를 마친 뒤 중단했습니다. 남은 업데이트는 시작하지 않았습니다.`}
          </Alert.Description>
        </Alert.Root>
      ) : null}
      {snapshot?.inspectionWarning ? (
        <Alert.Root tone="warning" appearance="subtle">
          <Alert.Title level={2}>일부 도구의 관리 출처를 확인하지 못했습니다.</Alert.Title>
          <Alert.Description>{snapshot.inspectionWarning}</Alert.Description>
        </Alert.Root>
      ) : null}
      {!snapshot && loading ? <Skeleton className="overseer-loading-table" /> : null}
      {snapshot ? (
        <Item.Group className="overseer-cli-tools-list gap-0" aria-label="Docker CLI 도구 목록">
          {snapshot.plugins.map((tool) => {
            const Icon = icons[tool.id];
            const updating = active && currentOperation?.target.id === tool.id;
            const presentation = updating
              ? {
                  label:
                    currentOperation?.kind === "docker.plugin.install" ? "설치 중" : "업데이트 중",
                  tone: "warning" as const,
                }
              : status(tool);
            const canInstall = !tool.installed && tool.installAvailable;
            const canUpdate =
              tool.installed &&
              tool.source === "homebrew" &&
              tool.automaticUpdate &&
              tool.updateAvailable === true;
            const canOpenStartup = !tool.installed && tool.management === "startup";
            const label = canOpenStartup
              ? `${tool.label} 시작 준비 열기`
              : canInstall
                ? `${tool.label} 설치`
                : `${tool.label} 업데이트`;
            const sourceLabel =
              tool.source === "homebrew"
                ? "Homebrew"
                : tool.source === "external"
                  ? "외부 설치"
                  : "출처 확인 불가";
            const currentVersion = tool.version ?? "—";
            const latestVersion =
              snapshot.checkedAt && tool.latestVersion !== tool.version
                ? tool.latestVersion
                : undefined;
            const versionAccessibleName = latestVersion
              ? `현재 버전 ${currentVersion}, 최신 버전 ${latestVersion}`
              : `현재 버전 ${currentVersion}`;
            const availabilityReason = !tool.installed
              ? tool.installUnavailableReason
              : tool.updateUnavailableReason;
            return (
              <Item.Root
                appearance="plain"
                className="overseer-cli-tool"
                density="compact"
                render={<section />}
                aria-labelledby={`cli-tool-${tool.id}`}
                key={tool.id}
              >
                <Item.Header className="overseer-cli-tool-header">
                  <Item.Media variant="icon" className="overseer-cli-tool-icon" aria-hidden="true">
                    <Icon />
                  </Item.Media>
                  <Item.Content className="overseer-cli-tool-content">
                    <div className="overseer-cli-tool-title-line">
                      <Item.Title render={<h2 />} id={`cli-tool-${tool.id}`}>
                        {tool.label}
                      </Item.Title>
                      <span
                        aria-label={versionAccessibleName}
                        className="overseer-cli-tool-version"
                        role="group"
                      >
                        {currentVersion}
                        {latestVersion ? `(${latestVersion})` : ""}
                      </span>
                    </div>
                  </Item.Content>
                  <Item.Actions className="overseer-cli-tool-actions">
                    <Badge appearance="subtle" size="sm" tone="neutral">
                      {sourceLabel}
                    </Badge>
                    <Badge appearance="subtle" size="sm" tone={presentation.tone}>
                      {presentation.label}
                    </Badge>
                    {canInstall || canUpdate || canOpenStartup ? (
                      <Tooltip.Root>
                        <Tooltip.Trigger
                          render={
                            <Button
                              aria-label={label}
                              disabled={disabled && !canOpenStartup}
                              iconOnly
                              size="sm"
                              variant={canUpdate ? "primary" : "outline"}
                              {...(canOpenStartup
                                ? { nativeButton: false, render: <a href="/startup" /> }
                                : {
                                    onClick: () =>
                                      void start(() =>
                                        canInstall ? onInstall(tool.id) : onUpdate(tool.id),
                                      ),
                                  })}
                            />
                          }
                        >
                          {canOpenStartup ? (
                            <ArrowRight aria-hidden="true" size={14} />
                          ) : canInstall ? (
                            <Download aria-hidden="true" size={14} />
                          ) : (
                            <RefreshCw aria-hidden="true" size={14} />
                          )}
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Positioner side="top" sideOffset={6}>
                            <Tooltip.Popup>{label}</Tooltip.Popup>
                          </Tooltip.Positioner>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    ) : null}
                  </Item.Actions>
                </Item.Header>
                {availabilityReason ? (
                  <p className="overseer-cli-tool-reason city-text-supporting">
                    {availabilityReason}
                  </p>
                ) : null}
              </Item.Root>
            );
          })}
        </Item.Group>
      ) : null}
    </section>
  );
}
