import type {
  ContainerKeyValue,
  ContainerPortMapping,
  ContainerRestartPolicy,
  ContainerSpecInput,
  ContainerVolumeMount,
} from "./contracts.ts";
import {
  isContainerPath,
  isContainerPort,
  isEnvironmentName,
  isHostname,
  isImageReference,
  isLabelName,
  isResourceName,
} from "./validation.ts";

export interface ContainerSpecErrors {
  command?: string;
  environment?: string;
  form?: string;
  hostname?: string;
  image?: string;
  labels?: string;
  memoryMiB?: string;
  name?: string;
  networks?: string;
  ports?: string;
  restartPolicy?: string;
  volumes?: string;
  cpus?: string;
}

function duplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validKeyValues(
  values: readonly ContainerKeyValue[],
  validKey: (key: string) => boolean,
  limit: number,
): boolean {
  return (
    values.length <= limit &&
    values.every(({ key, value }) => validKey(key) && value.length <= 8_192) &&
    !duplicate(values.map(({ key }) => key))
  );
}

function reservedLabel(key: string): boolean {
  return key.startsWith("com.opnay.overseer.") || key.startsWith("com.docker.compose.");
}

function validPorts(values: readonly ContainerPortMapping[]): boolean {
  return (
    values.length <= 32 &&
    values.every(
      ({ containerPort, hostPort, protocol }) =>
        isContainerPort(containerPort) &&
        (hostPort === undefined || isContainerPort(hostPort)) &&
        (protocol === "tcp" || protocol === "udp"),
    ) &&
    !duplicate(values.map(({ containerPort, protocol }) => `${containerPort}/${protocol}`))
  );
}

function validVolumes(values: readonly ContainerVolumeMount[]): boolean {
  return (
    values.length <= 32 &&
    values.every(
      ({ containerPath, volume }) => isContainerPath(containerPath) && isResourceName(volume),
    ) &&
    !duplicate(values.map(({ containerPath }) => containerPath))
  );
}

function validRestartPolicy(value: ContainerRestartPolicy): boolean {
  if (!(["always", "no", "on-failure", "unless-stopped"] as const).includes(value.mode)) {
    return false;
  }
  if (value.mode !== "on-failure") return value.maximumRetryCount === undefined;
  return (
    value.maximumRetryCount === undefined ||
    (Number.isInteger(value.maximumRetryCount) && value.maximumRetryCount >= 0)
  );
}

export function validateContainerSpec(spec: ContainerSpecInput): ContainerSpecErrors {
  const errors: ContainerSpecErrors = {};
  if (!isImageReference(spec.image)) errors.image = "유효한 이미지 이름을 입력하십시오.";
  if (spec.name && !isResourceName(spec.name)) {
    errors.name = "영문·숫자로 시작하고 점·밑줄·하이픈만 사용하십시오.";
  }
  if (spec.hostname && !isHostname(spec.hostname)) {
    errors.hostname = "유효한 hostname을 입력하십시오.";
  }
  if (
    spec.command.length > 64 ||
    spec.command.some((argument) => argument.length === 0 || argument.length > 4_096)
  ) {
    errors.command = "명령 인수는 64개 이하이며 각 인수는 비어 있지 않아야 합니다.";
  }
  if (!validPorts(spec.ports)) {
    errors.ports = "포트 형식과 중복된 컨테이너 포트를 확인하십시오.";
  }
  if (!validKeyValues(spec.environment, isEnvironmentName, 128)) {
    errors.environment = "환경 변수 이름과 중복 여부를 확인하십시오.";
  }
  if (
    !validKeyValues(spec.labels, isLabelName, 64) ||
    spec.labels.some(({ key }) => reservedLabel(key))
  ) {
    errors.labels = "Label 이름과 중복 여부를 확인하십시오.";
  }
  if (!validVolumes(spec.volumes)) {
    errors.volumes = "볼륨 이름, 절대 컨테이너 경로와 중복 여부를 확인하십시오.";
  }
  if (
    spec.networks.length > 16 ||
    spec.networks.some((network) => !isResourceName(network)) ||
    duplicate(spec.networks) ||
    (spec.networks.includes("none") && spec.networks.length > 1) ||
    spec.networks.includes("host")
  ) {
    errors.networks = "네트워크 이름과 중복 여부를 확인하십시오.";
  }
  if (!validRestartPolicy(spec.restartPolicy)) {
    errors.restartPolicy = "재시작 정책과 재시도 횟수를 확인하십시오.";
  }
  if (spec.resources.cpus !== undefined && !(spec.resources.cpus > 0)) {
    errors.cpus = "CPU 수는 0보다 커야 합니다.";
  }
  if (
    spec.resources.memoryMiB !== undefined &&
    (!Number.isInteger(spec.resources.memoryMiB) || spec.resources.memoryMiB <= 0)
  ) {
    errors.memoryMiB = "메모리는 1MiB 이상의 정수여야 합니다.";
  }
  if (!(["always", "missing", "never"] as const).includes(spec.pullPolicy)) {
    errors.form = "이미지 받기 정책을 확인하십시오.";
  }
  return errors;
}

export function containerSpecIsValid(spec: ContainerSpecInput): boolean {
  return Object.keys(validateContainerSpec(spec)).length === 0;
}

export function containerSpecNeedsReplacement(
  current: ContainerSpecInput,
  next: ContainerSpecInput,
): boolean {
  const immutable = (spec: ContainerSpecInput) => ({
    command: spec.command,
    environment: spec.environment,
    hostname: spec.hostname,
    image: spec.image,
    labels: spec.labels,
    networks: spec.networks,
    ports: spec.ports,
    pullPolicy: spec.pullPolicy,
    volumes: spec.volumes,
  });
  return JSON.stringify(immutable(current)) !== JSON.stringify(immutable(next));
}

export function emptyContainerSpec(): ContainerSpecInput {
  return {
    command: [],
    environment: [],
    image: "",
    labels: [],
    networks: [],
    ports: [],
    pullPolicy: "missing",
    resources: {},
    restartPolicy: { mode: "no" },
    volumes: [],
  };
}
