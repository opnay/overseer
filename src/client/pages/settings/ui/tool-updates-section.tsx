import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  OperationSnapshot,
  ToolUpdateId,
  ToolUpdateItem,
  ToolUpdateSnapshot,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";

function statusPresentation(
  item: ToolUpdateItem,
  updating: boolean,
): { label: string; tone: "neutral" | "success" | "warning" } {
  if (updating) return { label: "업데이트 중", tone: "warning" };
  if (!item.installed) return { label: "설치 필요", tone: "neutral" };
  if (!item.automaticUpdate) return { label: "수동 관리", tone: "neutral" };
  if (item.updateAvailable === undefined) return { label: "확인 전", tone: "neutral" };
  return item.updateAvailable
    ? { label: "업데이트 있음", tone: "warning" }
    : { label: "최신", tone: "success" };
}

export function ToolUpdatesSection({
  operation,
  onCheck,
  onUpdate,
  refreshToken,
  requestPending,
}: {
  operation?: OperationSnapshot;
  onCheck(): Promise<void>;
  onUpdate(id: ToolUpdateId): Promise<void>;
  refreshToken: string;
  requestPending: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ToolUpdateSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoadError(undefined);
    setLoading(true);
    try {
      setSnapshot(await apiRequest<ToolUpdateSnapshot>("/startup/updates"));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "도구 업데이트 상태를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const active = operation?.status === "queued" || operation?.status === "running";
  const checking = active && operation.kind === "startup.update.check";
  const updatingId =
    active && operation.kind === "startup.update"
      ? (operation.target.id ?? operation.target.name)
      : undefined;
  const controlsBusy = requestPending || active;

  const start = async (action: () => Promise<void>) => {
    setRequestError(undefined);
    try {
      await action();
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "도구 업데이트 작업을 시작하지 못했습니다.",
      );
    }
  };

  return (
    <section
      aria-busy={loading || active}
      aria-labelledby="overseer-settings-tool-updates"
      className="overseer-tool-updates"
    >
      <header className="overseer-tool-updates-header">
        <div>
          <h3 id="overseer-settings-tool-updates">도구 업데이트</h3>
          <p>Homebrew로 설치된 Docker CLI·Compose·Lima의 새 버전을 확인합니다.</p>
          <span aria-live="polite" className="city-text-caption">
            {snapshot?.checkedAt
              ? `마지막 확인 ${formatDateTime(snapshot.checkedAt)}`
              : "아직 업데이트를 확인하지 않았습니다."}
          </span>
        </div>
        <Button
          disabled={controlsBusy}
          onClick={() => void start(onCheck)}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw
            aria-hidden="true"
            className={checking ? "animate-spin" : undefined}
            size={14}
          />
          {checking ? "확인 중…" : "업데이트 확인"}
        </Button>
      </header>

      {requestError ? (
        <Alert.Root appearance="subtle" tone="destructive">
          <Alert.Title level={4}>작업을 시작하지 못했습니다.</Alert.Title>
          <Alert.Description>{requestError}</Alert.Description>
        </Alert.Root>
      ) : null}

      {operation?.status === "failed" ? (
        <Alert.Root appearance="subtle" tone="destructive">
          <Alert.Title level={4}>{operation.title}에 실패했습니다.</Alert.Title>
          <Alert.Description>
            {operation.error?.message ?? "작업 기록에서 최근 출력을 확인하십시오."}
          </Alert.Description>
        </Alert.Root>
      ) : null}

      {loadError ? (
        <Alert.Root appearance="subtle" tone="destructive">
          <Alert.Title level={4}>업데이트 상태를 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>{loadError}</Alert.Description>
          <Alert.Action>
            <Button onClick={() => void load()} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}

      {loading && !snapshot ? (
        <div aria-label="도구 업데이트 상태 불러오는 중" className="overseer-tool-updates-loading">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {snapshot ? (
        <div className="overseer-tool-update-list" role="list">
          {snapshot.items.map((item) => {
            const updating = updatingId === item.id;
            const status = statusPresentation(item, updating);
            return (
              <section
                aria-labelledby={`overseer-tool-update-${item.id}`}
                className="overseer-tool-update-row"
                key={item.id}
                role="listitem"
              >
                <div className="overseer-tool-update-name">
                  <strong id={`overseer-tool-update-${item.id}`}>{item.label}</strong>
                  <span>
                    {item.managedByHomebrew
                      ? "Homebrew 관리"
                      : item.installed
                        ? "외부 설치"
                        : "설치되지 않음"}
                  </span>
                </div>
                <dl className="overseer-tool-update-versions">
                  <div>
                    <dt>현재</dt>
                    <dd>{item.currentVersion ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>최신</dt>
                    <dd>{item.latestVersion ?? "-"}</dd>
                  </div>
                </dl>
                <div className="overseer-tool-update-controls">
                  <div className="overseer-tool-update-state">
                    <Badge appearance="subtle" size="sm" tone={status.tone}>
                      {status.label === "최신" ? (
                        <Check aria-hidden="true" size={12} strokeWidth={2.25} />
                      ) : null}
                      {status.label}
                    </Badge>
                    {!item.automaticUpdate && item.automaticUpdateUnavailableReason ? (
                      <span>{item.automaticUpdateUnavailableReason}</span>
                    ) : null}
                  </div>
                  {item.automaticUpdate && item.updateAvailable ? (
                    <Button
                      disabled={controlsBusy}
                      onClick={() => void start(() => onUpdate(item.id))}
                      size="sm"
                      type="button"
                    >
                      {updating ? "업데이트 중…" : `${item.label} 업데이트`}
                    </Button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
