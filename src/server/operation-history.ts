import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OperationSnapshot } from "../shared/contracts.ts";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite.ts";

export type OperationRetryMethod = "DELETE" | "PATCH" | "POST";

export interface OperationRetryRequest {
  body?: unknown;
  method: OperationRetryMethod;
  path: string;
}

export interface PersistedOperation {
  retryRequest?: OperationRetryRequest;
  snapshot: OperationSnapshot;
}

export interface OperationHistoryStore {
  list(): PersistedOperation[];
  recoverInterrupted(finishedAt?: string): void;
  save(operation: PersistedOperation): void;
}

interface OperationHistoryRow {
  record_json: string;
}

function parseRecord(row: OperationHistoryRow): PersistedOperation | undefined {
  try {
    const value = JSON.parse(row.record_json) as Partial<PersistedOperation>;
    if (
      !value.snapshot ||
      typeof value.snapshot.id !== "string" ||
      typeof value.snapshot.createdAt !== "string"
    ) {
      return undefined;
    }
    return value as PersistedOperation;
  } catch {
    return undefined;
  }
}

export class SqliteOperationHistoryStore implements OperationHistoryStore {
  readonly dataDirectory: string;
  private readonly databasePath: string;
  private database?: SqliteDatabase;

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

  list(): PersistedOperation[] {
    const rows = this.db
      .prepare("SELECT record_json FROM operation_history ORDER BY created_at DESC")
      .all() as unknown as OperationHistoryRow[];
    return rows.flatMap((row) => {
      const record = parseRecord(row);
      return record ? [record] : [];
    });
  }

  recoverInterrupted(finishedAt = new Date().toISOString()): void {
    const rows = this.db
      .prepare("SELECT record_json FROM operation_history WHERE status IN ('queued', 'running')")
      .all() as unknown as OperationHistoryRow[];
    for (const row of rows) {
      const record = parseRecord(row);
      if (!record) continue;
      record.snapshot.error = {
        code: "operation_interrupted",
        message: "서버가 재시작되어 작업 결과를 확인할 수 없습니다. 다시 시도하십시오.",
      };
      record.snapshot.finishedAt = finishedAt;
      record.snapshot.status = "failed";
      record.snapshot.step = "서버 재시작으로 중단됨";
      record.snapshot.retryable = Boolean(record.retryRequest);
      this.save(record);
    }
  }

  save(operation: PersistedOperation): void {
    this.db
      .prepare(
        `INSERT INTO operation_history (id, created_at, status, record_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           created_at = excluded.created_at,
           status = excluded.status,
           record_json = excluded.record_json`,
      )
      .run(
        operation.snapshot.id,
        operation.snapshot.createdAt,
        operation.snapshot.status,
        JSON.stringify(operation),
      );
  }

  private get db(): SqliteDatabase {
    if (this.database) return this.database;
    if (this.databasePath !== ":memory:") {
      mkdirSync(this.dataDirectory, { mode: 0o700, recursive: true });
      chmodSync(this.dataDirectory, 0o700);
      mkdirSync(dirname(this.databasePath), { mode: 0o700, recursive: true });
    }
    this.database = openSqliteDatabase(this.databasePath);
    if (this.databasePath !== ":memory:") chmodSync(this.databasePath, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS operation_history (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operation_history_created_at
        ON operation_history (created_at DESC);
      CREATE INDEX IF NOT EXISTS operation_history_status
        ON operation_history (status);
    `);
    return this.database;
  }
}
