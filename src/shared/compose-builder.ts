import type {
  ComposeBuilderService,
  ComposeBuilderSpec,
  ContainerRestartMode,
} from "./contracts.ts";
import {
  isComposeProjectName,
  isContainerPath,
  isContainerPort,
  isEnvironmentName,
  isImageReference,
  isResourceName,
} from "./validation.ts";

const IMAGE_TAG = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const MAX_SERVICES = 20;
const MAX_ROWS = 50;
const RESTART_MODES = new Set<ContainerRestartMode>([
  "always",
  "no",
  "on-failure",
  "unless-stopped",
]);

export interface ComposeBuilderIssue {
  message: string;
  path: string;
}

export function emptyComposeBuilderService(index = 1): ComposeBuilderService {
  return {
    command: [],
    environment: [],
    image: "",
    name: `service-${index}`,
    networks: [],
    ports: [],
    restartPolicy: { mode: "no" },
    tag: "latest",
    volumes: [],
  };
}

export function emptyComposeBuilderSpec(): ComposeBuilderSpec {
  return {
    name: "",
    networks: [],
    services: [emptyComposeBuilderService()],
    volumes: [],
  };
}

function duplicates(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return duplicate;
}

export function validateComposeBuilderSpec(spec: ComposeBuilderSpec): ComposeBuilderIssue[] {
  const issues: ComposeBuilderIssue[] = [];
  if (!isComposeProjectName(spec.name)) {
    issues.push({
      message: "프로젝트 이름은 소문자·숫자로 시작하고 밑줄·하이픈만 사용할 수 있습니다.",
      path: "name",
    });
  }
  if (spec.services.length === 0 || spec.services.length > MAX_SERVICES) {
    issues.push({
      message: `서비스는 1–${MAX_SERVICES}개여야 합니다.`,
      path: "services",
    });
  }
  if (spec.networks.length > MAX_ROWS || spec.volumes.length > MAX_ROWS) {
    issues.push({
      message: `network와 volume은 각각 ${MAX_ROWS}개 이하여야 합니다.`,
      path: "resources",
    });
  }

  const networkNames = new Set(spec.networks);
  const volumeNames = new Set(spec.volumes);
  for (const name of spec.networks) {
    if (!isResourceName(name))
      issues.push({
        message: `유효하지 않은 network 이름입니다: ${name || "(비어 있음)"}`,
        path: "networks",
      });
  }
  for (const name of spec.volumes) {
    if (!isResourceName(name))
      issues.push({
        message: `유효하지 않은 volume 이름입니다: ${name || "(비어 있음)"}`,
        path: "volumes",
      });
  }
  if (duplicates(spec.networks).size > 0)
    issues.push({ message: "network 이름이 중복됩니다.", path: "networks" });
  if (duplicates(spec.volumes).size > 0)
    issues.push({ message: "volume 이름이 중복됩니다.", path: "volumes" });
  if (duplicates(spec.services.map(({ name }) => name)).size > 0)
    issues.push({ message: "서비스 이름이 중복됩니다.", path: "services" });
  if (
    duplicates(
      spec.services
        .map(({ containerName }) => containerName)
        .filter((name): name is string => Boolean(name)),
    ).size > 0
  )
    issues.push({ message: "컨테이너 이름이 중복됩니다.", path: "services" });

  const publishedPorts = new Set<string>();

  spec.services.forEach((service, index) => {
    const path = `services.${index}`;
    if (!isResourceName(service.name))
      issues.push({ message: `${index + 1}번 서비스 이름을 확인하십시오.`, path: `${path}.name` });
    if (
      !service.image ||
      !IMAGE_TAG.test(service.tag) ||
      !isImageReference(`${service.image}:${service.tag}`)
    ) {
      issues.push({
        message: `${service.name || index + 1} 서비스의 이미지와 태그를 확인하십시오.`,
        path: `${path}.image`,
      });
    }
    if (service.containerName && !isResourceName(service.containerName))
      issues.push({
        message: `${service.name} 서비스의 컨테이너 이름을 확인하십시오.`,
        path: `${path}.containerName`,
      });
    const { maximumRetryCount, mode } = service.restartPolicy;
    if (
      !RESTART_MODES.has(mode) ||
      (mode !== "on-failure" && maximumRetryCount !== undefined) ||
      (maximumRetryCount !== undefined &&
        (!Number.isInteger(maximumRetryCount) || maximumRetryCount < 0))
    )
      issues.push({
        message: `${service.name} 서비스의 재시작 정책을 확인하십시오.`,
        path: `${path}.restartPolicy`,
      });
    if (
      service.command.length > MAX_ROWS ||
      service.command.some((value) => !value || value.length > 512)
    )
      issues.push({
        message: `${service.name} 서비스의 명령 인수를 확인하십시오.`,
        path: `${path}.command`,
      });
    if (service.environment.length > MAX_ROWS)
      issues.push({
        message: `${service.name} 서비스의 환경 변수는 ${MAX_ROWS}개 이하여야 합니다.`,
        path: `${path}.environment`,
      });
    if (duplicates(service.environment.map(({ key }) => key)).size > 0)
      issues.push({
        message: `${service.name} 서비스의 환경 변수 이름이 중복됩니다.`,
        path: `${path}.environment`,
      });
    for (const entry of service.environment) {
      if (!isEnvironmentName(entry.key) || entry.value.length > 4_096)
        issues.push({
          message: `${service.name} 서비스의 환경 변수를 확인하십시오.`,
          path: `${path}.environment`,
        });
    }

    if (service.ports.length > MAX_ROWS)
      issues.push({
        message: `${service.name} 서비스의 포트는 ${MAX_ROWS}개 이하여야 합니다.`,
        path: `${path}.ports`,
      });
    for (const port of service.ports) {
      if (
        !isContainerPort(port.containerPort) ||
        (port.hostPort !== undefined && !isContainerPort(port.hostPort))
      )
        issues.push({
          message: `${service.name} 서비스의 포트를 확인하십시오.`,
          path: `${path}.ports`,
        });
    }
    if (
      duplicates(service.ports.map(({ containerPort, protocol }) => `${containerPort}/${protocol}`))
        .size > 0
    )
      issues.push({
        message: `${service.name} 서비스의 컨테이너 포트가 중복됩니다.`,
        path: `${path}.ports`,
      });
    if (
      duplicates(
        service.ports
          .filter(({ hostPort }) => hostPort !== undefined)
          .map(({ hostPort, protocol }) => `${hostPort}/${protocol}`),
      ).size > 0
    )
      issues.push({
        message: `${service.name} 서비스의 호스트 포트가 중복됩니다.`,
        path: `${path}.ports`,
      });
    for (const { hostPort, protocol } of service.ports) {
      if (hostPort === undefined) continue;
      const publishedPort = `${hostPort}/${protocol}`;
      if (publishedPorts.has(publishedPort))
        issues.push({
          message: `호스트 포트 ${publishedPort}가 여러 서비스에서 중복됩니다.`,
          path: `${path}.ports`,
        });
      publishedPorts.add(publishedPort);
    }

    if (service.networks.length > MAX_ROWS)
      issues.push({
        message: `${service.name} 서비스의 네트워크 연결은 ${MAX_ROWS}개 이하여야 합니다.`,
        path: `${path}.networks`,
      });
    if (
      duplicates(service.networks).size > 0 ||
      service.networks.some((name) => !networkNames.has(name))
    )
      issues.push({
        message: `${service.name} 서비스가 등록되지 않은 network를 사용합니다.`,
        path: `${path}.networks`,
      });
    if (service.volumes.length > MAX_ROWS)
      issues.push({
        message: `${service.name} 서비스의 볼륨 연결은 ${MAX_ROWS}개 이하여야 합니다.`,
        path: `${path}.volumes`,
      });
    if (duplicates(service.volumes.map(({ containerPath }) => containerPath)).size > 0)
      issues.push({
        message: `${service.name} 서비스의 volume 대상 경로가 중복됩니다.`,
        path: `${path}.volumes`,
      });
    for (const mount of service.volumes) {
      if (!volumeNames.has(mount.volume) || !isContainerPath(mount.containerPath))
        issues.push({
          message: `${service.name} 서비스의 볼륨 연결을 확인하십시오.`,
          path: `${path}.volumes`,
        });
    }
  });
  return issues;
}

