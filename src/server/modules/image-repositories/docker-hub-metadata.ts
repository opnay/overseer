import type { ImageRepositoryMetadata } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";

export async function getDockerHubMetadata(
  name: string,
  fetcher: typeof fetch,
): Promise<ImageRepositoryMetadata> {
  const [namespace, ...repository] = name.split("/");
  const url = new URL(
    `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace!)}/repositories/${encodeURIComponent(repository.join("/"))}`,
  );
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Docker Hub: ${response.status}`);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid metadata");
    const source = value as Record<string, unknown>;
    const description =
      typeof source.description === "string" ? source.description.trim() : undefined;
    const fullDescription =
      typeof source.full_description === "string" ? source.full_description.trim() : undefined;
    const lastUpdated =
      typeof source.last_updated === "string" && Number.isFinite(Date.parse(source.last_updated))
        ? source.last_updated
        : undefined;
    return {
      description: description || undefined,
      fullDescription: fullDescription || undefined,
      lastUpdated,
    };
  } catch {
    throw new ExpectedError(
      "image_repository_metadata_unavailable",
      "Docker Hub 저장소 설명을 불러오지 못했습니다.",
      503,
    );
  }
}
