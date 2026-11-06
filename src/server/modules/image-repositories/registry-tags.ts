import type { ParsedImageRepository } from "../../../shared/validation.ts";
import { ExpectedError } from "../../core/errors.ts";

const MAX_TAG_PAGES = 100;
const TAG_PAGE_SIZE = 100;

interface RegistryTagPage {
  tags?: unknown;
}

interface TokenChallenge {
  realm: URL;
  scope?: string;
  service?: string;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function registryOrigin(registry: string): URL {
  const secure = new URL(`https://${registry === "docker.io" ? "registry-1.docker.io" : registry}`);
  secure.protocol = isLoopback(secure.hostname) ? "http:" : "https:";
  return secure;
}

function tokenChallenge(value: string | null): TokenChallenge | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (!match) return undefined;
  const parameters = new Map<string, string>();
  for (const parameter of match[1]!.matchAll(/([a-z]+)="([^"]*)"/gi)) {
    parameters.set(parameter[1]!.toLowerCase(), parameter[2]!);
  }
  const realmValue = parameters.get("realm");
  if (!realmValue) return undefined;
  let realm: URL;
  try {
    realm = new URL(realmValue);
  } catch {
    return undefined;
  }
  if (
    (realm.protocol !== "https:" && !(realm.protocol === "http:" && isLoopback(realm.hostname))) ||
    realm.username ||
    realm.password
  ) {
    return undefined;
  }
  return {
    realm,
    ...(parameters.get("scope") ? { scope: parameters.get("scope") } : {}),
    ...(parameters.get("service") ? { service: parameters.get("service") } : {}),
  };
}

async function publicBearerToken(
  challenge: TokenChallenge,
  repository: ParsedImageRepository,
  fetcher: typeof fetch,
): Promise<string> {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set("service", challenge.service);
  url.searchParams.set("scope", challenge.scope ?? `repository:${repository.name}:pull`);
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ExpectedError(
      "image_repository_unavailable",
      "이미지 저장소 인증 서비스에 연결하지 못했습니다.",
      503,
    );
  }
  if (!response.ok) {
    throw new ExpectedError(
      "image_repository_auth_required",
      "인증이 필요한 이미지 저장소는 아직 동기화할 수 없습니다.",
      409,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExpectedError(
      "invalid_image_repository_token",
      "이미지 저장소 인증 응답을 해석하지 못했습니다.",
      503,
    );
  }
  const source = value as { access_token?: unknown; token?: unknown };
  const token = typeof source.token === "string" ? source.token : source.access_token;
  if (typeof token !== "string" || !token) {
    throw new ExpectedError(
      "invalid_image_repository_token",
      "이미지 저장소 인증 응답을 해석하지 못했습니다.",
      503,
    );
  }
  return token;
}

async function registryRequest(
  url: URL,
  repository: ParsedImageRepository,
  fetcher: typeof fetch,
  authorization?: string,
): Promise<{ authorization?: string; response: Response }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...(authorization ? { headers: { authorization } } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ExpectedError(
      "image_repository_unavailable",
      `${repository.registry} 저장소에 연결하지 못했습니다.`,
      503,
    );
  }
  if (response.status !== 401 || authorization) return { authorization, response };
  const challenge = tokenChallenge(response.headers.get("www-authenticate"));
  if (!challenge) {
    throw new ExpectedError(
      "image_repository_auth_required",
      "인증이 필요한 이미지 저장소는 아직 동기화할 수 없습니다.",
      409,
    );
  }
  const token = await publicBearerToken(challenge, repository, fetcher);
  return registryRequest(url, repository, fetcher, `Bearer ${token}`);
}

function nextPage(current: URL, link: string | null, expectedPath: string): URL | undefined {
  const match = link?.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  if (!match) return undefined;
  const next = new URL(match[1]!, current);
  if (next.origin !== current.origin || next.pathname !== expectedPath) {
    throw new ExpectedError(
      "invalid_image_repository_tags",
      "이미지 저장소 태그 페이지를 해석하지 못했습니다.",
      503,
    );
  }
  return next;
}

function parseTags(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExpectedError(
      "invalid_image_repository_tags",
      "이미지 저장소 태그 응답을 해석하지 못했습니다.",
      503,
    );
  }
  const tags = (value as RegistryTagPage).tags;
  if (tags === null || tags === undefined) return [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new ExpectedError(
      "invalid_image_repository_tags",
      "이미지 저장소 태그 응답을 해석하지 못했습니다.",
      503,
    );
  }
  return tags as string[];
}

export async function getRegistryRepositoryTagNames(
  repository: ParsedImageRepository,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const origin = registryOrigin(repository.registry);
  const name = repository.name.split("/").map(encodeURIComponent).join("/");
  const expectedPath = `/v2/${name}/tags/list`;
  let url = new URL(expectedPath, origin);
  url.searchParams.set("n", String(TAG_PAGE_SIZE));
  let authorization: string | undefined;
  const tags = new Set<string>();

  for (let page = 0; page < MAX_TAG_PAGES; page += 1) {
    const result = await registryRequest(url, repository, fetcher, authorization);
    authorization = result.authorization;
    if (!result.response.ok) {
      const message =
        result.response.status === 401 || result.response.status === 403
          ? "인증이 필요한 이미지 저장소는 아직 동기화할 수 없습니다."
          : result.response.status === 404
            ? "이미지 저장소를 찾을 수 없습니다."
            : `${repository.registry} 태그 목록을 불러오지 못했습니다.`;
      throw new ExpectedError("image_repository_tags_unavailable", message, 503);
    }
    let value: unknown;
    try {
      value = await result.response.json();
    } catch {
      value = undefined;
    }
    for (const tag of parseTags(value)) tags.add(tag);
    const next = nextPage(url, result.response.headers.get("link"), expectedPath);
    if (!next) return [...tags];
    url = next;
  }
  throw new ExpectedError(
    "image_repository_tag_limit",
    "태그가 너무 많아 이미지 저장소 동기화를 완료하지 못했습니다.",
    503,
  );
}
