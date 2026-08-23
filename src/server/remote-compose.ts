import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmodSync, mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isIP } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { RegisterRemoteComposeInput } from "../shared/contracts.ts";
import { isComposeProjectName } from "../shared/validation.ts";
import { ExpectedError } from "./errors.ts";
import type { CommandRunner } from "./lima-docker-runtime.ts";
import type { OperationProgress } from "./operations.ts";
import { CommandError, runCommand } from "./process.ts";

const MAX_COMPOSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface RemoteComposeProject {
  buildContext: boolean;
  checkError?: string;
  checkedAt: string;
  configFile: string;
  contentHash: string;
  name: string;
  updateAvailable: boolean;
  url: string;
}

interface StoredRemoteComposeProject extends RemoteComposeProject {
  content: string;
  etag?: string;
  lastModified?: string;
  pendingBuildContext?: boolean;
  pendingContent?: string;
  pendingEtag?: string;
  pendingHash?: string;
  pendingLastModified?: string;
}

interface RemoteComposeRow {
  build_context: number;
  check_error: string | null;
  checked_at: string;
  content: string;
  content_hash: string;
  etag: string | null;
  last_modified: string | null;
  name: string;
  pending_build_context: number | null;
  pending_content: string | null;
  pending_etag: string | null;
  pending_hash: string | null;
  pending_last_modified: string | null;
  url: string;
}

interface FetchedCompose {
  content: string;
  etag?: string;
  lastModified?: string;
  status: "fetched";
}

interface NotModifiedCompose {
  status: "not-modified";
}

type RemoteFetchResult = FetchedCompose | NotModifiedCompose;

export interface RemoteComposeFetcher {
  fetch(
    url: string,
    validators?: { etag?: string; lastModified?: string },
  ): Promise<RemoteFetchResult>;
}

export interface RemoteComposeRegistry {
  applyUpdate(name: string, progress?: OperationProgress): Promise<void>;
  checkUpdate(name: string, progress?: OperationProgress): Promise<void>;
  get(name: string): Promise<RemoteComposeProject | undefined>;
  list(): Promise<RemoteComposeProject[]>;
  register(
    input: RegisterRemoteComposeInput,
    conflictingNames: readonly string[],
    progress?: OperationProgress,
  ): Promise<RemoteComposeProject>;
  remove(name: string): Promise<void>;
}

type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;
type ResolveAddresses = (hostname: string) => Promise<string[]>;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

async function defaultResolveAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function optional(value: string | null): string | undefined {
  return value ?? undefined;
}

function mapRow(row: RemoteComposeRow, configFile: string): StoredRemoteComposeProject {
  return {
    buildContext: row.build_context === 1,
    ...(row.check_error ? { checkError: row.check_error } : {}),
    checkedAt: row.checked_at,
    configFile,
    content: row.content,
    contentHash: row.content_hash,
    ...(optional(row.etag) ? { etag: optional(row.etag) } : {}),
    ...(optional(row.last_modified) ? { lastModified: optional(row.last_modified) } : {}),
    name: row.name,
    ...(row.pending_build_context === null
      ? {}
      : { pendingBuildContext: row.pending_build_context === 1 }),
    ...(optional(row.pending_content) ? { pendingContent: optional(row.pending_content) } : {}),
    ...(optional(row.pending_etag) ? { pendingEtag: optional(row.pending_etag) } : {}),
    ...(optional(row.pending_hash) ? { pendingHash: optional(row.pending_hash) } : {}),
    ...(optional(row.pending_last_modified)
      ? { pendingLastModified: optional(row.pending_last_modified) }
      : {}),
    updateAvailable: Boolean(row.pending_hash && row.pending_hash !== row.content_hash),
    url: row.url,
  };
}

export class SafeRemoteComposeFetcher implements RemoteComposeFetcher {
  private readonly fetchImplementation: FetchImplementation;
  private readonly resolveAddresses: ResolveAddresses;

  constructor(
    fetchImplementation: FetchImplementation = (input, init) => fetch(input, init),
    resolveAddresses: ResolveAddresses = defaultResolveAddresses,
  ) {
    this.fetchImplementation = fetchImplementation;
    this.resolveAddresses = resolveAddresses;
  }

