import {
  isBuildIdentifier,
  type BuildDetail,
  type BuildListQuery,
  type BuildRecord,
  type BuildStep,
  type RelatedBuilds,
  type BuildStatus,
} from "../../../shared/builds.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { DockerCommand } from "../docker/index.ts";

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_LOG_CHARACTERS = 250_000;
const MAX_STEP_LOG_BYTES = MAX_LOG_CHARACTERS * 4 + 3;
const LOG_TRUNCATION_MARKER = "\n\n[로그 길이 제한으로 나머지 내용이 생략되었습니다.]";
const MAX_RELATED_CANDIDATES = 20;
const RELATED_INSPECTION_CONCURRENCY = 4;

type JsonRecord = Record<string, unknown>;
type BuildOperation = "list" | "get" | "logs";

interface BuildVertex {
  id: string;
  name: string;
  cached: boolean;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface StepLog {
  chunks: Buffer[];
  byteLength: number;
  truncated: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEither(record: JsonRecord, lower: string, upper: string): unknown {
  return record[lower] ?? record[upper];
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function readTimestamp(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw unavailableError();
    return undefined;
  }

  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw unavailableError();
  }

  return value;
}

function readStepCount(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw unavailableError();
  }
  return value;
}

function normalizeStatus(value: unknown): BuildStatus {
  if (typeof value !== "string") throw unavailableError();

  switch (value.trim().toLowerCase()) {
    case "running":
      return "running";
    case "completed":
    case "succeeded":
      return "succeeded";
    case "error":
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

function readBuildId(value: unknown): string {
  if (typeof value !== "string") throw unavailableError();
  const id = value.split("/").at(-1) ?? "";
  if (!isBuildIdentifier(id)) throw unavailableError();
  return id;
}

function parseListRow(value: unknown): BuildRecord {
  if (!isRecord(value)) throw unavailableError();

  const name = readEither(value, "name", "Name");
  if (typeof name !== "string") throw unavailableError();

  return {
    id: readBuildId(readEither(value, "ref", "Ref") ?? value.ID),
    name,
    status: normalizeStatus(readEither(value, "status", "Status")),
    startedAt: readTimestamp(readEither(value, "created_at", "CreatedAt"), true)!,
    completedAt: readTimestamp(readEither(value, "completed_at", "CompletedAt"), false),
    totalSteps: readStepCount(readEither(value, "total_steps", "TotalSteps")),
    completedSteps: readStepCount(readEither(value, "completed_steps", "CompletedSteps")),
    cachedSteps: readStepCount(readEither(value, "cached_steps", "CachedSteps")),
  };
}

function parseList(stdout: string): BuildRecord[] {
  const text = stdout.trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      throw unavailableError();
    }
    if (!Array.isArray(rows)) throw unavailableError();
    return rows.map(parseListRow);
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        throw unavailableError();
      }
      return parseListRow(row);
    });
}

function readInspectJson(stdout: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw unavailableError();
  }
  if (!isRecord(value)) throw unavailableError();
  return value;
}

function normalizeDuration(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const durationMs = Math.round(value / 1_000_000);
  return Number.isFinite(durationMs) ? durationMs : undefined;
}

function normalizePlatforms(value: unknown): string[] {
  const platforms = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return platforms.filter(
    (platform): platform is string => typeof platform === "string" && platform.trim() !== "",
  );
}

function normalizeMaterials(value: unknown): BuildDetail["materials"] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((material) => {
    if (!isRecord(material)) return [];
    const uri = readOptionalString(material.URI);
    if (!uri) return [];

    const rawDigests = material.Digests;
    const digestValues = Array.isArray(rawDigests)
      ? rawDigests.filter((digest): digest is string => typeof digest === "string")
      : isRecord(rawDigests)
        ? [readOptionalString(rawDigests.sha256)].filter(
            (digest): digest is string => digest !== undefined,
          )
        : [];
    const rawDigest =
      digestValues.find((digest) => digest.startsWith("sha256:")) ?? digestValues[0];
    const digest = rawDigest
      ? /^[a-z][a-z0-9_+.-]*:/i.test(rawDigest)
        ? rawDigest
        : `sha256:${rawDigest}`
      : undefined;
    return [{ uri, digest }];
  });
}

function normalizeOutputs(value: unknown): BuildDetail["outputs"] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((attachment) => {
    if (!isRecord(attachment)) return [];
    const type = readOptionalString(attachment.Type);
    const digest = readOptionalString(attachment.Digest);
    if (!type || !digest) return [];

    const platform = readOptionalString(attachment.Platform);
    return [{ type, digest, platform }];
  });
}

