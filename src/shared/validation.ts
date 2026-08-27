const CONTAINER_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const IMAGE_IDENTIFIER = /^(?:sha256:)?[a-f0-9]{12,64}$/;
const IMAGE_REPOSITORY_IDENTIFIER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,254}$/;
const IMAGE_TAG = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const IMAGE_REPOSITORY_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const REGISTRY_HOSTNAME =
  /^(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const ENVIRONMENT_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const HOSTNAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/;
const LABEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/;
const COMPOSE_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const RUNTIME_INSTANCE_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export function isContainerReference(value: string): boolean {
  return CONTAINER_REFERENCE.test(value);
}

export function isComposeProjectName(value: string): boolean {
  return COMPOSE_PROJECT_NAME.test(value);
}

export function isImageReference(value: string): boolean {
  return IMAGE_REFERENCE.test(value);
}

export function isImageIdentifier(value: string): boolean {
  return IMAGE_IDENTIFIER.test(value);
}

export function isImageRepositoryIdentifier(value: string): boolean {
  return IMAGE_REPOSITORY_IDENTIFIER.test(value);
}

export function isImageTag(value: string): boolean {
  return IMAGE_TAG.test(value);
}

export interface ParsedImageRepository {
  name: string;
  reference: string;
  registry: string;
}

function normalizeRegistry(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(`https://${value}`);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return undefined;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!REGISTRY_HOSTNAME.test(hostname) && !hostname.includes(":")) return undefined;
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  }
  return url.host === "index.docker.io" ? "docker.io" : url.host;
}

export function parseImageRepository(value: string): ParsedImageRepository | undefined {
  const source = value.trim().toLowerCase();
  if (!source || source.length > 255 || source.includes("://") || source.includes("@")) {
    return undefined;
  }
  const segments = source.split("/");
  if (segments.some((segment) => !segment)) return undefined;
  const first = segments[0]!;
  const hasRegistry = first === "localhost" || first.includes(".") || first.includes(":");
  const registry = hasRegistry ? normalizeRegistry(first) : "docker.io";
  if (!registry) return undefined;
  const nameSegments = hasRegistry ? segments.slice(1) : segments;
  if (nameSegments.length === 0) return undefined;
  if (registry === "docker.io" && nameSegments.length === 1) nameSegments.unshift("library");
  if (!nameSegments.every((segment) => IMAGE_REPOSITORY_COMPONENT.test(segment))) return undefined;
  const name = nameSegments.join("/");
  const reference = `${registry}/${name}`;
  if (reference.length > 255) return undefined;
  return { name, reference, registry };
}

export function normalizeImageRepository(value: string): string | undefined {
  return parseImageRepository(value)?.reference;
}

export function isResourceName(value: string): boolean {
  return RESOURCE_NAME.test(value);
}

export function isRuntimeInstanceName(value: string): boolean {
  return RUNTIME_INSTANCE_NAME.test(value);
}

export function isContainerPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

export function isContainerPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    value.length <= 512 &&
    !value.includes("\0") &&
    !value.split("/").includes("..")
  );
}

export function isEnvironmentName(value: string): boolean {
  return ENVIRONMENT_NAME.test(value);
}

export function isHostname(value: string): boolean {
  return HOSTNAME.test(value);
}

export function isLabelName(value: string): boolean {
  return LABEL_NAME.test(value);
}
