import type {
  CreateNamedResourceInput,
  VolumeDetail,
  VolumeSummary,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import { imageLabels, type DockerCommand } from "../docker/index.ts";
import type { OperationProgress } from "../operations/index.ts";

interface DockerVolumeRow {
  Driver: string;
  Labels: string;
  Name: string;
  Scope: string;
}

interface DockerInspectVolume {
  CreatedAt?: string;
  Driver: string;
  Labels?: Record<string, string> | null;
  Mountpoint: string;
  Name: string;
  Options?: Record<string, string> | null;
  Scope: string;
}

const VOLUME_ROW_FORMAT = "{{json .}}";

function parseVolumeInspectOutput(stdout: string): DockerInspectVolume {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    const inspected = value[0] as Partial<DockerInspectVolume>;
    if (
      typeof inspected.Name !== "string" ||
      typeof inspected.Driver !== "string" ||
      typeof inspected.Mountpoint !== "string" ||
      typeof inspected.Scope !== "string"
    ) {
      throw new Error("invalid volume inspect output");
    }
    return inspected as DockerInspectVolume;
  } catch {
    throw new ExpectedError(
      "invalid_volume_output",
      "Docker 볼륨 원본 정보를 해석하지 못했습니다.",
      503,
    );
  }
}

export class DockerVolumeService {
  private readonly docker: DockerCommand;

  constructor(docker: DockerCommand) {
    this.docker = docker;
  }

  async create(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void> {
    progress?.step("볼륨 만드는 중");
    await this.docker(["volume", "create", input.name], undefined, progress);
  }

  async remove(name: string, progress?: OperationProgress): Promise<void> {
    progress?.step("볼륨 삭제 중");
    await this.docker(["volume", "rm", name], undefined, progress);
  }

  async list(): Promise<VolumeSummary[]> {
    const result = await this.docker(["volume", "ls", "--format", VOLUME_ROW_FORMAT]);
    return parseJsonLines<DockerVolumeRow>(result.stdout).map((row) => ({
      driver: row.Driver,
      labels: row.Labels,
      name: row.Name,
      scope: row.Scope,
    }));
  }

  async get(name: string): Promise<VolumeDetail> {
    const result = await this.docker(["volume", "inspect", name]);
    const inspected = parseVolumeInspectOutput(result.stdout);
    return {
      ...(inspected.CreatedAt ? { createdAt: inspected.CreatedAt } : {}),
      driver: inspected.Driver,
      inspectJson: JSON.stringify(inspected, null, 2),
      labels: imageLabels(inspected.Labels),
      mountpoint: inspected.Mountpoint,
      name: inspected.Name,
      options: imageLabels(inspected.Options),
      scope: inspected.Scope,
    };
  }
}
