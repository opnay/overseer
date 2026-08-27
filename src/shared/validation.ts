const CONTAINER_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const IMAGE_IDENTIFIER = /^(?:sha256:)?[a-f0-9]{12,64}$/;
const IMAGE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,254}$/;
const DOCKER_HUB_REPOSITORY = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
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

export function isDockerHubRepository(value: string): boolean {
  return value.length <= 255 && DOCKER_HUB_REPOSITORY.test(value);
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
