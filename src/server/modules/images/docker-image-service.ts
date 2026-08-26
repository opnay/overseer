import type {
  ImageDetail,
  ImageHistoryEntry,
  ImageRepositoryTags,
  ImageSummary,
  PullImageInput,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import { environmentValues, imageLabels, type DockerCommand } from "../docker/index.ts";
import type { OperationProgress } from "../operations/index.ts";

interface DockerImageRow {
  CreatedAt: string;
  CreatedSince: string;
  ID: string;
  Repository: string;
  Size: string;
  Tag: string;
}

interface DockerInspectImage {
  Architecture: string;
  Comment?: string;
  Config?: {
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
    Env?: string[] | null;
    ExposedPorts?: Record<string, unknown> | null;
    Labels?: Record<string, string> | null;
    WorkingDir?: string;
  } | null;
  Created: string;
  Id: string;
  Os: string;
  RepoDigests?: string[] | null;
  RepoTags?: string[] | null;
  RootFS?: { Layers?: string[] | null } | null;
  Size: number;
}

interface DockerImageHistoryRow {
  Comment: string;
  CreatedAt: string;
  CreatedBy: string;
  CreatedSince: string;
  ID: string;
  Size: string;
}

interface DockerHubTagResult {
  full_size?: number;
  images?: Array<{ architecture?: string; os?: string; variant?: string | null }>;
  last_updated?: string;
  name?: string;
}

const IMAGE_ROW_FORMAT = "{{json .}}";

function imageReferenceUrl(repository: string, tag: string): string {
  if (repository === "<none>") return "—";
  const firstSegment = repository.split("/", 1)[0] ?? repository;
  const hasRegistry =
    firstSegment === "localhost" || firstSegment.includes(".") || firstSegment.includes(":");
  const canonicalRepository = hasRegistry
    ? repository
    : repository.includes("/")
      ? `docker.io/${repository}`
      : `docker.io/library/${repository}`;
  return tag === "<none>" ? canonicalRepository : `${canonicalRepository}:${tag}`;
}

function parseImageInspectOutput(stdout: string): DockerInspectImage[] {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || value.length === 0) throw new Error("empty inspect output");
    return value as DockerInspectImage[];
  } catch {
    throw new ExpectedError(
      "invalid_image_output",
      "Docker 이미지 설정을 해석하지 못했습니다.",
      503,
    );
  }
}

function dockerHubRepository(repositoryTags: string[]): string | undefined {
  for (const repositoryTag of repositoryTags) {
    const reference = repositoryTag.split("@", 1)[0] ?? "";
    const lastSlash = reference.lastIndexOf("/");
    const lastColon = reference.lastIndexOf(":");
    const repository = lastColon > lastSlash ? reference.slice(0, lastColon) : reference;
    const segments = repository.split("/").filter(Boolean);
    const first = segments[0];
    if (!first) continue;
    const hasRegistry = first === "localhost" || first.includes(".") || first.includes(":");
    if (hasRegistry) {
      if (first !== "docker.io" && first !== "index.docker.io") continue;
      segments.shift();
    }
    if (segments.length === 1) return `library/${segments[0]}`;
    if (segments.length === 2) return segments.join("/");
  }
  return undefined;
}

export class DockerImageService {
  private readonly docker: DockerCommand;
  private readonly fetcher: typeof fetch;

  constructor(docker: DockerCommand, fetcher: typeof fetch = fetch) {
    this.docker = docker;
    this.fetcher = fetcher;
  }

  async pull(input: PullImageInput, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 받는 중");
    await this.docker(["image", "pull", input.image], 10 * 60_000, progress);
  }

  async remove(id: string, progress?: OperationProgress): Promise<void> {
    progress?.step("이미지 삭제 중");
    await this.docker(["image", "rm", id], 120_000, progress);
  }

  async get(id: string): Promise<ImageDetail> {
    const result = await this.docker(["image", "inspect", id]);
    const inspected = parseImageInspectOutput(result.stdout)[0]!;
    const config = inspected.Config ?? {};
    return {
      architecture: inspected.Architecture,
      command: [...(config.Cmd ?? [])],
      ...(inspected.Comment ? { comment: inspected.Comment } : {}),
      createdAt: inspected.Created,
      entrypoint: [...(config.Entrypoint ?? [])],
      environment: environmentValues(config.Env),
      exposedPorts: Object.keys(config.ExposedPorts ?? {}).sort(),
      id: inspected.Id,
      inspectJson: JSON.stringify(inspected, null, 2),
      labels: imageLabels(config.Labels),
      layers: [...(inspected.RootFS?.Layers ?? [])],
      operatingSystem: inspected.Os,
      repositoryDigests: [...(inspected.RepoDigests ?? [])].sort(),
      repositoryTags: [...(inspected.RepoTags ?? [])].sort(),
      sizeBytes: inspected.Size,
      ...(config.WorkingDir ? { workingDirectory: config.WorkingDir } : {}),
    };
  }

