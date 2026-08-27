import type {
  ComposeBuilderInput,
  ComposeBuilderService,
  ComposeBuilderSpec,
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerRestartPolicy,
  ContainerVolumeMount,
  UpdateComposeBuilderInput,
} from "../../../shared/contracts.ts";
import { validateComposeBuilderSpec } from "../../../shared/compose-builder.ts";
import { isComposeProjectName } from "../../../shared/validation.ts";
import { ExpectedError } from "../../core/errors.ts";

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpectedError("invalid_compose_builder", message, 400);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, message: string, trim = true): string {
  if (typeof value !== "string") throw new ExpectedError("invalid_compose_builder", message, 400);
  return trim ? value.trim() : value;
}

function strings(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) throw new ExpectedError("invalid_compose_builder", message, 400);
  return value.map((item) => string(item, message));
}

function keyValues(value: unknown, message: string): ContainerKeyValue[] {
  if (!Array.isArray(value)) throw new ExpectedError("invalid_compose_builder", message, 400);
  return value.map((item) => {
    const entry = record(item, message);
    return { key: string(entry.key, message), value: string(entry.value, message, false) };
  });
}

function ports(value: unknown, message: string): ContainerPortMapping[] {
  if (!Array.isArray(value)) throw new ExpectedError("invalid_compose_builder", message, 400);
  return value.map((item) => {
    const port = record(item, message);
    if (
      typeof port.containerPort !== "number" ||
      (port.hostPort !== undefined && typeof port.hostPort !== "number") ||
      (port.protocol !== "tcp" && port.protocol !== "udp")
    ) {
      throw new ExpectedError("invalid_compose_builder", message, 400);
    }
    return {
      containerPort: port.containerPort,
      ...(port.hostPort === undefined ? {} : { hostPort: port.hostPort }),
      protocol: port.protocol,
    };
  });
}

function mounts(value: unknown, message: string): ContainerVolumeMount[] {
  if (!Array.isArray(value)) throw new ExpectedError("invalid_compose_builder", message, 400);
  return value.map((item) => {
    const mount = record(item, message);
    if (typeof mount.readOnly !== "boolean")
      throw new ExpectedError("invalid_compose_builder", message, 400);
    return {
      containerPath: string(mount.containerPath, message),
      readOnly: mount.readOnly,
      volume: string(mount.volume, message),
    };
  });
}

function restartPolicy(value: unknown, message: string): ContainerRestartPolicy {
  const policy = record(value, message);
  if (
    policy.mode !== "no" &&
    policy.mode !== "always" &&
    policy.mode !== "unless-stopped" &&
    policy.mode !== "on-failure"
  ) {
    throw new ExpectedError("invalid_compose_builder", message, 400);
  }
  if (
    policy.maximumRetryCount !== undefined &&
    (typeof policy.maximumRetryCount !== "number" || !Number.isInteger(policy.maximumRetryCount))
  ) {
    throw new ExpectedError("invalid_compose_builder", message, 400);
  }
  return {
    ...(policy.maximumRetryCount === undefined
      ? {}
      : { maximumRetryCount: policy.maximumRetryCount }),
    mode: policy.mode,
  };
}

function service(value: unknown, index: number): ComposeBuilderService {
  const input = record(value, `${index + 1}번 서비스 설정을 확인하십시오.`);
  const message = `${index + 1}번 서비스 설정을 확인하십시오.`;
  return {
    command: Array.isArray(input.command)
      ? input.command.map((item) => string(item, message, false))
      : strings(input.command, message),
    ...(input.containerName === undefined || input.containerName === ""
      ? {}
      : { containerName: string(input.containerName, message) }),
    environment: keyValues(input.environment, message),
    image: string(input.image, message),
    name: string(input.name, message),
    networks: strings(input.networks, message),
    ports: ports(input.ports, message),
    restartPolicy: restartPolicy(input.restartPolicy, message),
    tag: string(input.tag, message),
    volumes: mounts(input.volumes, message),
  };
}

export function parseComposeBuilderSpec(value: unknown): ComposeBuilderSpec {
  const input = record(value, "Compose 폼 설정을 확인하십시오.");
  if (!Array.isArray(input.services)) {
    throw new ExpectedError("invalid_compose_builder", "서비스 목록을 확인하십시오.", 400);
  }
  const spec: ComposeBuilderSpec = {
    name: string(input.name, "프로젝트 이름을 확인하십시오."),
    networks: strings(input.networks, "network 목록을 확인하십시오."),
    services: input.services.map(service),
    volumes: strings(input.volumes, "volume 목록을 확인하십시오."),
  };
  const issue = validateComposeBuilderSpec(spec)[0];
  if (issue) throw new ExpectedError("invalid_compose_builder", issue.message, 400);
  return spec;
}

export function parseComposeBuilderInput(value: unknown): ComposeBuilderInput {
  const input = record(value, "Compose 작성 설정을 확인하십시오.");
  if (input.mode === "yaml") {
    const name = string(input.name, "프로젝트 이름을 확인하십시오.");
    const yaml = string(input.yaml, "Compose YAML을 입력하십시오.", false);
    if (!isComposeProjectName(name)) {
      throw new ExpectedError(
        "invalid_compose_builder",
        "프로젝트 이름은 소문자·숫자로 시작하고 밑줄·하이픈만 사용할 수 있습니다.",
        400,
      );
    }
    if (yaml.trim().length === 0 || Buffer.byteLength(yaml, "utf8") > 1024 * 1024) {
      throw new ExpectedError(
        "invalid_compose_builder",
        "Compose YAML은 1MB 이하로 입력하십시오.",
        400,
      );
    }
    return { mode: "yaml", name, yaml };
  }
  if (input.mode === "form") {
    return { mode: "form", spec: parseComposeBuilderSpec(input.spec) };
  }
  return { mode: "form", spec: parseComposeBuilderSpec(input) };
}

export function parseUpdateComposeBuilderInput(value: unknown): UpdateComposeBuilderInput {
  const input = record(value, "Compose 수정 요청을 확인하십시오.");
  if (
    typeof input.expectedConfigHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedConfigHash)
  ) {
    throw new ExpectedError("invalid_config_hash", "Compose config hash를 확인하십시오.", 400);
  }
  return {
    expectedConfigHash: input.expectedConfigHash,
    input: parseComposeBuilderInput(input.input ?? input.spec),
  };
}
