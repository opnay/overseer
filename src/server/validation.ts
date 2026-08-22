import { ExpectedError } from "./errors.ts";

const CONTAINER_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const IMAGE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,254}$/;
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function requireContainerReference(value: string): string {
  if (!CONTAINER_REFERENCE.test(value)) {
    throw new ExpectedError("invalid_container", "유효하지 않은 컨테이너 식별자입니다.", 400);
  }
  return value;
}

export function requireImageReference(value: unknown): string {
  if (typeof value !== "string" || !IMAGE_REFERENCE.test(value)) {
    throw new ExpectedError("invalid_image", "유효한 이미지 이름을 입력하십시오.", 400);
  }
  return value;
}

export function optionalContainerName(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !CONTAINER_NAME.test(value)) {
    throw new ExpectedError(
      "invalid_name",
      "컨테이너 이름은 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.",
      400,
    );
  }
  return value;
}

export function optionalPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new ExpectedError("invalid_port", "컨테이너 포트는 1–65535 사이여야 합니다.", 400);
  }
  return value as number;
}