  async history(id: string): Promise<ImageHistoryEntry[]> {
    const result = await this.docker([
      "image",
      "history",
      "--no-trunc",
      "--format",
      IMAGE_ROW_FORMAT,
      id,
    ]);
    return parseJsonLines<DockerImageHistoryRow>(result.stdout)
      .slice(0, 500)
      .map((row) => ({
        ...(row.Comment ? { comment: row.Comment.slice(0, 500) } : {}),
        createdAt: row.CreatedAt,
        createdBy: row.CreatedBy.slice(0, 4_000),
        createdSince: row.CreatedSince,
        ...(row.ID && row.ID !== "<missing>" ? { id: row.ID } : {}),
        size: row.Size,
      }));
  }

  async repositoryTags(id: string, page: number): Promise<ImageRepositoryTags> {
    const detail = await this.get(id);
    const repository = dockerHubRepository(detail.repositoryTags);
    if (!repository) {
      throw new ExpectedError(
        "image_tags_unsupported",
        "공개 Docker Hub 저장소의 태그만 조회할 수 있습니다.",
        409,
      );
    }

    const [namespace, name] = repository.split("/");
    if (!namespace || !name) {
      throw new ExpectedError(
        "image_tags_unsupported",
        "Docker Hub 저장소를 확인할 수 없습니다.",
        409,
      );
    }
    const pageSize = 25;
    const url = new URL(
      `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(name)}/tags`,
    );
    url.searchParams.set("ordering", "last_updated");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));

    let value: unknown;
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        throw new ExpectedError(
          "image_tags_unavailable",
          "Docker Hub 태그 목록을 불러오지 못했습니다.",
          503,
        );
      }
      value = await response.json();
    } catch (error) {
      if (error instanceof ExpectedError) throw error;
      throw new ExpectedError(
        "image_tags_unavailable",
        "Docker Hub 태그 목록을 불러오지 못했습니다.",
        503,
      );
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError(
        "invalid_image_tags",
        "Docker Hub 태그 응답을 해석하지 못했습니다.",
        503,
      );
    }
    const source = value as { count?: unknown; results?: unknown };
    if (
      typeof source.count !== "number" ||
      !Number.isSafeInteger(source.count) ||
      source.count < 0 ||
      !Array.isArray(source.results)
    ) {
      throw new ExpectedError(
        "invalid_image_tags",
        "Docker Hub 태그 응답을 해석하지 못했습니다.",
        503,
      );
    }
    const results = (source.results as DockerHubTagResult[]).slice(0, pageSize);
    return {
      count: source.count,
      page,
      pageSize,
      repository,
      tags: results.flatMap((tag) => {
        if (
          typeof tag.name !== "string" ||
          typeof tag.last_updated !== "string" ||
          typeof tag.full_size !== "number" ||
          !Number.isFinite(tag.full_size) ||
          tag.full_size < 0
        ) {
          return [];
        }
        const platforms = (tag.images ?? [])
          .flatMap(({ architecture, os, variant }) =>
            architecture && architecture !== "unknown" && os && os !== "unknown"
              ? [`${os}/${architecture}${variant ? `/${variant}` : ""}`]
              : [],
          )
          .filter((platform, index, values) => values.indexOf(platform) === index)
          .sort();
        return [
          {
            lastUpdated: tag.last_updated,
            name: tag.name,
            platforms,
            sizeBytes: tag.full_size,
          },
        ];
      }),
    };
  }

  async list(): Promise<ImageSummary[]> {
    const result = await this.docker(["image", "ls", "--format", IMAGE_ROW_FORMAT]);
    const rows = parseJsonLines<DockerImageRow>(result.stdout);
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map(({ ID }) => ID))];
    const inspectResult = await this.docker(["image", "inspect", ...ids]);
    const platforms = new Map<string, string>();
    for (const image of parseImageInspectOutput(inspectResult.stdout)) {
      const id = image.Id.replace(/^sha256:/, "");
      const platform = `${image.Os}/${image.Architecture}`;
      platforms.set(id, platform);
      platforms.set(id.slice(0, 12), platform);
    }
    return rows.map((row) => ({
      createdAt: row.CreatedAt,
      createdSince: row.CreatedSince,
      id: row.ID,
      platform: platforms.get(row.ID) ?? "—",
      repository: row.Repository,
      size: row.Size,
      tag: row.Tag,
      url: imageReferenceUrl(row.Repository, row.Tag),
    }));
  }
}
