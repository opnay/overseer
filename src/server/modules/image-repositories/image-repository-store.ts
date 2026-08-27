import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ImageRepositorySummary } from "../../../shared/contracts.ts";
import { normalizeImageRepository } from "../../../shared/validation.ts";
import { openSqliteDatabase, type SqliteDatabase } from "../../infrastructure/sqlite.ts";

export interface ImageRepositoryStore {
  add(repository: ImageRepositorySummary): void;
  find(id: string): ImageRepositorySummary | undefined;
  findByRepository(repository: string): ImageRepositorySummary | undefined;
  list(): ImageRepositorySummary[];
  remove(id: string): boolean;
  updateSync(id: string, lastSyncedAt: string, tagCount: number): void;
}

export class MemoryImageRepositoryStore implements ImageRepositoryStore {
  private readonly repositories = new Map<string, ImageRepositorySummary>();

  add(repository: ImageRepositorySummary): void {
    this.repositories.set(repository.id, { ...repository });
  }

  find(id: string): ImageRepositorySummary | undefined {
    const repository = this.repositories.get(id);
    return repository ? { ...repository } : undefined;
  }

  findByRepository(repository: string): ImageRepositorySummary | undefined {
    return this.list().find((candidate) => candidate.repository === repository);
  }

  list(): ImageRepositorySummary[] {
    return [...this.repositories.values()]
      .map((repository) => ({ ...repository }))
      .sort((left, right) => left.repository.localeCompare(right.repository));
  }

  remove(id: string): boolean {
    return this.repositories.delete(id);
  }

  updateSync(id: string, lastSyncedAt: string, tagCount: number): void {
    const repository = this.repositories.get(id);
    if (!repository) return;
    this.repositories.set(id, { ...repository, lastSyncedAt, tagCount });
  }
}

interface ImageRepositoryRow {
  created_at: string;
  id: string;
  last_synced_at: string | null;
  repository: string;
  tag_count: number | null;
}

interface ImageRepositoryColumn {
  name: string;
}

function rowToSummary(row: ImageRepositoryRow): ImageRepositorySummary {
  return {
    createdAt: row.created_at,
    id: row.id,
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    repository: row.repository,
    ...(row.tag_count === null ? {} : { tagCount: row.tag_count }),
  };
}

export class SqliteImageRepositoryStore implements ImageRepositoryStore {
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

  add(repository: ImageRepositorySummary): void {
    this.db
      .prepare(
        `INSERT INTO image_repositories
          (id, repository, created_at, last_synced_at, tag_count)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        repository.id,
        repository.repository,
        repository.createdAt,
        repository.lastSyncedAt ?? null,
        repository.tagCount ?? null,
      );
  }

  find(id: string): ImageRepositorySummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, repository, created_at, last_synced_at, tag_count
         FROM image_repositories WHERE id = ?`,
      )
      .get(id) as ImageRepositoryRow | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  findByRepository(repository: string): ImageRepositorySummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, repository, created_at, last_synced_at, tag_count
         FROM image_repositories WHERE repository = ? COLLATE NOCASE`,
      )
      .get(repository) as ImageRepositoryRow | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  list(): ImageRepositorySummary[] {
    return (
      this.db
        .prepare(
          `SELECT id, repository, created_at, last_synced_at, tag_count
           FROM image_repositories ORDER BY repository COLLATE NOCASE`,
        )
        .all() as unknown as ImageRepositoryRow[]
    ).map(rowToSummary);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM image_repositories WHERE id = ?").run(id).changes > 0;
  }

  updateSync(id: string, lastSyncedAt: string, tagCount: number): void {
    this.db
      .prepare(`UPDATE image_repositories SET last_synced_at = ?, tag_count = ? WHERE id = ?`)
      .run(lastSyncedAt, tagCount, id);
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
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS image_repositories (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL,
        last_synced_at TEXT,
        tag_count INTEGER
      );
    `);
    const columns = this.database
      .prepare("PRAGMA table_info(image_repositories)")
      .all() as unknown as ImageRepositoryColumn[];
    if (columns.some(({ name }) => name === "provider")) {
      this.migrateProviderSchema(this.database);
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS image_repositories_repository
        ON image_repositories (repository COLLATE NOCASE);
    `);
    return this.database;
  }

  private migrateProviderSchema(database: SqliteDatabase): void {
    const repositories = database
      .prepare(
        `SELECT id, repository, created_at, last_synced_at, tag_count
         FROM image_repositories ORDER BY created_at`,
      )
      .all() as unknown as ImageRepositoryRow[];
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS image_repositories_next;
      CREATE TABLE image_repositories_next (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL,
        last_synced_at TEXT,
        tag_count INTEGER
      );
    `);
    try {
      const insert = database.prepare(
        `INSERT OR IGNORE INTO image_repositories_next
          (id, repository, created_at, last_synced_at, tag_count)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const repository of repositories) {
        insert.run(
          repository.id,
          normalizeImageRepository(repository.repository) ?? repository.repository,
          repository.created_at,
          repository.last_synced_at,
          repository.tag_count,
        );
      }
      database.exec(`
        DROP TABLE image_repositories;
        ALTER TABLE image_repositories_next RENAME TO image_repositories;
        COMMIT;
      `);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }
}