function readStructuredError(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value.trim().slice(0, 4_000) || undefined;
  if (!isRecord(value) || depth >= 2) return undefined;

  for (const key of ["Message", "message", "Error", "error"]) {
    const message = readStructuredError(value[key], depth + 1);
    if (message) return message;
  }
  return undefined;
}

function parseDetail(value: JsonRecord, requestedId: string): BuildDetail {
  const ref = value.Ref;
  if (ref !== undefined && readBuildId(ref) !== requestedId) throw unavailableError();

  const nameValue = value.Name;
  if (nameValue !== undefined && typeof nameValue !== "string") throw unavailableError();
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue : requestedId;

  return {
    id: requestedId,
    name,
    status: normalizeStatus(value.Status),
    startedAt: readTimestamp(value.StartedAt, true)!,
    completedAt: readTimestamp(value.CompletedAt, false),
    durationMs: normalizeDuration(value.Duration),
    totalSteps: readStepCount(value.NumTotalSteps ?? value.TotalSteps),
    completedSteps: readStepCount(value.NumCompletedSteps ?? value.CompletedSteps),
    cachedSteps: readStepCount(value.NumCachedSteps ?? value.CachedSteps),
    context: readOptionalString(value.Context),
    dockerfile: readOptionalString(value.Dockerfile),
    target: readOptionalString(value.Target),
    platforms: normalizePlatforms(value.Platform),
    repository: readOptionalString(value.VCSRepository),
    revision: readOptionalString(value.VCSRevision),
    error: readStructuredError(value.Error),
    materials: normalizeMaterials(value.Materials),
    outputs: normalizeOutputs(value.Attachments),
  };
}

function stripTerminalControls(value: string): string {
  /* eslint-disable no-control-regex -- Remove terminal control sequences from build logs. */
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u009D[^\u0007\u009C]*(?:\u0007|\u009C)/g, "")
    .replace(/[\u0090\u0098\u009E\u009F][\s\S]*?\u009C/g, "")
    .replace(/\u009B[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B[P^_X][\s\S]*?\u001B\\/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g, "");
  /* eslint-enable no-control-regex */
}

function normalizeLogs(value: string, outputTruncated = false): string {
  const sanitized = stripTerminalControls(value);
  if (sanitized.length <= MAX_LOG_CHARACTERS) {
    return outputTruncated ? `${sanitized}${LOG_TRUNCATION_MARKER}` : sanitized;
  }

  let text = sanitized.slice(0, MAX_LOG_CHARACTERS);
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) text = text.slice(0, -1);
  return `${text}${LOG_TRUNCATION_MARKER}`;
}

function readStepTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function decodeBase64(value: string): Buffer {
  const padded = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  const unpadded = /^[A-Za-z0-9+/]*$/.test(value) && value.length % 4 !== 1;
  if (!padded && !unpadded) throw unavailableError();

  const bytes = Buffer.from(value, "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (canonical !== value.replace(/=+$/, "")) throw unavailableError();
  return bytes;
}

function appendStepLog(log: StepLog, encodedChunk: string): void {
  const chunk = decodeBase64(encodedChunk);
  const remainingBytes = Math.max(0, MAX_STEP_LOG_BYTES - log.byteLength);
  const acceptedBytes = Math.min(chunk.byteLength, remainingBytes);

  if (acceptedBytes > 0) {
    log.chunks.push(chunk.subarray(0, acceptedBytes));
    log.byteLength += acceptedBytes;
  }
  if (acceptedBytes < chunk.byteLength) log.truncated = true;
}

function normalizeStepLog(log: StepLog | undefined): { text: string; truncated: boolean } {
  if (!log) return { text: "", truncated: false };

  const decoded = Buffer.concat(log.chunks, log.byteLength).toString("utf8");
  const sanitized = stripTerminalControls(decoded);
  const truncated = log.truncated || sanitized.length > MAX_LOG_CHARACTERS;
  if (sanitized.length <= MAX_LOG_CHARACTERS) return { text: sanitized, truncated };

  let text = sanitized.slice(0, MAX_LOG_CHARACTERS);
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) text = text.slice(0, -1);
  return { text, truncated };
}

