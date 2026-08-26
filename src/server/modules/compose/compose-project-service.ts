import { stripVTControlCharacters } from "node:util";
import type {
  ComposeBuilderProjectDetail,
  ComposeBuilderSpec,
  ComposeProjectAction,
  ComposeProjectDetail,
  ComposeProjectSummary,
  ComposeServiceSummary,
  RegisterRemoteComposeInput,
  UpdateComposeBuilderInput,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import type { DockerCommand } from "../docker/index.ts";
import type { OperationProgress } from "../operations/index.ts";
import type { BuilderComposeRegistry } from "./builder-compose.ts";
import type { RemoteComposeRegistry } from "./remote-compose.ts";

interface DockerComposeProjectRow {
  ConfigFiles: string;
  Name: string;
  Status: string;
}

interface DockerComposeServiceRow {
  Health: string;
  ID: string;
  Image: string;
  Name: string;
  Ports: string;
  Service: string;
  State: string;
  Status: string;
}

function composeProjectRows(stdout: string): DockerComposeProjectRow[] {
  try {
    const value = JSON.parse(stdout || "[]") as unknown;
    if (Array.isArray(value)) return value as DockerComposeProjectRow[];
  } catch {
    // Fall through to the stable local error below.
  }
  throw new ExpectedError(
    "invalid_compose_output",
    "Docker Compose 프로젝트 목록을 해석하지 못했습니다.",
    503,
  );
}

export class ComposeProjectService {
  private readonly builderCompose: BuilderComposeRegistry;
  private readonly docker: DockerCommand;
  private readonly remoteCompose: RemoteComposeRegistry;

  constructor(
    docker: DockerCommand,
    remoteCompose: RemoteComposeRegistry,
    builderCompose: BuilderComposeRegistry,
  ) {
    this.docker = docker;
    this.remoteCompose = remoteCompose;
    this.builderCompose = builderCompose;
  }

  async list(): Promise<ComposeProjectSummary[]> {
    const [discovered, remoteProjects, builderProjects] = await Promise.all([
      this.discovered(),
      this.remoteCompose.list(),
      this.builderCompose.list(),
    ]);
    const discoveredByName = new Map(discovered.map((project) => [project.name, project]));
    const remote = remoteProjects.map((project): ComposeProjectSummary => {
      const active = discoveredByName.get(project.name);
      discoveredByName.delete(project.name);
      return {
        configFiles: [project.configFile],
        name: project.name,
        remote: {
          buildContext: project.buildContext,
          ...(project.checkError ? { checkError: project.checkError } : {}),
          checkedAt: project.checkedAt,
          updateAvailable: project.updateAvailable,
          url: project.url,
        },
        status: active?.status ?? (project.buildContext ? "blocked" : "registered"),
      };
    });
    const builder = builderProjects.map((project): ComposeProjectSummary => {
      const active = discoveredByName.get(project.name);
      discoveredByName.delete(project.name);
      return {
        builder: { configHash: project.configHash },
        configFiles: [project.configFile],
        name: project.name,
        status: active?.status ?? "registered",
      };
    });
    return [...remote, ...builder, ...discoveredByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async discovered(): Promise<ComposeProjectSummary[]> {
    const result = await this.docker(["compose", "ls", "--all", "--format", "json"]);
    return composeProjectRows(result.stdout).flatMap((row) => {
      const name = row.Name?.trim();
      const status = row.Status?.trim();
      const configFiles = row.ConfigFiles?.split(",")
        .map((file) => file.trim())
        .filter(Boolean);
      return name && status && configFiles.length > 0 ? [{ configFiles, name, status }] : [];
    });
  }

  async get(name: string): Promise<ComposeProjectDetail> {
    const project = await this.requireProject(name);
    const [result, configuration] = await Promise.all([
      this.compose(project, ["ps", "--all", "--format", "json"]),
      this.configuration(project),
    ]);
    const services = parseJsonLines<DockerComposeServiceRow>(result.stdout).map(
      (row): ComposeServiceSummary => ({
        health: row.Health,
        id: row.ID,
        image: row.Image,
        name: row.Name,
        ports: row.Ports,
        service: row.Service,
        state: row.State,
        status: row.Status,
      }),
    );
    return { ...project, configuration, services };
  }

  private async configuration(
    project: ComposeProjectSummary,
  ): Promise<ComposeProjectDetail["configuration"]> {
    if (project.remote) {
      const remote = await this.remoteCompose.get(project.name);
      if (!remote) {
        throw new ExpectedError(
          "remote_compose_not_found",
          "URL Compose 프로젝트를 찾을 수 없습니다.",
          404,
        );
      }
      return {
        checkedAt: remote.checkedAt,
        ...(remote.checkError ? { checkError: remote.checkError } : {}),
        contentHash: remote.contentHash,
        kind: "remote",
        ...(remote.pendingHash ? { pendingHash: remote.pendingHash } : {}),
        ...(remote.pendingContent ? { pendingYaml: remote.pendingContent } : {}),
        url: remote.url,
        yaml: remote.content,
      };
    }
    if (project.builder) {
      const builder = await this.builderCompose.get(project.name);
      if (!builder) {
        throw new ExpectedError(
          "builder_compose_not_found",
          "폼 Compose 프로젝트를 찾을 수 없습니다.",
          404,
        );
      }
      return {
        configHash: builder.configHash,
        kind: "builder",
        yaml: builder.yaml,
      };
    }
    return { configFiles: project.configFiles, kind: "discovered" };
  }

  async getBuilder(name: string): Promise<ComposeBuilderProjectDetail> {
    const project = await this.builderCompose.get(name);
    if (!project) {
      throw new ExpectedError(
        "builder_compose_not_found",
        "폼 Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return { configHash: project.configHash, spec: project.spec, yaml: project.yaml };
  }

  async logs(name: string): Promise<string> {
    const project = await this.requireProject(name);
    const result = await this.compose(project, [
      "logs",
      "--tail",
      "300",
      "--timestamps",
      "--no-color",
    ]);
    return stripVTControlCharacters(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).trim();
  }

  async action(
    name: string,
    action: ComposeProjectAction,
    progress?: OperationProgress,
  ): Promise<void> {
    const project = await this.requireProject(name);
    if (action === "up" && project.remote?.buildContext) {
      throw new ExpectedError(
        "compose_build_context_unsupported",
        "URL Compose의 build context는 로컬 소스가 없어 실행할 수 없습니다.",
        409,
      );
    }
    progress?.step(`Compose ${action} 실행 중`);
    const command = action === "up" ? ["up", "--detach"] : [action];
    await this.compose(project, command, action === "up" ? 10 * 60_000 : 120_000, progress);
  }

  async registerRemote(
    input: RegisterRemoteComposeInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const [discovered, builder] = await Promise.all([
      this.discovered(),
      this.builderCompose.list(),
    ]);
    await this.remoteCompose.register(
      input,
      [...discovered, ...builder].map(({ name }) => name),
      progress,
    );
  }

  async registerBuilder(spec: ComposeBuilderSpec, progress?: OperationProgress): Promise<void> {
    const [discovered, remote] = await Promise.all([this.discovered(), this.remoteCompose.list()]);
    await this.builderCompose.register(
      spec,
      [...discovered, ...remote].map(({ name }) => name),
      progress,
    );
  }

  async updateBuilder(
    name: string,
    input: UpdateComposeBuilderInput,
    progress?: OperationProgress,
  ): Promise<void> {
    if ((await this.discovered()).some((project) => project.name === name)) {
      throw new ExpectedError(
        "builder_compose_active",
        "폼 Compose 프로젝트를 먼저 내린 뒤 수정하십시오.",
        409,
      );
    }
    await this.builderCompose.update(name, input, progress);
  }

  async checkRemoteUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.remoteCompose.checkUpdate(name, progress);
  }

  async applyRemoteUpdate(name: string, progress?: OperationProgress): Promise<void> {
    await this.remoteCompose.applyUpdate(name, progress);
  }

  async removeRemote(name: string, progress?: OperationProgress): Promise<void> {
    const discovered = (await this.discovered()).find((project) => project.name === name);
    if (discovered) {
      throw new ExpectedError(
        "remote_compose_active",
        "URL Compose 프로젝트의 컨테이너와 네트워크를 먼저 내리십시오.",
        409,
      );
    }
    progress?.step("URL Compose 등록 해제 중");
    await this.remoteCompose.remove(name);
  }

  async removeBuilder(name: string, progress?: OperationProgress): Promise<void> {
    if ((await this.discovered()).some((project) => project.name === name)) {
      throw new ExpectedError(
        "builder_compose_active",
        "폼 Compose 프로젝트의 컨테이너와 네트워크를 먼저 내리십시오.",
        409,
      );
    }
    progress?.step("폼 Compose 등록 해제 중");
    await this.builderCompose.remove(name);
  }

  private async requireProject(name: string): Promise<ComposeProjectSummary> {
    const project = (await this.list()).find((candidate) => candidate.name === name);
    if (!project) {
      throw new ExpectedError(
        "compose_project_not_found",
        "Compose 프로젝트를 찾을 수 없습니다.",
        404,
      );
    }
    return project;
  }

  private async compose(
    project: ComposeProjectSummary,
    args: readonly string[],
    timeoutMs?: number,
    progress?: OperationProgress,
  ) {
    return this.docker(
      [
        "compose",
        "--project-name",
        project.name,
        ...project.configFiles.flatMap((file) => ["--file", file]),
        ...args,
      ],
      timeoutMs,
      progress,
    );
  }
}
