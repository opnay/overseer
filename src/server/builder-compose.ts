import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ComposeBuilderSpec, UpdateComposeBuilderInput } from "../shared/contracts.ts";
import { composeBuilderYaml, validateComposeBuilderSpec } from "../shared/compose-builder.ts";
import { ExpectedError } from "./errors.ts";
import type { CommandRunner } from "./lima-docker-runtime.ts";
import type { OperationProgress } from "./operations.ts";
import { runCommand } from "./process.ts";
import { validateComposeContent } from "./remote-compose.ts";

export interface BuilderComposeProject {
  configFile: string;
  configHash: string;
  name: string;
  spec: ComposeBuilderSpec;
  yaml: string;
}

interface BuilderComposeRow {
  config_hash: string;
  name: string;
  spec_json: string;
  yaml: string;
}

export interface BuilderComposeRegistry {
  get(name: string): Promise<BuilderComposeProject | undefined>;
  list(): Promise<BuilderComposeProject[]>;
  register(
    spec: ComposeBuilderSpec,
    conflictingNames: readonly string[],
    progress?: OperationProgress,
  ): Promise<BuilderComposeProject>;
  remove(name: string): Promise<void>;
  update(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<BuilderComposeProject>;
}

function specHash(spec: ComposeBuilderSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function mapRow(row: BuilderComposeRow, configFile: string): BuilderComposeProject {
  return {
    configFile,
    configHash: row.config_hash,
    name: row.name,
    spec: JSON.parse(row.spec_json) as ComposeBuilderSpec,
    yaml: row.yaml,
  };
}

export class BuilderComposeStore {
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

  list(): BuilderComposeProject[] {
    return (
      this.db
        .prepare(
          "SELECT name, spec_json, config_hash, yaml FROM builder_compose_projects ORDER BY name",
        )
        .all() as unknown as BuilderComposeRow[]
    ).map((row) => mapRow(row, this.configFile(row.name)));
  }

  get(name: string): BuilderComposeProject | undefined {
    const row = this.db
      .prepare(
        "SELECT name, spec_json, config_hash, yaml FROM builder_compose_projects WHERE name = ?",
      )
      .get(name) as unknown as BuilderComposeRow | undefined;
    return row ? mapRow(row, this.configFile(name)) : undefined;
  }

  insert(spec: ComposeBuilderSpec, yaml: string): void {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO builder_compose_projects (
            name, spec_json, config_hash, yaml, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(spec.name, JSON.stringify(spec), specHash(spec), yaml, now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ExpectedError(
          "builder_compose_conflict",
          "같은 이름의 폼 Compose 프로젝트가 이미 있습니다.",
          409,
        );
      }
      throw error;
    }
  }

  update(name: string, input: UpdateComposeBuilderInput, yaml: string): void {
    const current = this.get(name);
    if (!current) {
      throw new ExpectedError(
        "builder_compose_not_found",
        "폼 Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    if (current.configHash !== input.expectedConfigHash) {
      throw new ExpectedError(
        "builder_compose_changed",
        "Compose 구성이 변경되었습니다. 다시 불러온 뒤 수정하십시오.",
        409,
      );
    }
    this.db
      .prepare(
        `UPDATE builder_compose_projects
         SET spec_json = ?, config_hash = ?, yaml = ?, updated_at = ?
         WHERE name = ?`,
      )
      .run(JSON.stringify(input.spec), specHash(input.spec), yaml, new Date().toISOString(), name);
  }

  delete(name: string): void {
    const result = this.db.prepare("DELETE FROM builder_compose_projects WHERE name = ?").run(name);
    if (result.changes === 0) {
      throw new ExpectedError(
        "builder_compose_not_found",
        "폼 Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
  }

  async materialize(project: BuilderComposeProject): Promise<string> {
    const file = this.configFile(project.name);
    await mkdir(dirname(file), { recursive: true });
    try {
      if ((await readFile(file, "utf8")) === project.yaml) return file;
    } catch {
      // Write the current SQLite content below.
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, project.yaml, { encoding: "utf8", mode: 0o600 });
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
      CREATE TABLE IF NOT EXISTS builder_compose_projects (
        name TEXT PRIMARY KEY,
        spec_json TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        yaml TEXT NOT NULL,
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

export class BuilderComposeService implements BuilderComposeRegistry {
  private readonly command: CommandRunner;
  private readonly store: BuilderComposeStore;
  private readonly validateImplementation?: (name: string, content: string) => Promise<void>;

  constructor(
    command: CommandRunner = runCommand,
    options: {
      store?: BuilderComposeStore;
      validate?: (name: string, content: string) => Promise<void>;
    } = {},
  ) {
    this.command = command;
    this.store = options.store ?? new BuilderComposeStore();
    this.validateImplementation = options.validate;
  }

  async list(): Promise<BuilderComposeProject[]> {
    return Promise.all(this.store.list().map((project) => this.materialized(project)));
  }

  async get(name: string): Promise<BuilderComposeProject | undefined> {
    const project = this.store.get(name);
    return project ? this.materialized(project) : undefined;
  }

  async register(
    spec: ComposeBuilderSpec,
    conflictingNames: readonly string[],
    progress?: OperationProgress,
  ): Promise<BuilderComposeProject> {
    this.assertSpec(spec);
    if (conflictingNames.includes(spec.name)) {
      throw new ExpectedError(
        "builder_compose_conflict",
        "같은 이름의 Compose 프로젝트가 이미 있습니다.",
        409,
      );
    }
    const yaml = composeBuilderYaml(spec);
    progress?.step("Compose YAML 검증 중");
    await this.validate(spec.name, yaml);
    this.store.insert(spec, yaml);
    const project = this.require(spec.name);
    progress?.step("Compose 파일 저장 중");
    return this.materialized(project);
  }

  async update(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<BuilderComposeProject> {
    if (name !== input.spec.name) {
      throw new ExpectedError(
        "builder_compose_name_immutable",
        "프로젝트 이름은 수정할 수 없습니다.",
        409,
      );
    }
    this.assertSpec(input.spec);
    const yaml = composeBuilderYaml(input.spec);
    progress?.step("Compose YAML 검증 중");
    await this.validate(name, yaml);
    this.store.update(name, input, yaml);
    progress?.step("Compose 파일 저장 중");
    return this.materialized(this.require(name));
  }

  async remove(name: string): Promise<void> {
    this.require(name);
    await this.store.removeMaterialized(name);
    this.store.delete(name);
  }

  private assertSpec(spec: ComposeBuilderSpec): void {
    const issue = validateComposeBuilderSpec(spec)[0];
    if (issue) throw new ExpectedError("invalid_compose_builder", issue.message, 400);
  }

  private require(name: string): BuilderComposeProject {
    const project = this.store.get(name);
    if (!project) {
      throw new ExpectedError(
        "builder_compose_not_found",
        "폼 Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return project;
  }

  private async materialized(project: BuilderComposeProject): Promise<BuilderComposeProject> {
    return { ...project, configFile: await this.store.materialize(project) };
  }

  private async validate(name: string, yaml: string): Promise<void> {
    if (this.validateImplementation) return this.validateImplementation(name, yaml);
    await validateComposeContent(this.command, name, yaml);
  }
}
