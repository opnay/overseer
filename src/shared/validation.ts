const CONTAINER_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const IMAGE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,254}$/;
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function isContainerReference(value: string): boolean {
  return CONTAINER_REFERENCE.test(value);
}

export function isImageReference(value: string): boolean {
  return IMAGE_REFERENCE.test(value);
}

export function isResourceName(value: string): boolean {
  return RESOURCE_NAME.test(value);
}

export function isContainerPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}
