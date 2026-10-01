import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DockerCliPluginId,
  DockerCliPluginSnapshot,
  DockerCliPluginSummary,
} from "@contracts/contracts.ts";
import { apiRequest } from "@/shared/api";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CLI 도구 상태를 확인하지 못했습니다.";
}

export function DockerCliPluginsPage({
  isBusy,
  onInstall,
  refreshToken,
}: {
  isBusy(plugin: DockerCliPluginSummary): boolean;
  onInstall(id: DockerCliPluginId): Promise<void>;
  refreshToken: string;
}) {
  const [error, setError] = useState<string>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<DockerCliPluginSnapshot>();

  useEffect(() => {
    let active = true;
    setError(undefined);
    void apiRequest<DockerCliPluginSnapshot>("/docker-cli/plugins")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)));
    return () => {
      active = false;
    };
  }, [refreshToken, requestRevision]);

  if (error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>CLI 도구 상태를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
        <Alert.Action>
          <Button onClick={() => setRequestRevision((value) => value + 1)} size="sm">
            다시 시도
          </Button>
        </Alert.Action>
      </Alert.Root>
    );
  }

  if (!snapshot) return <Skeleton className="overseer-loading-table" />;

  return (
    <section className="overseer-panel" id="docker-cli-plugins">
      <header className="overseer-table-context">
        <p className="city-text-supporting">Docker에서 공식 지원하는 CLI 도구를 관리합니다.</p>
      </header>
      <DataTableRegion label="Docker CLI 도구 표">
        <Table.Root aria-label="Docker CLI 도구 목록" className="overseer-table" size="sm">
          <Table.Header>
            <Table.Row>
              <Table.Head className="overseer-table-column-wide">도구</Table.Head>
              <Table.Head className="overseer-table-column-state">상태</Table.Head>
              <Table.Head className="overseer-table-column-state">버전</Table.Head>
              <Table.Head className="overseer-table-column-state">관리 위치</Table.Head>
              <Table.Head aria-label="작업" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {snapshot.plugins.map((plugin) => {
              const busy = isBusy(plugin);
              return (
                <Table.Row key={plugin.id}>
                  <Table.Cell className="overseer-table-column-wide">
                    <div className="overseer-plugin-identity">
                      <strong>{plugin.label}</strong>
                      <span className="city-text-supporting">{plugin.description}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" tone={plugin.installed ? "success" : "neutral"}>
                      {plugin.installed ? "설치됨" : "설치 필요"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{plugin.version ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {plugin.management === "startup" ? "시작 준비" : "CLI 도구"}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="overseer-row-actions">
                      {plugin.management === "extensions" && !plugin.installed ? (
                        <Button
                          disabled={!plugin.installAvailable || busy}
                          onClick={() => void onInstall(plugin.id).catch(() => undefined)}
                          size="sm"
                        >
                          <Download aria-hidden="true" size={14} />
                          {busy ? "설치 중…" : "설치"}
                        </Button>
                      ) : plugin.installed ? (
                        <span className="city-text-supporting">사용 가능</span>
                      ) : (
                        <span className="city-text-supporting">
                          {plugin.installUnavailableReason}
                        </span>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </DataTableRegion>
    </section>
  );
}
