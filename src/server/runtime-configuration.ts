import type { DockerEngineConfiguration, RecreateDockerEngineInput } from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";

const MIN_DISK_GIB = 10;

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
