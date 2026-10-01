import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataList } from "@opnay/city-ds-react/data-list";
import { Item } from "@opnay/city-ds-react/item";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { ArrowRight, Blocks, Download, Layers, RefreshCw, Terminal } from "lucide-react";
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
  if (!tool.automaticUpdate) return { label: "수동 관리", tone: "neutral" } as const;
  if (tool.updateAvailable === undefined) return { label: "확인 전", tone: "neutral" } as const;
  return tool.updateAvailable
    ? ({ label: "업데이트 있음", tone: "warning" } as const)
    : ({ label: "최신", tone: "success" } as const);
}

const icons = { docker: Terminal, compose: Layers, buildx: Blocks };

export function DockerCliPluginsPage({
  busy,
  onCheck,
  onInstall,
  onUpdate,
  operation,
  refreshToken,
}: {
  busy: boolean;
  onCheck(): Promise<void>;
  onInstall(id: DockerCliPluginId): Promise<void>;
  onUpdate(id: DockerCliPluginId): Promise<void>;
  operation?: OperationSnapshot;
  refreshToken: string;
}) {
  const [error, setError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<DockerCliPluginSnapshot>();
  const active = operation?.status === "queued" || operation?.status === "running";
  const disabled = busy || pending || loading;

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

  const start = async (action: () => Promise<void>) => {
    if (disabled) return;
    setRequestError(undefined);
    setPending(true);
    try {
      await action();
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="CLI 도구 관리"
      aria-busy={loading || active || pending}
      className="overseer-cli-tools"
    >
      <header className="overseer-cli-tools-header">
        <div>
          <p className="city-text-supporting">
            최신 버전은 Homebrew 배포 버전을 기준으로 표시합니다.
          </p>
          <span aria-live="polite" className="city-text-caption">
            {active
              ? operation.step
              : snapshot?.checkedAt
                ? `마지막 확인 ${formatDateTime(snapshot.checkedAt)}`
                : "아직 업데이트를 확인하지 않았습니다."}
          </span>
        </div>
        <Button disabled={disabled} onClick={() => void start(onCheck)} size="sm" variant="outline">
          <RefreshCw aria-hidden="true" size={14} />
          {active && operation.kind === "docker.plugin.update.check"
            ? "업데이트 확인 중…"
            : "업데이트 확인"}
        </Button>
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
      {operation?.status === "failed" ? (
        <Alert.Root tone="destructive" appearance="subtle">
          <Alert.Title level={2}>{operation.title}에 실패했습니다.</Alert.Title>
          <Alert.Description>
            {operation.error?.message ?? "작업 기록에서 출력을 확인하십시오."}
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
            const updating = active && operation.target.id === tool.id;
            const presentation = updating
              ? {
                  label: operation.kind === "docker.plugin.install" ? "설치 중" : "업데이트 중",
                  tone: "warning" as const,
                }
              : status(tool);
            const label = !tool.installed
              ? tool.management === "extensions"
                ? `${tool.label} 설치`
                : `${tool.label} 시작 준비 열기`
              : `${tool.label} 업데이트`;
            const canInstall = !tool.installed && tool.installAvailable;
            const canUpdate = tool.installed && tool.automaticUpdate && tool.updateAvailable;
            const canOpenStartup = !tool.installed && tool.management === "startup";
            return (
              <Item.Root
                appearance="plain"
                className="overseer-cli-tool grid"
                render={<section />}
                aria-labelledby={`cli-tool-${tool.id}`}
                key={tool.id}
              >
                <Item.Header className="gap-3">
                  <Item.Media variant="icon" className="overseer-cli-tool-icon" aria-hidden="true">
                    <Icon />
                  </Item.Media>
                  <Item.Content>
                    <Item.Title render={<h2 />} id={`cli-tool-${tool.id}`}>
                      {tool.label}
                    </Item.Title>
                    <Item.Description>{tool.description}</Item.Description>
                  </Item.Content>
                  <Item.Actions>
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
                <DataList.Root
                  orientation="vertical"
                  density="compact"
                  className="overseer-cli-tool-facts"
                >
                  <DataList.Item>
                    <DataList.Label>현재 버전</DataList.Label>
                    <DataList.Value className="overseer-cli-tool-version">
                      {tool.version ?? "—"}
                    </DataList.Value>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.Label>최신 버전</DataList.Label>
                    <DataList.Value className="overseer-cli-tool-version">
                      {tool.latestVersion ?? "확인 전"}
                    </DataList.Value>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.Label>설치 방식</DataList.Label>
                    <DataList.Value>
                      {!tool.installed
                        ? "미설치"
                        : tool.source === "homebrew"
                          ? "Homebrew"
                          : tool.source === "external"
                            ? "외부 설치"
                            : "확인 불가"}
                    </DataList.Value>
                  </DataList.Item>
                  <DataList.Item className="overseer-cli-tool-path">
                    <DataList.Label>실행 파일</DataList.Label>
                    <DataList.Value>
                      <code>
                        {tool.executablePath ??
                          (tool.installed ? "확인하지 못했습니다." : "설치되지 않음")}
                      </code>
                    </DataList.Value>
                  </DataList.Item>
                </DataList.Root>
                {(
                  !tool.installed ? tool.installUnavailableReason : tool.updateUnavailableReason
                ) ? (
                  <p className="overseer-cli-tool-reason city-text-supporting">
                    {!tool.installed ? tool.installUnavailableReason : tool.updateUnavailableReason}
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
