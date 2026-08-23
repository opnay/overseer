import type {
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerSpecInput,
  ContainerVolumeMount,
  UpdateContainerInput,
} from "../shared/contracts.ts";
import { validateContainerSpec } from "../shared/container-spec.ts";
import { ExpectedError } from "./errors.ts";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExpectedError("invalid_container_spec", `${label} 형식을 확인하십시오.`, 400);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ExpectedError("invalid_container_spec", `${label} 형식을 확인하십시오.`, 400);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExpectedError("invalid_container_spec", `${label} 형식을 확인하십시오.`, 400);
  }
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ExpectedError("invalid_container_spec", `${label} 형식을 확인하십시오.`, 400);
  }
  return value;
}

function keyValues(value: unknown): ContainerKeyValue[] {
  return array(value, "Key/value 목록").map((item) => {
    const entry = record(item, "Key/value 항목");
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      throw new ExpectedError("invalid_container_spec", "Key/value 항목 형식을 확인하십시오.", 400);
    }
    return {
      key: stringValue(entry.key),
      value: entry.value,
    };
  });
}

function ports(value: unknown): ContainerPortMapping[] {
  return array(value, "포트 목록").map((item) => {
    const entry = record(item, "포트 항목");
    if (entry.protocol !== "tcp" && entry.protocol !== "udp") {
      throw new ExpectedError("invalid_container_spec", "포트 프로토콜을 확인하십시오.", 400);
    }
    const hostPort = optionalNumber(entry.hostPort, "호스트 포트");
    return {
      containerPort: optionalNumber(entry.containerPort, "컨테이너 포트") ?? 0,
      ...(hostPort === undefined ? {} : { hostPort }),
      protocol: entry.protocol,
    };
  });
}

function volumes(value: unknown): ContainerVolumeMount[] {
  return array(value, "볼륨 목록").map((item) => {
    const entry = record(item, "볼륨 항목");
    if (entry.readOnly !== undefined && typeof entry.readOnly !== "boolean") {
      throw new ExpectedError("invalid_container_spec", "볼륨 읽기 전용 설정을 확인하십시오.", 400);
    }
    return {
      containerPath: stringValue(entry.containerPath),
      readOnly: entry.readOnly === true,
      volume: stringValue(entry.volume),
    };
  });
}

function firstError(errors: ReturnType<typeof validateContainerSpec>): [string, string] {
  const entry = Object.entries(errors)[0];
  return entry
    ? [`invalid_${entry[0]}`, entry[1]]
    : ["invalid_container_spec", "설정을 확인하십시오."];
}

export function parseContainerSpec(value: unknown): ContainerSpecInput {
  const source = record(value, "컨테이너 설정");
  const restart = record(source.restartPolicy ?? {}, "재시작 정책");
  const resources = record(source.resources ?? {}, "리소스 제한");
  if (
    source.pullPolicy !== undefined &&
    source.pullPolicy !== "always" &&
    source.pullPolicy !== "missing" &&
    source.pullPolicy !== "never"
  ) {
    throw new ExpectedError("invalid_container_spec", "이미지 받기 정책을 확인하십시오.", 400);
  }
  if (
    restart.mode !== undefined &&
    restart.mode !== "always" &&
    restart.mode !== "no" &&
    restart.mode !== "on-failure" &&
    restart.mode !== "unless-stopped"
  ) {
    throw new ExpectedError("invalid_container_spec", "재시작 정책을 확인하십시오.", 400);
  }
  const hostname = optionalString(source.hostname, "Hostname");
  const name = optionalString(source.name, "이름");
  const cpus = optionalNumber(resources.cpus, "CPU 수");
  const memoryMiB = optionalNumber(resources.memoryMiB, "메모리");
  const maximumRetryCount = optionalNumber(restart.maximumRetryCount, "최대 재시도 횟수");
  const spec: ContainerSpecInput = {
    command: array(source.command, "명령 목록").map((argument) => {
      if (typeof argument !== "string") {
        throw new ExpectedError("invalid_container_spec", "명령 인수 형식을 확인하십시오.", 400);
      }
      return argument;
    }),
    environment: keyValues(source.environment),
    ...(hostname ? { hostname } : {}),
    image: stringValue(source.image),
    labels: keyValues(source.labels),
    ...(name ? { name } : {}),
    networks: array(source.networks, "네트워크 목록").map((network) => {
      if (typeof network !== "string") {
        throw new ExpectedError(
          "invalid_container_spec",
          "네트워크 이름 형식을 확인하십시오.",
          400,
        );
      }
      return network.trim();
    }),
    ports: ports(source.ports),
    pullPolicy:
      source.pullPolicy === "always" || source.pullPolicy === "never"
        ? source.pullPolicy
        : "missing",
    resources: {
      ...(cpus === undefined ? {} : { cpus }),
      ...(memoryMiB === undefined ? {} : { memoryMiB }),
    },
    restartPolicy: {
      ...(maximumRetryCount === undefined ? {} : { maximumRetryCount }),
      mode:
        restart.mode === "always" ||
        restart.mode === "on-failure" ||
        restart.mode === "unless-stopped"
          ? restart.mode
          : "no",
    },
    volumes: volumes(source.volumes),
  };

  const errors = validateContainerSpec(spec);
  if (Object.keys(errors).length > 0) {
    const [code, message] = firstError(errors);
    throw new ExpectedError(code, message, 400);
  }
  return spec;
}

export function parseUpdateContainerInput(value: unknown): UpdateContainerInput {
  const source = record(value, "컨테이너 수정 요청");
  const expectedConfigHash = stringValue(source.expectedConfigHash);
  if (!/^[a-f0-9]{64}$/.test(expectedConfigHash)) {
    throw new ExpectedError("invalid_config_hash", "컨테이너 설정 버전을 확인하십시오.", 400);
  }
  return { expectedConfigHash, spec: parseContainerSpec(source.spec) };
}
