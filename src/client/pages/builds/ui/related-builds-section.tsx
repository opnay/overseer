import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Link } from "react-router";
import type { RelatedBuildsResponse } from "@contracts/builds.ts";
import { formatDateTime } from "@/shared/lib/date-time";
import {
  buildDetailPath,
  buildStatusPresentation,
  formatBuildDuration,
  type BuildRequestState,
} from "../model/build-history.ts";

function BuildStatusBadge({ status }: { status: keyof typeof buildStatusPresentation }) {
  const presentation = buildStatusPresentation[status];
  return (
    <Badge appearance="subtle" size="sm" tone={presentation.tone}>
      {presentation.label}
    </Badge>
  );
}

function LoadingRelatedBuilds() {
  return (
    <section aria-label="이전 빌드 찾는 중" className="overseer-detail-loading">
      <Skeleton />
      <Skeleton className="overseer-loading-table" />
    </section>
  );
}

export function RelatedBuildsSection({
  buildId,
  instance,
  onRetry,
  searchParams,
  state,
}: {
  buildId: string;
  instance: string;
  onRetry(): void;
  searchParams: URLSearchParams;
  state?: BuildRequestState<RelatedBuildsResponse>;
}) {
  if (!state?.data && state?.loading !== false) return <LoadingRelatedBuilds />;

  if (!state?.data && state?.error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>이전 빌드 분석을 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{state.error.message}</Alert.Description>
        <Alert.Action>
          <Button onClick={onRetry} size="sm" variant="outline">
            다시 시도
          </Button>
        </Alert.Action>
      </Alert.Root>
    );
  }

  if (!state?.data) return <LoadingRelatedBuilds />;

  const related = state.data;
  const records = related.records.slice(0, 5);
  const partial = related.failedCount > 0 || related.limited;

  return (
    <section
      aria-busy={state.loading || undefined}
      aria-label="이전 빌드 분석"
      className="overseer-detail-section"
    >
      {state.error ? (
        <Alert.Root tone="warning">
          <Alert.Title level={2}>새 비교 결과를 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>
            {state.error.message} 이전에 불러온 결과를 표시합니다.
          </Alert.Description>
          <Alert.Action>
            <Button onClick={onRetry} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}
      <header>
        <div>
          <h3 className="city-text-subsection-title">저장된 입력 기준으로 비교</h3>
          <p>
            저장된 저장소·컨텍스트, Dockerfile, 대상·플랫폼 값을 비교합니다. 기록되지 않은 입력은
            비교하지 못해 동일 환경이나 재현을 보장하지 않습니다.
          </p>
        </div>
      </header>
      {partial ? (
        <Alert.Root tone="info">
          <Alert.Title level={2}>일부 후보만 확인했습니다.</Alert.Title>
          <Alert.Description>
            후보 {related.candidateCount}개 중 {related.scannedCount}개를 확인했습니다.
            {related.failedCount > 0 ? ` ${related.failedCount}개 조회에 실패했습니다.` : ""}
            {related.limited ? " 조회 한도로 일부 후보를 건너뛰었습니다." : ""}
          </Alert.Description>
        </Alert.Root>
      ) : null}
      {!related.matchAvailable ? (
        <p className="overseer-detail-empty-copy">
          비교에 필요한 저장소 또는 컨텍스트, Dockerfile 기록이 부족합니다.
        </p>
      ) : records.length === 0 ? (
        <p className="overseer-detail-empty-copy">
          {partial
            ? "현재 확인한 후보 중 일치하는 이전 빌드가 없습니다."
            : "일치하는 이전 빌드가 없습니다."}
        </p>
      ) : (
        <>
          <DataTableRegion className="overseer-data-table-region" label="이전 빌드 표">
            <Table.Root aria-label="이전 빌드" className="overseer-table" size="sm">
              <Table.Caption className="overseer-table-caption">
                {buildId} 빌드와 저장된 입력이 일치하는 기록
              </Table.Caption>
              <Table.Header>
                <Table.Row>
                  <Table.Head>빌드</Table.Head>
                  <Table.Head>상태</Table.Head>
                  <Table.Head>시작 시각</Table.Head>
                  <Table.Head>소요 시간</Table.Head>
                  <Table.Head>캐시 단계</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {records.map((record) => (
                  <Table.Row key={record.id}>
                    <Table.Cell className="overseer-table-column-wide">
                      <Link
                        className="overseer-detail-link"
                        to={buildDetailPath(record.id, instance, searchParams)}
                      >
                        {record.name || record.id}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      <BuildStatusBadge status={record.status} />
                    </Table.Cell>
                    <Table.Cell>
                      <time dateTime={record.startedAt}>{formatDateTime(record.startedAt)}</time>
                    </Table.Cell>
                    <Table.Cell>{formatBuildDuration(record)}</Table.Cell>
                    <Table.Cell>
                      {record.cachedSteps === undefined ? "—" : `${record.cachedSteps}개`}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </DataTableRegion>
          <p className="city-text-supporting">가까운 이전 기록 최대 5개를 표시합니다.</p>
        </>
      )}
    </section>
  );
}