  async fetch(
    source: string,
    validators: { etag?: string; lastModified?: string } = {},
  ): Promise<RemoteFetchResult> {
    let url = this.parseUrl(source);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await this.assertPublicHost(url);
      let response: Response;
      try {
        response = await this.fetchImplementation(url.href, {
          headers: {
            accept: "application/yaml, application/x-yaml, text/yaml, text/plain, */*",
            ...(validators.etag ? { "if-none-match": validators.etag } : {}),
            ...(validators.lastModified ? { "if-modified-since": validators.lastModified } : {}),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new ExpectedError(
          "compose_url_fetch_failed",
          error instanceof Error && error.name === "TimeoutError"
            ? "Compose URL 응답 시간이 초과됐습니다."
            : "Compose URL을 가져오지 못했습니다.",
          502,
        );
      }

      if (response.status === 304) return { status: "not-modified" };
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) {
          throw new ExpectedError(
            "compose_url_redirect_failed",
            "Compose URL 리다이렉트를 확인하십시오.",
            400,
          );
        }
        await response.body?.cancel();
        url = this.parseUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ExpectedError(
          "compose_url_response_failed",
          `Compose URL이 HTTP ${response.status}로 응답했습니다.`,
          502,
        );
      }

      const content = await this.readBody(response);
      if (!content.trim()) {
        throw new ExpectedError("compose_url_empty", "Compose URL 내용이 비어 있습니다.", 400);
      }
      if (content.includes("\0")) {
        throw new ExpectedError("compose_url_invalid", "Compose URL 내용을 확인하십시오.", 400);
      }
      return {
        content,
        ...(response.headers.get("etag")
          ? { etag: response.headers.get("etag") ?? undefined }
          : {}),
        ...(response.headers.get("last-modified")
          ? { lastModified: response.headers.get("last-modified") ?? undefined }
          : {}),
        status: "fetched",
      };
    }
    throw new ExpectedError("compose_url_redirect_failed", "Compose URL을 확인하십시오.", 400);
  }

  private parseUrl(source: string): URL {
    if (source.length > 2_048) {
      throw new ExpectedError("invalid_compose_url", "Compose URL이 너무 깁니다.", 400);
    }
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new ExpectedError("invalid_compose_url", "유효한 Compose URL을 입력하십시오.", 400);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      throw new ExpectedError(
        "invalid_compose_url",
        "인증 정보가 없는 공개 HTTPS Compose URL만 사용할 수 있습니다.",
        400,
      );
    }
    url.hash = "";
    return url;
  }

  private async assertPublicHost(url: URL): Promise<void> {
    if (url.hostname.toLowerCase() === "localhost") {
      throw new ExpectedError(
        "compose_url_private",
        "사설 네트워크 URL은 사용할 수 없습니다.",
        400,
      );
    }
    let addresses: string[];
    try {
      addresses = await this.resolveAddresses(url.hostname);
    } catch {
      throw new ExpectedError(
        "compose_url_dns_failed",
        "Compose URL 호스트를 찾지 못했습니다.",
        400,
      );
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new ExpectedError(
        "compose_url_private",
        "사설 네트워크 URL은 사용할 수 없습니다.",
        400,
      );
    }
  }

  private async readBody(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPOSE_BYTES) {
      await response.body?.cancel();
      throw new ExpectedError("compose_url_too_large", "Compose 파일은 1MiB 이하여야 합니다.", 413);
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let content = "";
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_COMPOSE_BYTES) {
        await reader.cancel();
        throw new ExpectedError(
          "compose_url_too_large",
          "Compose 파일은 1MiB 이하여야 합니다.",
          413,
        );
      }
      content += decoder.decode(result.value, { stream: true });
    }
    return content + decoder.decode();
  }
}

export class RemoteComposeStore {
  readonly dataDirectory: string;
  private readonly databasePath: string;
  private database?: DatabaseSync;

