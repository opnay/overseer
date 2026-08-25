import type {
  CreateRuntimeInstanceInput,
  DockerEngineConfiguration,
  RecreateDockerEngineInput,
} from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";

const MIN_DISK_GIB = 10;
const LIMA_INSTANCE_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpectedError("invalid_runtime_configuration", message, 400);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ExpectedError(
      "invalid_runtime_configuration",
      `${label}은 ${minimum} 이상의 정수여야 합니다.`,
      400,
    );
  }
  return value;
}

export function parseDockerEngineConfiguration(value: unknown): DockerEngineConfiguration {
  const input = record(value, "Docker Engine 설정을 확인하십시오.");
  if (input.provider !== "lima") {
    throw new ExpectedError(
      "invalid_runtime_configuration",
      "실행 환경은 Lima VM만 선택할 수 있습니다.",
      400,
    );
  }
  if (input.vmType !== "vz" && input.vmType !== "qemu") {
    throw new ExpectedError(
      "invalid_runtime_configuration",
      "VM 드라이버는 VZ 또는 QEMU여야 합니다.",
      400,
    );
  }
  return {
    cpus: positiveInteger(input.cpus, "CPU"),
    diskGiB: positiveInteger(input.diskGiB, "디스크", MIN_DISK_GIB),
    memoryGiB: positiveInteger(input.memoryGiB, "메모리"),
    provider: input.provider,
    vmType: input.vmType,
  };
}

export function parseRuntimeStartInput(value: unknown): DockerEngineConfiguration {
  const input = record(value, "Docker Engine 생성 요청을 확인하십시오.");
  return parseDockerEngineConfiguration(input.configuration);
}

export function parseCreateRuntimeInstanceInput(value: unknown): CreateRuntimeInstanceInput {
  const input = record(value, "Lima 인스턴스 생성 요청을 확인하십시오.");
  if (typeof input.name !== "string" || !LIMA_INSTANCE_NAME.test(input.name)) {
    throw new ExpectedError(
      "invalid_runtime_instance_name",
      "인스턴스 이름은 소문자·숫자로 시작하고 소문자·숫자·점·밑줄·하이픈만 사용할 수 있습니다.",
      400,
    );
  }
  return {
    configuration: parseDockerEngineConfiguration(input.configuration),
    name: input.name,
  };
}

export function requireRuntimeInstanceName(value: string): string {
  if (!LIMA_INSTANCE_NAME.test(value)) {
    throw new ExpectedError(
      "invalid_runtime_instance_name",
      "유효하지 않은 Lima 인스턴스 이름입니다.",
      400,
    );
  }
  return value;
}

export function parseRecreateDockerEngineInput(value: unknown): RecreateDockerEngineInput {
  const input = record(value, "Docker Engine 재생성 요청을 확인하십시오.");
  if (input.confirmation !== "overseer") {
    throw new ExpectedError(
      "runtime_confirmation_mismatch",
      "재생성하려면 overseer를 정확히 입력하십시오.",
      400,
    );
  }
  return {
    configuration: parseDockerEngineConfiguration(input.configuration),
    confirmation: input.confirmation,
  };
}
