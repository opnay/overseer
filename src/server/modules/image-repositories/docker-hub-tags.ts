import { ExpectedError } from "../../core/errors.ts";
import { isImageTag } from "../../../shared/validation.ts";

export interface RemoteRepositoryTag {
  digest?: string;
  name: string;
}

export function manifestDigest(value: unknown): string | undefined {
  return typeof value === "string" && /^(sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export async function getDockerHubTags(
  repository: string,
  fetcher: typeof fetch,
): Promise<RemoteRepositoryTag[]> {
  const parts = repository.split("/");
  if (parts.length !== 2) {
    throw new ExpectedError(
      "invalid_image_repository",
      "Docker Hub 저장소 주소를 확인하십시오.",
      409,
    );
  }
  const [namespace, name] = parts as [string, string];
  const base = new URL(
    `https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(name)}/tags`,
  );
  const readPage = async (page: number) => {
    const url = new URL(base);
    url.searchParams.set("page_size", "100");
    url.searchParams.set("page", String(page));
    let value: unknown;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Docker Hub request failed");
      value = await response.json();
    } catch {
      throw new ExpectedError(
        "image_repository_tags_unavailable",
        "Docker Hub 태그 목록을 불러오지 못했습니다.",
        503,
      );
    }
    const source = value as { count?: unknown; results?: unknown } | null;
    if (
      !source ||
      !Number.isSafeInteger(source.count) ||
      Number(source.count) < 0 ||
      !Array.isArray(source.results)
    ) {
      throw new ExpectedError(
        "invalid_image_repository_tags",
        "Docker Hub 태그 응답을 해석하지 못했습니다.",
        503,
      );
    }
    const tags = source.results.map((value: unknown): RemoteRepositoryTag => {
      const tag = value as { name?: unknown; digest?: unknown } | null;
      if (!tag || typeof tag.name !== "string" || !isImageTag(tag.name)) {
        throw new ExpectedError(
          "invalid_image_repository_tags",
          "Docker Hub 태그 응답을 해석하지 못했습니다.",
          503,
        );
      }
      return { name: tag.name, digest: manifestDigest(tag.digest) };
    });
    return { count: Number(source.count), tags };
  };

  const first = await readPage(1);
  const pages = Math.ceil(first.count / 100);
  if (pages > 100) {
    throw new ExpectedError(
      "image_repository_tag_limit",
      "태그가 너무 많아 이미지 저장소 동기화를 완료하지 못했습니다.",
      503,
    );
  }
  const tags = new Map(first.tags.map((tag) => [tag.name, tag]));
  for (let page = 2; page <= pages; page += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - page + 1) }, (_, offset) => readPage(page + offset)),
    );
    for (const result of batch) for (const tag of result.tags) tags.set(tag.name, tag);
  }
  return [...tags.values()];
}
