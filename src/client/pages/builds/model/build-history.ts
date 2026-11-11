import type { BuildRecord, BuildStatus } from "@contracts/builds.ts";
import { ApiRequestError } from "@/shared/api";

export const BUILD_HISTORY_PAGE_SIZE = 20;

export const buildStatusPresentation: Record<
  BuildStatus,
  { label: string; tone: "destructive" | "info" | "neutral" | "success" }
> = {
  failed: { label: "실패", tone: "destructive" },
  running: { label: "진행 중", tone: "info" },
  succeeded: { label: "성공", tone: "success" },
  unknown: { label: "알 수 없음", tone: "neutral" },
};

const buildStatuses = Object.keys(buildStatusPresentation) as BuildStatus[];

export interface BuildRequestFailure {
  code?: string;
  message: string;
}

export interface BuildRequestState<Data> {
  data?: Data;
  error?: BuildRequestFailure;
  key: string;
  loading: boolean;
}

export function isBuildStatus(value: string | null): value is BuildStatus {
  return value !== null && buildStatuses.includes(value as BuildStatus);
}

export function buildPageFromSearch(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function buildNameFromSearch(params: URLSearchParams): string {
  return params.get("filter[name]")?.trim() ?? "";
}

export function buildStatusFromSearch(params: URLSearchParams): BuildStatus | "all" {
  const status = params.get("filter[status]");
  return isBuildStatus(status) ? status : "all";
}

export function buildListSearchParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  const page = params.get("page");
  if (page !== null) result.set("page", String(buildPageFromSearch(params)));

  const name = buildNameFromSearch(params);
  if (name) result.set("filter[name]", name);

  const status = buildStatusFromSearch(params);
  if (status !== "all") result.set("filter[status]", status);

  return result;
}

export function updateBuildListSearch(
  params: URLSearchParams,
  update: { name?: string; page?: number; status?: BuildStatus | "all" },
): URLSearchParams {
  const result = buildListSearchParams(params);
  if (update.name !== undefined) {
    const name = update.name.trim();
    if (name) result.set("filter[name]", name);
    else result.delete("filter[name]");
  }
  if (update.status !== undefined) {
    if (update.status === "all") result.delete("filter[status]");
    else result.set("filter[status]", update.status);
  }
  if (update.page !== undefined) result.set("page", String(Math.max(1, update.page)));
  return result;
}

export function buildsListPath(params: URLSearchParams): string {
  const search = buildListSearchParams(params).toString();
  return `/builds${search ? `?${search}` : ""}`;
}

export function buildDetailPath(id: string, instance: string, params: URLSearchParams): string {
  const search = buildListSearchParams(params);
  search.set("instance", instance);
  return `/builds/${encodeURIComponent(id)}?${search.toString()}`;
}

export function buildListRequestPath(
  instance: string,
  page: number,
  name: string,
  status: BuildStatus | "all",
): string {
  const params = new URLSearchParams({
    instance,
    page: String(page),
    pageSize: String(BUILD_HISTORY_PAGE_SIZE),
  });
  if (name) params.set("filter[name]", name);
  if (status !== "all") params.set("filter[status]", status);
  return `/builds?${params.toString()}`;
}

export function buildDetailRequestPath(id: string, instance: string): string {
  const params = new URLSearchParams({ instance });
  return `/builds/${encodeURIComponent(id)}?${params.toString()}`;
}

export function buildLogsRequestPath(id: string, instance: string): string {
  const params = new URLSearchParams({ instance });
  return `/builds/${encodeURIComponent(id)}/logs?${params.toString()}`;
}

export function buildRequestFailure(error: unknown, fallback: string): BuildRequestFailure {
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message };
  return { message: error instanceof Error ? error.message : fallback };
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export function formatBuildDuration(
  record: Pick<BuildRecord, "completedAt" | "durationMs" | "startedAt">,
): string {
  let durationMs = record.durationMs;
  if (durationMs === undefined && record.completedAt) {
    const startedAt = new Date(record.startedAt).getTime();
    const completedAt = new Date(record.completedAt).getTime();
    if (Number.isFinite(startedAt) && Number.isFinite(completedAt)) {
      durationMs = Math.max(0, completedAt - startedAt);
    }
  }
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return "—";

  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  if (minutes > 0) return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`;
  return `${seconds}초`;
}