const yamlString = (value: string) => JSON.stringify(value);

export function composeBuilderYaml(spec: ComposeBuilderSpec): string {
  const lines = ["services:"];
  spec.services.forEach((service, index) => {
    const name = service.name || `service-${index + 1}`;
    const image = service.image ? `${service.image}:${service.tag || "latest"}` : "image:latest";
    lines.push(`  ${name}:`, `    image: ${yamlString(image)}`);
    if (service.containerName)
      lines.push(`    container_name: ${yamlString(service.containerName)}`);
    if (service.command.length > 0) {
      lines.push("    command:");
      for (const argument of service.command) lines.push(`      - ${yamlString(argument)}`);
    }
    if (service.environment.length > 0) {
      lines.push("    environment:");
      for (const { key, value } of service.environment)
        lines.push(`      ${key || "KEY"}: ${yamlString(value)}`);
    }
    if (service.ports.length > 0) {
      lines.push("    ports:");
      for (const port of service.ports) {
        lines.push(`      - target: ${port.containerPort || 80}`);
        if (port.hostPort !== undefined)
          lines.push(`        published: ${yamlString(String(port.hostPort))}`);
        lines.push('        host_ip: "127.0.0.1"', `        protocol: ${port.protocol}`);
      }
    }
    if (service.volumes.length > 0) {
      lines.push("    volumes:");
      for (const mount of service.volumes) {
        lines.push(
          "      - type: volume",
          `        source: ${mount.volume || "volume"}`,
          `        target: ${yamlString(mount.containerPath || "/data")}`,
        );
        if (mount.readOnly) lines.push("        read_only: true");
      }
    }
    if (service.networks.length > 0) {
      lines.push("    networks:");
      for (const network of service.networks) lines.push(`      - ${network || "network"}`);
    }
    if (service.restartPolicy.mode !== "no") {
      const restart =
        service.restartPolicy.mode === "on-failure" &&
        service.restartPolicy.maximumRetryCount !== undefined
          ? `${service.restartPolicy.mode}:${service.restartPolicy.maximumRetryCount}`
          : service.restartPolicy.mode;
      lines.push(`    restart: ${yamlString(restart)}`);
    }
  });
  if (spec.networks.length > 0) {
    lines.push("networks:");
    for (const network of spec.networks)
      lines.push(`  ${network || "network"}:`, '    driver: "bridge"');
  }
  if (spec.volumes.length > 0) {
    lines.push("volumes:");
    for (const volume of spec.volumes) lines.push(`  ${volume || "volume"}: {}`);
  }
  return `${lines.join("\n")}\n`;
}
