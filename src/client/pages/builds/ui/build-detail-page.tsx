import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { BuildDetailResponse, BuildLogsResponse } from "@contracts/builds.ts";
import { apiRequest } from "@/shared/api";
import { formatDateTime } from "@/shared/lib/date-time";
import { LogViewer } from "@/shared/ui/log-viewer";
import { SectionedWorkspace } from "@/shared/ui/sectioned-workspace";
import { useUrlSection } from "@/shared/lib/url-section";
import {
  buildDetailRequestPath,
  buildsListPath,
  buildLogsRequestPath,
  buildRequestFailure,
  buildStatusPresentation,
  formatBuildDuration,
  isAbortError,
  type BuildRequestState,
} from "../model/build-history.ts";

type BuildDetailSection = "inputs" | "logs" | "overview";

const sectionPresentation: Record<BuildDetailSection, { description: string; label: string }> = {
  inputs: {
    description: "빌드에 사용된 입력, 재료와 첨부물 메타데이터를 확인합니다.",
    label: "입력",
  },
  logs: {
    description: "BuildKit 기록에서 제공한 빌드 출력을 확인합니다.",
    label: "로그",
  },
  overview: {
    description: "빌드 결과, 시각과 단계 요약을 확인합니다.",
    label: "개요",
  },
};

const sectionOrder: BuildDetailSection[] = ["overview", "logs", "inputs"];
const detailNavigation = [
  {
    items: sectionOrder.map((value) => ({ label: sectionPresentation[value].label, value })),
    label: "빌드",
  },
];

