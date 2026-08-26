import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite.ts";

export interface RuntimeInstanceStore {
  clearActiveInstanceName(name: string): void;
  getActiveInstanceName(): string | undefined;
  isManaged(name: string): boolean;
  markManaged(name: string): void;
  setActiveInstanceName(name: string): void;
  unmarkManaged(name: string): void;
}

export class MemoryRuntimeInstanceStore implements RuntimeInstanceStore {
  private activeInstanceName?: string;
  private readonly managed = new Set<string>();

  clearActiveInstanceName(name: string): void {
    if (this.activeInstanceName === name) this.activeInstanceName = undefined;
  }

  getActiveInstanceName(): string | undefined {
    return this.activeInstanceName;
  }

  isManaged(name: string): boolean {
    return this.managed.has(name);
  }

  markManaged(name: string): void {
    this.managed.add(name);
  }

  setActiveInstanceName(name: string): void {
    this.activeInstanceName = name;
  }

  unmarkManaged(name: string): void {
    this.managed.delete(name);
  }
}

export class SqliteRuntimeInstanceStore implements RuntimeInstanceStore {
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

  clearActiveInstanceName(name: string): void {
    this.db
      .prepare("DELETE FROM runtime_settings WHERE key = 'active_instance' AND value = ?")
      .run(name);
  }

  getActiveInstanceName(): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM runtime_settings WHERE key = 'active_instance'")
      .get() as { value?: unknown } | undefined;
    return typeof row?.value === "string" && row.value ? row.value : undefined;
  }

  isManaged(name: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM runtime_managed_instances WHERE name = ?").get(name),
    );
  }

  markManaged(name: string): void {
    this.db.prepare("INSERT OR IGNORE INTO runtime_managed_instances (name) VALUES (?)").run(name);
  }

  setActiveInstanceName(name: string): void {
    this.db
      .prepare(
        `INSERT INTO runtime_settings (key, value) VALUES ('active_instance', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(name);
  }

  unmarkManaged(name: string): void {
    this.db.prepare("DELETE FROM runtime_managed_instances WHERE name = ?").run(name);
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
      CREATE TABLE IF NOT EXISTS runtime_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_managed_instances (
        name TEXT PRIMARY KEY
      );
    `);
    return this.database;
  }
}