function parseBuildSteps(rawJson: string): BuildStep[] {
  const vertices = new Map<string, BuildVertex>();
  const vertexOrder: string[] = [];
  const logs = new Map<string, StepLog>();

  for (const line of rawJson.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw unavailableError();
    }
    if (!isRecord(parsed)) throw unavailableError();

    if (parsed.vertexes !== undefined) {
      if (!Array.isArray(parsed.vertexes)) throw unavailableError();

      for (const value of parsed.vertexes) {
        if (!isRecord(value) || typeof value.digest !== "string" || !value.digest) {
          throw unavailableError();
        }

        let vertex = vertices.get(value.digest);
        if (!vertex) {
          vertex = { id: value.digest, name: value.digest, cached: false };
          vertices.set(value.digest, vertex);
          vertexOrder.push(value.digest);
        }

        const name = readOptionalString(value.name);
        if (name) vertex.name = name;
        if (typeof value.cached === "boolean") vertex.cached = value.cached;

        const startedAt = readStepTimestamp(value.started);
        if (startedAt) vertex.startedAt = startedAt;
        const completedAt = readStepTimestamp(value.completed);
        if (completedAt) vertex.completedAt = completedAt;

        const error = readStructuredError(value.error);
        if (error) vertex.error = error;
      }
    }

    if (parsed.logs !== undefined) {
      if (!Array.isArray(parsed.logs)) throw unavailableError();

      for (const value of parsed.logs) {
        if (
          !isRecord(value) ||
          typeof value.vertex !== "string" ||
          typeof value.data !== "string"
        ) {
          throw unavailableError();
        }

        let stepLog = logs.get(value.vertex);
        if (!stepLog) {
          stepLog = { chunks: [], byteLength: 0, truncated: false };
          logs.set(value.vertex, stepLog);
        }
        appendStepLog(stepLog, value.data);
      }
    }
  }

  return vertexOrder.map((id) => {
    const vertex = vertices.get(id)!;
    const stepLog = normalizeStepLog(logs.get(id));
    const durationMs =
      vertex.startedAt && vertex.completedAt
        ? Date.parse(vertex.completedAt) - Date.parse(vertex.startedAt)
        : undefined;

    return {
      id,
      name: vertex.name,
      status: vertex.error
        ? "failed"
        : vertex.completedAt
          ? "succeeded"
          : vertex.startedAt
            ? "running"
            : "pending",
      cached: vertex.cached,
      startedAt: vertex.startedAt,
      completedAt: vertex.completedAt,
      durationMs:
        durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
          ? durationMs
          : undefined,
      error: vertex.error,
      log: stepLog.text,
      logTruncated: stepLog.truncated,
    };
  });
}

function hasRelatedSource(build: BuildDetail): boolean {
  return Boolean(build.repository || build.context) && Boolean(build.dockerfile);
}

function sameRelatedSource(current: BuildDetail, candidate: BuildDetail): boolean {
  const samePlatforms = (left: string[], right: string[]) => {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return (
      sortedLeft.length === sortedRight.length &&
      sortedLeft.every((platform, index) => platform === sortedRight[index])
    );
  };

  return (
    (current.repository ?? "") === (candidate.repository ?? "") &&
    (current.context ?? "") === (candidate.context ?? "") &&
    (current.dockerfile ?? "") === (candidate.dockerfile ?? "") &&
    (current.target ?? "") === (candidate.target ?? "") &&
    samePlatforms(current.platforms, candidate.platforms)
  );
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return error instanceof Error ? error.message : "";

  const values = [error.message, error.stderr, error.stdout];
  const cause = error.cause;
  if (cause instanceof Error) values.push(cause.message);
  else if (isRecord(cause)) values.push(cause.message);
  return values.filter((value): value is string => typeof value === "string").join("\n");
}

function isOutputLimitError(error: unknown): error is JsonRecord {
  return isRecord(error) && error.code === "OUTPUT_LIMIT_EXCEEDED";
}

function unavailableError(): ExpectedError {
  return new ExpectedError(
    "build_history_unavailable",
    "Docker 빌드 이력을 조회하지 못했습니다.",
    503,
  );
}

function commandFailure(error: unknown, operation: BuildOperation): ExpectedError {
  if (error instanceof ExpectedError) return error;

  const details = errorText(error);
  if (
    /(?:unknown|unrecognized) command[^\n]*(?:buildx|history)|(?:buildx|history)[^\n]*(?:unknown|unrecognized) command|is not a docker command|history command[^\n]*(?:not supported|unavailable)/i.test(
      details,
    )
  ) {
    return new ExpectedError(
      "buildx_unavailable",
      "Docker Buildx 빌드 이력을 사용할 수 없습니다.",
      503,
    );
  }

  if (
    operation !== "list" &&
    /(?:no record found|record not found|build[^\n]{0,80}not found)/i.test(details)
  ) {
    return new ExpectedError("build_not_found", "빌드 기록을 찾을 수 없습니다.", 404);
  }

  return unavailableError();
}