  constructor(options: { dataDirectory?: string; databasePath?: string } = {}) {
    this.dataDirectory =
      options.dataDirectory ??
      process.env.OVERSEER_DATA_DIR ??
      join(homedir(), "Library", "Application Support", "Overseer");
    this.databasePath =
      options.databasePath ??
      process.env.OVERSEER_DATABASE_PATH ??
      join(this.dataDirectory, "overseer.sqlite");
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  list(): StoredRemoteComposeProject[] {
    return (
      this.db
        .prepare("SELECT * FROM remote_compose_projects ORDER BY name")
        .all() as unknown as RemoteComposeRow[]
    ).map((row) => mapRow(row, this.configFile(row.name)));
  }

  get(name: string): StoredRemoteComposeProject | undefined {
    const row = this.db
      .prepare("SELECT * FROM remote_compose_projects WHERE name = ?")
      .get(name) as unknown as RemoteComposeRow | undefined;
    return row ? mapRow(row, this.configFile(name)) : undefined;
  }

  hasNameOrUrl(name: string, url: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 AS found FROM remote_compose_projects WHERE name = ? OR url = ?")
        .get(name, url),
    );
  }

  insert(input: {
    buildContext: boolean;
    checkedAt: string;
    content: string;
    etag?: string;
    lastModified?: string;
    name: string;
    url: string;
  }): void {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO remote_compose_projects (
            name, url, content, content_hash, etag, last_modified, build_context,
            checked_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.url,
          input.content,
          hashContent(input.content),
          input.etag ?? null,
          input.lastModified ?? null,
          input.buildContext ? 1 : 0,
          input.checkedAt,
          now,
          now,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ExpectedError(
          "remote_compose_conflict",
          "같은 프로젝트 이름이나 URL이 이미 등록되어 있습니다.",
          409,
        );
      }
      throw error;
    }
  }

  markLatest(
    name: string,
    input: { checkedAt: string; etag?: string; lastModified?: string },
  ): void {
    this.db
      .prepare(
        `UPDATE remote_compose_projects
         SET checked_at = ?, check_error = NULL, etag = COALESCE(?, etag),
             last_modified = COALESCE(?, last_modified), pending_content = NULL,
             pending_hash = NULL, pending_etag = NULL, pending_last_modified = NULL,
             pending_build_context = NULL
         WHERE name = ?`,
      )
      .run(input.checkedAt, input.etag ?? null, input.lastModified ?? null, name);
  }

  markAvailable(
    name: string,
    input: {
      buildContext: boolean;
      checkedAt: string;
      content: string;
      etag?: string;
      lastModified?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE remote_compose_projects
         SET checked_at = ?, check_error = NULL, pending_content = ?, pending_hash = ?,
             pending_etag = ?, pending_last_modified = ?, pending_build_context = ?
         WHERE name = ?`,
      )
      .run(
        input.checkedAt,
        input.content,
        hashContent(input.content),
        input.etag ?? null,
        input.lastModified ?? null,
        input.buildContext ? 1 : 0,
        name,
      );
  }

  markCheckError(name: string, message: string, checkedAt: string): void {
    this.db
      .prepare("UPDATE remote_compose_projects SET checked_at = ?, check_error = ? WHERE name = ?")
      .run(checkedAt, message.slice(0, 1_000), name);
  }

  applyPending(name: string): void {
    const result = this.db
      .prepare(
        `UPDATE remote_compose_projects
         SET content = pending_content, content_hash = pending_hash,
             etag = pending_etag, last_modified = pending_last_modified,
             build_context = pending_build_context, pending_content = NULL,
             pending_hash = NULL, pending_etag = NULL, pending_last_modified = NULL,
             pending_build_context = NULL, check_error = NULL, updated_at = ?
         WHERE name = ? AND pending_content IS NOT NULL`,
      )
      .run(new Date().toISOString(), name);
    if (result.changes === 0) {
      throw new ExpectedError(
        "remote_compose_no_update",
        "적용할 Compose 업데이트가 없습니다.",
        409,
      );
    }
  }

  delete(name: string): void {
    const result = this.db.prepare("DELETE FROM remote_compose_projects WHERE name = ?").run(name);
    if (result.changes === 0) {
      throw new ExpectedError(
        "remote_compose_not_found",
        "URL Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
  }

  async materialize(project: StoredRemoteComposeProject): Promise<string> {
    const file = this.configFile(project.name);
    await mkdir(dirname(file), { recursive: true });
    try {
      if ((await readFile(file, "utf8")) === project.content) return file;
    } catch {
      // Write the current SQLite content below.
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, project.content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return file;
  }

  async removeMaterialized(name: string): Promise<void> {
    await rm(dirname(this.configFile(name)), { force: true, recursive: true });
  }

  private get db(): DatabaseSync {
    if (this.database) return this.database;
    if (this.databasePath !== ":memory:") {
      mkdirSync(this.dataDirectory, { mode: 0o700, recursive: true });
      chmodSync(this.dataDirectory, 0o700);
      mkdirSync(dirname(this.databasePath), { mode: 0o700, recursive: true });
    }
    this.database = new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    if (this.databasePath !== ":memory:") chmodSync(this.databasePath, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS remote_compose_projects (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        build_context INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT NOT NULL,
        check_error TEXT,
        pending_content TEXT,
        pending_hash TEXT,
        pending_etag TEXT,
        pending_last_modified TEXT,
        pending_build_context INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return this.database;
  }

  private configFile(name: string): string {
    return join(this.dataDirectory, "compose", name, "compose.yaml");
  }
}

export function deriveRemoteComposeProjectName(source: string): string {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new ExpectedError("invalid_compose_url", "유효한 Compose URL을 입력하십시오.", 400);
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  let candidate: string | undefined;
  if (url.hostname === "raw.githubusercontent.com" && segments.length >= 2) {
    candidate = segments[1];
  } else if (url.hostname === "github.com" && segments.length >= 2) {
    candidate = segments[1];
  }
  const file = basename(url.pathname).replace(/\.ya?ml$/i, "");
  if (!candidate) {
    candidate = /^(compose|docker-compose)$/i.test(file) ? segments.at(-2) : file;
  }
  const normalized = (candidate ?? "remote-compose")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return normalized && /^[a-z0-9]/.test(normalized) ? normalized : "remote-compose";
}

export class RemoteComposeService implements RemoteComposeRegistry {
  private readonly command: CommandRunner;
  private readonly fetcher: RemoteComposeFetcher;
  private readonly store: RemoteComposeStore;
  private readonly validateImplementation?: (
    name: string,
    content: string,
  ) => Promise<{ buildContext: boolean }>;

  constructor(
    command: CommandRunner = runCommand,
    options: {
      fetcher?: RemoteComposeFetcher;
      store?: RemoteComposeStore;
      validate?: (name: string, content: string) => Promise<{ buildContext: boolean }>;
    } = {},
  ) {
    this.command = command;
    this.fetcher = options.fetcher ?? new SafeRemoteComposeFetcher();
    this.store = options.store ?? new RemoteComposeStore();
    this.validateImplementation = options.validate;
  }

  async list(): Promise<RemoteComposeProject[]> {
    return Promise.all(this.store.list().map((project) => this.materialized(project)));
  }

  async get(name: string): Promise<RemoteComposeProject | undefined> {
    const project = this.store.get(name);
    return project ? this.materialized(project) : undefined;
  }

  async register(
    input: RegisterRemoteComposeInput,
    conflictingNames: readonly string[],
    progress?: OperationProgress,
  ): Promise<RemoteComposeProject> {
    const name = input.name?.trim() || deriveRemoteComposeProjectName(input.url);
    if (!isComposeProjectName(name)) {
      throw new ExpectedError(
        "invalid_compose_project_name",
        "프로젝트 이름은 소문자·숫자로 시작하고 소문자·숫자·밑줄·하이픈만 사용할 수 있습니다.",
        400,
      );
    }
    if (conflictingNames.includes(name)) {
      throw new ExpectedError(
        "remote_compose_conflict",
        "같은 이름의 Compose 프로젝트가 이미 실행 이력에 있습니다.",
        409,
      );
    }
    if (this.store.hasNameOrUrl(name, input.url)) {
      throw new ExpectedError(
        "remote_compose_conflict",
        "같은 프로젝트 이름이나 URL이 이미 등록되어 있습니다.",
        409,
      );
    }
    progress?.step("Compose URL 가져오는 중");
    const fetched = await this.fetcher.fetch(input.url);
    if (fetched.status !== "fetched") {
      throw new ExpectedError(
        "compose_url_not_modified",
        "Compose URL 내용을 받지 못했습니다.",
        502,
      );
    }
    progress?.step("Compose 구성 검증 중");
    const validation = await this.validate(name, fetched.content);
    const checkedAt = new Date().toISOString();
    this.store.insert({
      buildContext: validation.buildContext,
      checkedAt,
      content: fetched.content,
      ...(fetched.etag ? { etag: fetched.etag } : {}),
      ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      name,
      url: input.url,
    });
    const project = this.store.get(name);
    if (!project) throw new Error("registered remote compose project is missing");
    progress?.step("Compose 파일 저장 중");
    return this.materialized(project);
  }

  async checkUpdate(name: string, progress?: OperationProgress): Promise<void> {
    const project = this.require(name);
    const checkedAt = new Date().toISOString();
    try {
      progress?.step("원격 Compose 업데이트 확인 중");
      const fetched = await this.fetcher.fetch(project.url, {
        ...(project.etag ? { etag: project.etag } : {}),
        ...(project.lastModified ? { lastModified: project.lastModified } : {}),
      });
      if (fetched.status === "not-modified") {
        this.store.markLatest(name, { checkedAt });
        return;
      }
      if (hashContent(fetched.content) === project.contentHash) {
        this.store.markLatest(name, {
          checkedAt,
          ...(fetched.etag ? { etag: fetched.etag } : {}),
          ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
        });
        return;
      }
      progress?.step("새 Compose 구성 검증 중");
      const validation = await this.validate(name, fetched.content);
      this.store.markAvailable(name, {
        buildContext: validation.buildContext,
        checkedAt,
        content: fetched.content,
        ...(fetched.etag ? { etag: fetched.etag } : {}),
        ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      });
    } catch (error) {
      this.store.markCheckError(
        name,
        error instanceof Error ? error.message : "업데이트를 확인하지 못했습니다.",
        checkedAt,
      );
      throw error;
    }
  }

  async applyUpdate(name: string, progress?: OperationProgress): Promise<void> {
    this.require(name);
    progress?.step("Compose 업데이트 저장 중");
    this.store.applyPending(name);
    const project = this.require(name);
    await this.store.materialize(project);
  }

  async remove(name: string): Promise<void> {
    this.require(name);
    await this.store.removeMaterialized(name);
    this.store.delete(name);
  }

  private require(name: string): StoredRemoteComposeProject {
    const project = this.store.get(name);
    if (!project) {
      throw new ExpectedError(
        "remote_compose_not_found",
        "URL Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return project;
  }

  private async materialized(project: StoredRemoteComposeProject): Promise<RemoteComposeProject> {
    const configFile = await this.store.materialize(project);
    const {
      content: _content,
      etag: _etag,
      lastModified: _lastModified,
      pendingBuildContext: _pendingBuildContext,
      pendingContent: _pendingContent,
      pendingEtag: _pendingEtag,
      pendingHash: _pendingHash,
      pendingLastModified: _pendingLastModified,
      ...summary
    } = project;
    return { ...summary, configFile };
  }

  private async validate(name: string, content: string): Promise<{ buildContext: boolean }> {
    if (this.validateImplementation) return this.validateImplementation(name, content);
    const directory = await mkdtemp(join(tmpdir(), "overseer-compose-"));
    const file = join(directory, "compose.yaml");
    try {
      await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
      const result = await this.command(
        "docker",
        [
          "compose",
          "--project-name",
          name,
          "--file",
          file,
          "config",
          "--format",
          "json",
          "--no-interpolate",
          "--no-env-resolution",
          "--no-path-resolution",
        ],
        { timeoutMs: 30_000 },
      );
      const config = JSON.parse(result.stdout) as {
        services?: Record<string, { build?: unknown }>;
      };
      const services = Object.values(config.services ?? {});
      if (services.length === 0) {
        throw new ExpectedError(
          "invalid_compose_content",
          "Compose 파일에 서비스가 없습니다.",
          400,
        );
      }
      return { buildContext: services.some(({ build }) => build !== undefined && build !== null) };
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      if (error instanceof CommandError) {
        throw new ExpectedError(
          "invalid_compose_content",
          error.stderr.trim() || "Compose 파일을 해석하지 못했습니다.",
          400,
        );
      }
      throw new ExpectedError(
        "invalid_compose_content",
        "Compose 파일을 해석하지 못했습니다.",
        400,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}