function Definition({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function BuildStatusBadge({ status }: { status: keyof typeof buildStatusPresentation }) {
  const presentation = buildStatusPresentation[status];
  return (
    <Badge appearance="subtle" size="sm" tone={presentation.tone}>
      {presentation.label}
    </Badge>
  );
}

function BuildErrorAlert({
  code,
  message,
  onRetry,
  title,
}: {
  code?: string;
  message: string;
  onRetry(): void;
  title: string;
}) {
  return (
    <Alert.Root tone="destructive">
      <Alert.Title level={2}>{title}</Alert.Title>
      <Alert.Description>{message}</Alert.Description>
      <Alert.Action>
        {code === "buildx_unavailable" ? (
          <Button
            nativeButton={false}
            render={<Link to="/docker-plugins" />}
            size="sm"
            variant="outline"
          >
            CLI 도구 열기
          </Button>
        ) : (
          <Button onClick={onRetry} size="sm" variant="outline">
            다시 시도
          </Button>
        )}
      </Alert.Action>
    </Alert.Root>
  );
}

function detailErrorTitle(code?: string): string {
  if (code === "build_not_found") return "빌드 기록을 찾을 수 없습니다.";
  if (code === "build_instance_changed") return "활성 엔진이 변경되었습니다.";
  if (code === "buildx_unavailable") return "Buildx를 사용할 수 없습니다.";
  return "빌드 상세를 불러오지 못했습니다.";
}

function DetailSkeleton() {
  return (
    <section aria-label="빌드 상세 불러오는 중" className="overseer-detail-loading">
      <Skeleton />
      <Skeleton />
      <Skeleton className="overseer-loading-table" />
    </section>
  );
}

export function BuildDetailPage({
  activeInstance,
  id,
  refreshToken,
  searchParams,
}: {
  activeInstance: string;
  id: string;
  refreshToken: string;
  searchParams: URLSearchParams;
}) {
  const instance = searchParams.get("instance")?.trim() ?? "";
  const scopeKey = JSON.stringify([id, instance, activeInstance]);
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: "overview",
    values: sectionOrder,
  });
  const [requestRevision, setRequestRevision] = useState(0);
  const [detailState, setDetailState] = useState<BuildRequestState<BuildDetailResponse>>();
  const detailRequestKey = scopeKey;
  const visibleDetailState = detailState?.key === detailRequestKey ? detailState : undefined;
  const detail = visibleDetailState?.data;
  const [logsState, setLogsState] = useState<BuildRequestState<BuildLogsResponse>>();
  const buildStatus = detail?.build.status;
  const logRequestKey = JSON.stringify([scopeKey, buildStatus ?? "unavailable"]);
  const visibleLogsState = logsState?.key === logRequestKey ? logsState : undefined;

  useEffect(() => {
    if (!instance) {
      setDetailState({
        error: {
          message: "상세 URL에 빌드 엔진 정보가 없습니다. 빌드 목록에서 다시 선택해 주세요.",
        },
        key: detailRequestKey,
        loading: false,
      });
      return;
    }

    const controller = new AbortController();
    setDetailState((previous) => {
      const current = previous?.key === detailRequestKey ? previous : undefined;
      return { data: current?.data, key: detailRequestKey, loading: true };
    });
    void apiRequest<BuildDetailResponse>(buildDetailRequestPath(id, instance), {
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.instance !== instance || next.build.id !== id) {
          throw new Error("응답한 빌드 기록이 요청한 엔진 또는 빌드와 다릅니다.");
        }
        setDetailState({ data: next, key: detailRequestKey, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setDetailState((previous) => {
          const current = previous?.key === detailRequestKey ? previous : undefined;
          return {
            data: current?.data,
            error: buildRequestFailure(error, "빌드 상세를 불러오지 못했습니다."),
            key: detailRequestKey,
            loading: false,
          };
        });
      });

    return () => controller.abort();
  }, [activeInstance, detailRequestKey, id, instance, refreshToken, requestRevision]);

  useEffect(() => {
    if (section !== "logs" || !instance || !buildStatus) return;
    if (buildStatus === "running") {
      setLogsState({
        key: logRequestKey,
        loading: false,
      });
      return;
    }

    const controller = new AbortController();
    setLogsState((previous) => {
      const current = previous?.key === logRequestKey ? previous : undefined;
      return { data: current?.data, key: logRequestKey, loading: true };
    });
    void apiRequest<BuildLogsResponse>(buildLogsRequestPath(id, instance), {
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.instance !== instance) {
          throw new Error("응답한 로그가 요청한 엔진과 다릅니다.");
        }
        setLogsState({ data: next, key: logRequestKey, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setLogsState((previous) => {
          const current = previous?.key === logRequestKey ? previous : undefined;
          return {
            data: current?.data,
            error: buildRequestFailure(error, "빌드 로그를 불러오지 못했습니다."),
            key: logRequestKey,
            loading: false,
          };
        });
      });

    return () => controller.abort();
  }, [buildStatus, id, instance, logRequestKey, refreshToken, requestRevision, section]);

  const retry = () => setRequestRevision((revision) => revision + 1);
  const presentation = sectionPresentation[section];
  const logUnsupported =
    detail?.build.status === "running" || visibleLogsState?.error?.code === "build_running";

  return (
    <article className="overseer-detail-page">
      <Button
        className="self-start"
        nativeButton={false}
        render={<Link to={buildsListPath(searchParams)} />}
        size="sm"
        variant="outline"
      >
        <ArrowLeft aria-hidden="true" size={14} />
        빌드 목록
      </Button>

      {!instance ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={2}>빌드 엔진을 확인할 수 없습니다.</Alert.Title>
          <Alert.Description>
            상세 URL에 엔진 정보가 없습니다. 빌드 목록에서 기록을 다시 선택해 주세요.
          </Alert.Description>
        </Alert.Root>
      ) : !detail && visibleDetailState?.error ? (
        <BuildErrorAlert
          code={visibleDetailState.error.code}
          message={visibleDetailState.error.message}
          onRetry={retry}
          title={detailErrorTitle(visibleDetailState.error.code)}
        />
      ) : null}

      {!detail ? (
        visibleDetailState?.loading === false || !instance ? null : (
          <DetailSkeleton />
        )
      ) : (
        <>
          {visibleDetailState.error ? (
            <BuildErrorAlert
              code={visibleDetailState.error.code}
              message={visibleDetailState.error.message}
              onRetry={retry}
              title="빌드 상세를 새로 고치지 못했습니다."
            />
          ) : null}
          <SectionedWorkspace<BuildDetailSection>
            category="빌드"
            description={presentation.description}
            getSectionHref={getSectionHref}
            groups={detailNavigation}
            navigationLabel="빌드 상세 메뉴"
            onSectionChange={setSection}
            section={section}
            title={presentation.label}
          >
            {section === "overview" ? (
              <>
                <section aria-label="빌드 개요" className="overseer-detail-summary">
                  <div>
                    <span>상태</span>
                    <strong>
                      <BuildStatusBadge status={detail.build.status} />
                    </strong>
                  </div>
                  <div>
                    <span>시작 시각</span>
                    <strong>
                      <time dateTime={detail.build.startedAt}>
                        {formatDateTime(detail.build.startedAt)}
                      </time>
                    </strong>
                  </div>
                  <div>
                    <span>소요 시간</span>
                    <strong>{formatBuildDuration(detail.build)}</strong>
                  </div>
                </section>
                <section className="overseer-detail-section">
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">빌드 정보</h3>
                    </div>
                  </header>
                  <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                    <Definition label="이름" value={detail.build.name || detail.build.id} />
                    <Definition
                      label="완료 시각"
                      value={
                        detail.build.completedAt ? (
                          <time dateTime={detail.build.completedAt}>
                            {formatDateTime(detail.build.completedAt)}
                          </time>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <Definition
                      label="완료 단계 / 전체"
                      value={
                        detail.build.completedSteps !== undefined &&
                        detail.build.totalSteps !== undefined
                          ? `${detail.build.completedSteps} / ${detail.build.totalSteps}`
                          : "—"
                      }
                    />
                    <Definition
                      label="캐시 단계 / 전체"
                      value={
                        detail.build.cachedSteps !== undefined &&
                        detail.build.totalSteps !== undefined
                          ? `${detail.build.cachedSteps} / ${detail.build.totalSteps}`
                          : "—"
                      }
                    />
                  </dl>
                </section>
                {detail.build.error ? (
                  <section className="overseer-detail-section">
                    <header>
                      <div>
                        <h3 className="city-text-subsection-title">빌드 오류</h3>
                      </div>
                    </header>
                    <LogViewer
                      ariaLabel="빌드 오류 출력"
                      emptyMessage="오류 출력이 없습니다."
                      height="compact"
                      value={detail.build.error}
                    />
                  </section>
                ) : null}
              </>
            ) : section === "logs" ? (
              logUnsupported ? (
                <Alert.Root tone="info">
                  <Alert.Title level={2}>진행 중인 빌드의 로그는 지원하지 않습니다.</Alert.Title>
                  <Alert.Description>빌드가 완료된 뒤 로그를 확인해 주세요.</Alert.Description>
                </Alert.Root>
              ) : (
                <>
                  {visibleLogsState?.error ? (
                    <Alert.Root tone="destructive">
                      <Alert.Title level={2}>빌드 로그를 불러오지 못했습니다.</Alert.Title>
                      <Alert.Description>{visibleLogsState.error.message}</Alert.Description>
                      <Alert.Action>
                        <Button onClick={retry} size="sm" variant="outline">
                          다시 시도
                        </Button>
                      </Alert.Action>
                    </Alert.Root>
                  ) : null}
                  <LogViewer
                    ariaLabel="빌드 로그"
                    context={<code>BuildKit 빌드 기록</code>}
                    emptyMessage="로그가 없습니다."
                    height="expanded"
                    loading={visibleLogsState?.loading ?? true}
                    value={visibleLogsState?.data?.logs.text ?? ""}
                  />
                </>
              )
            ) : (
              <div className="overseer-detail-section-list">
                <section className="overseer-detail-section">
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">빌드 입력</h3>
                    </div>
                  </header>
                  <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                    <Definition
                      label="컨텍스트"
                      value={detail.build.context ? <code>{detail.build.context}</code> : "—"}
                    />
                    <Definition
                      label="Dockerfile"
                      value={detail.build.dockerfile ? <code>{detail.build.dockerfile}</code> : "—"}
                    />
                    <Definition
                      label="대상"
                      value={detail.build.target ? <code>{detail.build.target}</code> : "—"}
                    />
                    <Definition
                      label="플랫폼"
                      value={
                        detail.build.platforms.length > 0 ? detail.build.platforms.join(", ") : "—"
                      }
                    />
                    <Definition
                      label="저장소"
                      value={detail.build.repository ? <code>{detail.build.repository}</code> : "—"}
                    />
                    <Definition
                      label="Revision"
                      value={detail.build.revision ? <code>{detail.build.revision}</code> : "—"}
                    />
                  </dl>
                </section>
                <section className="overseer-detail-section">
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">재료</h3>
                    </div>
                  </header>
                  {detail.build.materials.length === 0 ? (
                    <p className="overseer-detail-empty-copy">기록된 재료가 없습니다.</p>
                  ) : (
                    <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                      {detail.build.materials.map((material, index) => (
                        <Definition
                          key={`${material.uri}-${material.digest ?? ""}-${index}`}
                          label={`재료 ${index + 1}`}
                          value={
                            <>
                              <code>{material.uri}</code>
                              {material.digest ? (
                                <div>
                                  <span>Digest </span>
                                  <code>{material.digest}</code>
                                </div>
                              ) : null}
                            </>
                          }
                        />
                      ))}
                    </dl>
                  )}
                </section>
                <section className="overseer-detail-section">
                  <header>
                    <div>
                      <h3 className="city-text-subsection-title">첨부물</h3>
                    </div>
                  </header>
                  {detail.build.outputs.length === 0 ? (
                    <p className="overseer-detail-empty-copy">첨부물이 없습니다.</p>
                  ) : (
                    <dl className="overseer-detail-definitions overseer-detail-definitions--wide">
                      {detail.build.outputs.map((attachment, index) => (
                        <Definition
                          key={`${attachment.type}-${attachment.digest}-${attachment.platform ?? ""}-${index}`}
                          label={`첨부물 ${index + 1}`}
                          value={
                            <>
                              <div>
                                <span>유형 </span>
                                <code>{attachment.type}</code>
                              </div>
                              <div>
                                <span>Digest </span>
                                <code>{attachment.digest}</code>
                              </div>
                              {attachment.platform ? (
                                <div>
                                  <span>플랫폼 </span>
                                  <code>{attachment.platform}</code>
                                </div>
                              ) : null}
                            </>
                          }
                        />
                      ))}
                    </dl>
                  )}
                </section>
              </div>
            )}
          </SectionedWorkspace>
        </>
      )}
    </article>
  );
}