function assertBuildId(id: string): void {
  if (!isBuildIdentifier(id)) {
    throw new ExpectedError("invalid_build_id", "유효하지 않은 빌드 식별자입니다.", 400);
  }
}

export class DockerBuildService {
  private readonly docker: DockerCommand;

  constructor(docker: DockerCommand) {
    this.docker = docker;
  }

  private async readAll(): Promise<BuildRecord[]> {
    let result;
    try {
      result = await this.docker(
        ["buildx", "--builder", "default", "history", "ls", "--format", "json"],
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      throw commandFailure(error, "list");
    }

    try {
      return parseList(result.stdout);
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw unavailableError();
    }
  }

  async list(query: BuildListQuery): Promise<{
    records: BuildRecord[];
    count: number;
    page: number;
    pageSize: number;
  }> {
    const records = await this.readAll();
    const search = query.name?.toLowerCase();
    const filtered = records
      .filter((record) => !search || record.name.toLowerCase().includes(search))
      .filter((record) => !query.status || record.status === query.status)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    const offset = Math.max(0, (query.page - 1) * query.pageSize);

    return {
      records: filtered.slice(offset, offset + query.pageSize),
      count: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<BuildDetail> {
    assertBuildId(id);

    let result;
    try {
      result = await this.docker(
        ["buildx", "--builder", "default", "history", "inspect", "--format", "json", id],
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      throw commandFailure(error, "get");
    }

    try {
      return parseDetail(readInspectJson(result.stdout), id);
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw unavailableError();
    }
  }

  async logs(id: string): Promise<{ text: string }> {
    assertBuildId(id);
    const build = await this.get(id);
    if (build.status === "running") {
      throw new ExpectedError(
        "build_running",
        "진행 중인 빌드 로그는 아직 조회할 수 없습니다.",
        409,
      );
    }

    let result;
    try {
      result = await this.docker(
        ["buildx", "--builder", "default", "history", "logs", "--progress", "plain", id],
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      if (isOutputLimitError(error)) {
        const partial = readOptionalString(error.stderr) ?? readOptionalString(error.stdout) ?? "";
        return { text: normalizeLogs(partial, true) };
      }
      throw commandFailure(error, "logs");
    }

    return { text: normalizeLogs(result.stderr || result.stdout) };
  }

  async steps(id: string): Promise<BuildStep[]> {
    const build = await this.get(id);
    if (build.status === "running") {
      throw new ExpectedError(
        "build_running",
        "진행 중인 빌드 로그는 아직 조회할 수 없습니다.",
        409,
      );
    }

    let result;
    try {
      result = await this.docker(
        ["buildx", "--builder", "default", "history", "logs", "--progress", "rawjson", id],
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      if (isOutputLimitError(error)) {
        throw new ExpectedError(
          "build_steps_too_large",
          "단계 기록이 조회 용량을 초과했습니다. 로그 탭에서 보관 출력의 앞부분을 확인하십시오.",
          413,
        );
      }
      throw commandFailure(error, "logs");
    }

    try {
      const rawJson = result.stderr.trim() ? result.stderr : result.stdout;
      return parseBuildSteps(rawJson);
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw unavailableError();
    }
  }

  async related(id: string): Promise<RelatedBuilds> {
    const current = await this.get(id);
    const records = await this.readAll();
    const older = records
      .filter(
        (record) =>
          record.id !== current.id && Date.parse(record.startedAt) < Date.parse(current.startedAt),
      )
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    const candidateCount = older.length;
    const limited = candidateCount > MAX_RELATED_CANDIDATES;

    if (!hasRelatedSource(current)) {
      return {
        records: [],
        scannedCount: 0,
        candidateCount,
        failedCount: 0,
        limited,
        matchAvailable: false,
      };
    }

    const candidates = older.slice(0, MAX_RELATED_CANDIDATES);
    const matches: (BuildRecord | undefined)[] = new Array(candidates.length);
    let nextIndex = 0;
    let scannedCount = 0;
    let failedCount = 0;

    const inspectCandidates = async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = candidates[index]!;
        scannedCount += 1;

        try {
          const detail = await this.get(candidate.id);
          if (sameRelatedSource(current, detail)) matches[index] = candidate;
        } catch {
          failedCount += 1;
        }
      }
    };

    const workerCount = Math.min(RELATED_INSPECTION_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: workerCount }, () => inspectCandidates()));

    return {
      records: matches.filter((record): record is BuildRecord => record !== undefined).slice(0, 5),
      scannedCount,
      candidateCount,
      failedCount,
      limited,
      matchAvailable: true,
    };
  }
}
