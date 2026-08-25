export interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): { changes: number };
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteDatabaseConstructor {
  new (path: string, options?: Record<string, unknown>): SqliteDatabase;
}

interface SqliteModule {
  Database?: SqliteDatabaseConstructor;
  DatabaseSync?: SqliteDatabaseConstructor;
}

const isBun = typeof (process.versions as { bun?: string }).bun === "string";
const moduleName = isBun ? "bun:sqlite" : "node:sqlite";
const sqliteModule = (await import(moduleName)) as unknown as SqliteModule;
const Database = isBun ? sqliteModule.Database : sqliteModule.DatabaseSync;

if (!Database) throw new Error("SQLite 구현을 불러오지 못했습니다.");
const RuntimeDatabase: SqliteDatabaseConstructor = Database;

export function openSqliteDatabase(path: string): SqliteDatabase {
  const database = new RuntimeDatabase(
    path,
    isBun ? { create: true, strict: true } : { enableForeignKeyConstraints: true, timeout: 5_000 },
  );
  if (isBun) {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }
  return database;
}
