import { ExpectedError } from "./errors.ts";
import {
  isContainerPort,
  isContainerReference,
  isComposeProjectName,
  isImageIdentifier,
  isImageReference,
  isResourceName,
  normalizeImageRepository,
} from "../../shared/validation.ts";

export function requireImageRepository(value: unknown): string {
  if (typeof value !== "string") {
    throw new ExpectedError(
      "invalid_image_repository",
      "유효한 이미지 저장소 주소를 입력하십시오.",
      400,
    );
  }
  const repository = normalizeImageRepository(value);
  if (!repository) {
    throw new ExpectedError(
      "invalid_image_repository",
      "저장소 주소는 Docker 이미지 이름과 같은 형식으로 입력하십시오.",
      400,
    );
  }
  return repository;
}

export function requireContainerReference(value: string): string {
  if (!isContainerReference(value)) {
    throw new ExpectedError("invalid_container", "유효하지 않은 컨테이너 식별자입니다.", 400);
  }
  return value;
}

export function optionalComposeProjectName(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !isComposeProjectName(value.trim())) {
    throw new ExpectedError(
      "invalid_compose_project_name",
      "프로젝트 이름은 소문자·숫자로 시작하고 소문자·숫자·밑줄·하이픈만 사용할 수 있습니다.",
      400,
    );
  }
  return value.trim();
}

export function requireComposeUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new ExpectedError("invalid_compose_url", "유효한 Compose URL을 입력하십시오.", 400);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ExpectedError("invalid_compose_url", "유효한 Compose URL을 입력하십시오.", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new ExpectedError(
      "invalid_compose_url",
      "인증 정보가 없는 공개 HTTPS Compose URL만 사용할 수 있습니다.",
      400,
    );
  }
  url.hash = "";
  return url.href;
}

export function requireImageReference(value: unknown): string {
  if (typeof value !== "string" || !isImageReference(value)) {
    throw new ExpectedError("invalid_image", "유효한 이미지 이름을 입력하십시오.", 400);
  }
  return value;
}

export function requireImageIdentifier(value: string): string {
  if (!isImageIdentifier(value)) {
    throw new ExpectedError("invalid_image", "유효하지 않은 이미지 식별자입니다.", 400);
  }
  return value;
}

export function optionalContainerName(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !isResourceName(value)) {
    throw new ExpectedError(
      "invalid_name",
      "컨테이너 이름은 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.",
      400,
    );
  }
  return value;
}

export function requireResourceName(value: unknown): string {
  if (typeof value !== "string" || !isResourceName(value)) {
    throw new ExpectedError(
      "invalid_name",
      "이름은 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.",
      400,
    );
  }
  return value;
}

export function optionalPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "number" || !isContainerPort(value)) {
    throw new ExpectedError("invalid_port", "컨테이너 포트는 1–65535 사이여야 합니다.", 400);
  }
  return value;
}
