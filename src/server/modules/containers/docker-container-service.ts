import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type {
  ContainerDetail,
  ContainerHealth,
  ContainerHealthStatus,
  ContainerInspection,
  ContainerMount,
  ContainerPortMapping,
  ContainerShell,
  ContainerSpecInput,
  ContainerSummary,
  ContainerTerminalAccess,
  ContainerVolumeMount,
  RunContainerInput,
  UpdateContainerInput,
} from "../../../shared/contracts.ts";
import { containerSpecNeedsReplacement } from "../../../shared/container-spec.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import { environmentValues, sortedKeyValues, type DockerCommand } from "../docker/index.ts";
import type { OperationProgress } from "../operations/index.ts";

interface DockerContainerRow {
  ID: string;
  Image: string;
  Labels: string;
  Names: string;
  Ports: string;
  State: string;
  Status: string;
}

interface DockerInspectPortBinding {
  HostIp: string;
  HostPort: string;
}

interface DockerInspectMount {
  Destination: string;
  Name?: string;
  RW: boolean;
  Source: string;
  Type: string;
}

interface DockerInspectContainer {
  Config: {
    Cmd?: string[] | null;
    Env?: string[] | null;
    Hostname: string;
    Image: string;
    Labels?: Record<string, string> | null;
  };
  HostConfig: {
    CapAdd?: string[] | null;
    CapDrop?: string[] | null;
    Devices?: unknown[] | null;
    Memory: number;
    NanoCpus: number;
    NetworkMode: string;
    PortBindings?: Record<string, DockerInspectPortBinding[] | null> | null;
    Privileged?: boolean;
    RestartPolicy: { MaximumRetryCount: number; Name: string };
    SecurityOpt?: string[] | null;
  };
  Id: string;
  Mounts?: DockerInspectMount[];
  Name: string;
  NetworkSettings: { Networks?: Record<string, unknown> | null };
  State: {
    Health?: {
      FailingStreak?: number;
      Log?: Array<{
        End?: string;
        ExitCode?: number;
        Output?: string;
        Start?: string;
      }>;
      Status?: string;
    };
    Paused?: boolean;
    Restarting?: boolean;
    Running: boolean;
  };
}

type ProbeContainerShell = (id: string, shell: ContainerShell) => Promise<boolean>;

const CONTAINER_ROW_FORMAT = "{{json .}}";
const MANAGED_LABEL = "com.opnay.overseer.managed";
const SPEC_VERSION_LABEL = "com.opnay.overseer.spec-version";
const CONTAINER_SHELLS: readonly ContainerShell[] = ["sh", "bash", "ash", "zsh"];

function dockerLabel(labels: string, name: string): string | undefined {
  const prefix = `${name}=`;
  const value = labels.split(",").find((label) => label.startsWith(prefix));
  return value?.slice(prefix.length) || undefined;
}

function restartMode(value: string): ContainerSpecInput["restartPolicy"]["mode"] {
  return value === "always" || value === "on-failure" || value === "unless-stopped" ? value : "no";
}

function parseContainerInspectOutput(stdout: string): DockerInspectContainer {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    return value[0] as DockerInspectContainer;
  } catch {
    throw new ExpectedError(
      "invalid_container_output",
      "Docker 컨테이너 설정을 해석하지 못했습니다.",
      503,
    );
  }
}

function containerHealthStatus(value: string | undefined): ContainerHealthStatus {
  return value === "healthy" || value === "unhealthy" ? value : "starting";
}

function healthOutput(value: string | undefined): string {
  const output = stripVTControlCharacters(value ?? "").trimEnd();
  const limit = 8_000;
  return output.length > limit ? `${output.slice(0, limit)}\n… 출력이 잘렸습니다.` : output;
}

function containerHealth(inspected: DockerInspectContainer): ContainerHealth | undefined {
  const health = inspected.State.Health;
  if (!health) return undefined;
  return {
    failingStreak:
      typeof health.FailingStreak === "number" && Number.isSafeInteger(health.FailingStreak)
        ? Math.max(0, health.FailingStreak)
        : 0,
    history: (health.Log ?? [])
      .slice(-50)
      .reverse()
      .map((entry) => ({
        endedAt: entry.End ?? "",
        exitCode:
          typeof entry.ExitCode === "number" && Number.isSafeInteger(entry.ExitCode)
            ? entry.ExitCode
            : -1,
        output: healthOutput(entry.Output),
        startedAt: entry.Start ?? "",
      })),
    status: containerHealthStatus(health.Status),
  };
}

function configHash(spec: ContainerSpecInput): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function restartArgument(policy: ContainerSpecInput["restartPolicy"]): string {
  return policy.mode === "on-failure" && policy.maximumRetryCount !== undefined
    ? `${policy.mode}:${policy.maximumRetryCount}`
    : policy.mode;
}

export class DockerContainerService {
  private readonly contextName: string;
  private readonly docker: DockerCommand;
  private readonly probeShell: ProbeContainerShell;

  constructor(docker: DockerCommand, probeShell: ProbeContainerShell, contextName: string) {
    this.docker = docker;
    this.probeShell = probeShell;
    this.contextName = contextName;
  }

  async run(input: RunContainerInput, progress?: OperationProgress): Promise<void> {
    let id: string | undefined;
    try {
      progress?.step("컨테이너 생성 중");
      id = await this.create(input, progress);
      progress?.step("컨테이너 시작 중");
      await this.docker(["container", "start", id], 120_000, progress);
    } catch (error) {
      if (id) await this.safeRemove(id, progress);
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateContainerInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const current = await this.get(id);
    if (current.configHash !== input.expectedConfigHash) {
      throw new ExpectedError(
        "container_changed",
        "컨테이너 설정이 변경되었습니다. 다시 불러온 뒤 수정하십시오.",
        409,
      );
    }
    const replace = containerSpecNeedsReplacement(current.spec, input.spec);
    if (replace) {
      if (current.replacementBlockers.length > 0) {
        throw new ExpectedError(
          "container_not_recreatable",
          `이 컨테이너는 안전하게 다시 만들 수 없습니다: ${current.replacementBlockers.join(" ")}`,
          409,
        );
      }
      await this.replace(current, input.spec, progress);
      return;
    }
    await this.updateNative(current, input.spec, progress);
  }

  async get(id: string): Promise<ContainerDetail> {
    const inspected = await this.inspect(id);
    const blockers: string[] = [];
    const labels = inspected.Config.Labels ?? {};
    if (labels[MANAGED_LABEL] !== "true" || labels[SPEC_VERSION_LABEL] !== "1") {
      blockers.push("Overseer에서 만든 컨테이너가 아닙니다.");
    }
    if (Object.keys(labels).some((key) => key.startsWith("com.docker.compose."))) {
      blockers.push("Compose에서 관리하는 컨테이너입니다.");
    }
    if (inspected.HostConfig.Privileged) blockers.push("privileged 설정이 있습니다.");
    if ((inspected.HostConfig.CapAdd?.length ?? 0) > 0)
      blockers.push("추가 capability가 있습니다.");
    if ((inspected.HostConfig.CapDrop?.length ?? 0) > 0)
      blockers.push("제거 capability가 있습니다.");
    if ((inspected.HostConfig.Devices?.length ?? 0) > 0) blockers.push("device 연결이 있습니다.");
    if ((inspected.HostConfig.SecurityOpt?.length ?? 0) > 0) blockers.push("보안 옵션이 있습니다.");
    if (inspected.HostConfig.NetworkMode === "host") blockers.push("host 네트워크를 사용합니다.");

    const mounts: ContainerMount[] = [];
    const volumes: ContainerVolumeMount[] = [];
    for (const mount of inspected.Mounts ?? []) {
      const common = { containerPath: mount.Destination, readOnly: !mount.RW };
      if (mount.Type === "volume" && mount.Name) {
        mounts.push({ ...common, type: "volume", volume: mount.Name });
        volumes.push({ ...common, volume: mount.Name });
      } else if (mount.Type === "bind") {
        mounts.push({ ...common, hostPath: mount.Source, type: "bind" });
      } else {
        mounts.push({
          ...common,
          dockerType: mount.Type,
          ...(mount.Source ? { source: mount.Source } : {}),
          type: "other",
        });
      }
      if (mount.Type !== "volume" || !mount.Name) {
        blockers.push("named volume 이외의 마운트가 있습니다.");
      }
    }

    const ports: ContainerPortMapping[] = [];
    for (const [key, bindings] of Object.entries(inspected.HostConfig.PortBindings ?? {})) {
      const [portText, protocolText] = key.split("/");
      const containerPort = Number(portText);
      const protocol = protocolText === "udp" ? "udp" : "tcp";
      if ((bindings?.length ?? 0) > 1) blockers.push(`${key}에 복수 호스트 바인딩이 있습니다.`);
      const binding = bindings?.[0];
      if (binding?.HostIp && binding.HostIp !== "127.0.0.1") {
        blockers.push(`${key}가 127.0.0.1 외부에 공개되어 있습니다.`);
      }
      if (Number.isInteger(containerPort) && binding) {
        const hostPort = Number(binding.HostPort);
        ports.push({
          containerPort,
          ...(Number.isInteger(hostPort) && hostPort > 0 ? { hostPort } : {}),
          protocol,
        });
      }
    }

    const idPrefix = inspected.Id.slice(0, 12);
    const hostname =
      inspected.Config.Hostname && inspected.Config.Hostname !== idPrefix
        ? inspected.Config.Hostname
        : undefined;
    const restartPolicy = {
      ...(inspected.HostConfig.RestartPolicy.Name === "on-failure"
        ? { maximumRetryCount: inspected.HostConfig.RestartPolicy.MaximumRetryCount }
        : {}),
      mode: restartMode(inspected.HostConfig.RestartPolicy.Name),
    };
    const spec: ContainerSpecInput = {
      command: [...(inspected.Config.Cmd ?? [])],
      environment: environmentValues(inspected.Config.Env),
      ...(hostname ? { hostname } : {}),
      image: inspected.Config.Image,
      labels: sortedKeyValues(labels),
      name: inspected.Name.replace(/^\//, ""),
      networks: Object.keys(inspected.NetworkSettings.Networks ?? {}).sort(),
      ports: ports.sort((left, right) => left.containerPort - right.containerPort),
      pullPolicy: "missing",
      resources: {
        ...(inspected.HostConfig.NanoCpus > 0
          ? { cpus: inspected.HostConfig.NanoCpus / 1_000_000_000 }
          : {}),
        ...(inspected.HostConfig.Memory > 0
          ? { memoryMiB: Math.round(inspected.HostConfig.Memory / 1_048_576) }
          : {}),
      },
      restartPolicy,
      volumes: volumes.sort((left, right) => left.containerPath.localeCompare(right.containerPath)),
    };
    return {
      configHash: configHash(spec),
      id: inspected.Id,
      mounts: mounts.sort((left, right) => left.containerPath.localeCompare(right.containerPath)),
      replacementBlockers: [...new Set(blockers)],
      running: inspected.State.Running,
      spec,
    };
  }

  async inspection(id: string): Promise<ContainerInspection> {
    const inspected = await this.inspect(id);
    const health = containerHealth(inspected);
    return {
      ...(health ? { health } : {}),
      json: JSON.stringify(inspected, null, 2),
    };
  }

  async terminal(id: string): Promise<ContainerTerminalAccess> {
    let inspected = await this.inspect(id);
    const unavailable = this.terminalUnavailable(inspected);
    if (unavailable) return unavailable;

    for (const shell of CONTAINER_SHELLS) {
      try {
        if (await this.probeShell(id, shell)) {
          return {
            command: `docker --context ${this.contextName} exec -it ${inspected.Id.slice(0, 12)} ${shell}`,
            shell,
            status: "ready",
          };
        }
      } catch (error) {
        inspected = await this.inspect(id);
        const changedState = this.terminalUnavailable(inspected);
        if (changedState) return changedState;
        throw error;
      }
    }

    inspected = await this.inspect(id);
    return this.terminalUnavailable(inspected) ?? { status: "shell-not-found" };
  }

  async action(
    id: string,
    action: "restart" | "start" | "stop",
    progress?: OperationProgress,
  ): Promise<void> {
    progress?.step(
      `컨테이너 ${action === "start" ? "시작" : action === "stop" ? "중지" : "재시작"} 중`,
    );
    await this.docker([action, id], 120_000, progress);
  }

  async remove(id: string, progress?: OperationProgress): Promise<void> {
    progress?.step("컨테이너 삭제 중");
    await this.docker(["container", "rm", id], 120_000, progress);
  }

  async logs(id: string): Promise<string> {
    const result = await this.docker(["logs", "--tail", "300", "--timestamps", id]);
    return stripVTControlCharacters(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).trim();
  }

  async list(): Promise<ContainerSummary[]> {
    const result = await this.docker([
      "container",
      "ls",
      "--all",
      "--format",
      CONTAINER_ROW_FORMAT,
    ]);
    return parseJsonLines<DockerContainerRow>(result.stdout).map((row) => {
      const composeProject = dockerLabel(row.Labels, "com.docker.compose.project");
      const composeService = dockerLabel(row.Labels, "com.docker.compose.service");
      return {
        ...(composeProject ? { composeProject } : {}),
        ...(composeService ? { composeService } : {}),
        id: row.ID,
        image: row.Image,
        name: row.Names,
        ports: row.Ports,
        state: row.State,
        status: row.Status,
      };
    });
  }

  private createArguments(spec: ContainerSpecInput): string[] {
    const args = ["container", "create", "--pull", spec.pullPolicy];
    if (spec.name) args.push("--name", spec.name);
    if (spec.hostname) args.push("--hostname", spec.hostname);
    args.push("--label", `${MANAGED_LABEL}=true`, "--label", `${SPEC_VERSION_LABEL}=1`);
    for (const { key, value } of spec.labels) args.push("--label", `${key}=${value}`);
    for (const { key, value } of spec.environment) args.push("--env", `${key}=${value}`);
    for (const port of spec.ports) {
      args.push(
        "--publish",
        `127.0.0.1:${port.hostPort ?? ""}:${port.containerPort}/${port.protocol}`,
      );
    }
    for (const mount of spec.volumes) {
      args.push(
        "--mount",
        `type=volume,source=${mount.volume},target=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`,
      );
    }
    const firstNetwork = spec.networks[0];
    if (firstNetwork) args.push("--network", firstNetwork);
    args.push("--restart", restartArgument(spec.restartPolicy));
    if (spec.resources.cpus !== undefined) args.push("--cpus", String(spec.resources.cpus));
    if (spec.resources.memoryMiB !== undefined)
      args.push("--memory", `${spec.resources.memoryMiB}m`);
    args.push(spec.image, ...spec.command);
    return args;
  }

  private async create(spec: ContainerSpecInput, progress?: OperationProgress): Promise<string> {
    const result = await this.docker(this.createArguments(spec), 10 * 60_000, progress);
    const id = result.stdout.trim();
    if (!id) {
      throw new ExpectedError("container_id_missing", "새 컨테이너 ID를 받지 못했습니다.", 503);
    }
    for (const network of spec.networks.slice(1)) {
      progress?.step(`${network} 네트워크 연결 중`);
      await this.docker(["network", "connect", network, id], 120_000, progress);
    }
    return id;
  }

  private async updateNative(
    current: ContainerDetail,
    desired: ContainerSpecInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const changedResources =
      JSON.stringify(current.spec.resources) !== JSON.stringify(desired.resources) ||
      JSON.stringify(current.spec.restartPolicy) !== JSON.stringify(desired.restartPolicy);
    const renamed = current.spec.name !== desired.name;
    if (changedResources) {
      progress?.step("리소스와 재시작 정책 수정 중");
      await this.docker(
        ["container", "update", ...this.updateArguments(desired), current.id],
        120_000,
        progress,
      );
    }
    if (!renamed || !desired.name) return;
    try {
      progress?.step("컨테이너 이름 변경 중");
      await this.docker(["container", "rename", current.id, desired.name], 120_000, progress);
    } catch (error) {
      if (changedResources) {
        try {
          await this.docker(
            ["container", "update", ...this.updateArguments(current.spec), current.id],
            120_000,
            progress,
          );
        } catch {
          throw new ExpectedError(
            "container_rollback_failed",
            "이름 변경에 실패했고 리소스 설정도 원상 복구하지 못했습니다.",
            503,
          );
        }
      }
      throw error;
    }
  }

  private updateArguments(spec: ContainerSpecInput): string[] {
    return [
      "--restart",
      restartArgument(spec.restartPolicy),
      "--cpus",
      String(spec.resources.cpus ?? 0),
      "--memory",
      spec.resources.memoryMiB === undefined ? "0" : `${spec.resources.memoryMiB}m`,
    ];
  }

  private async replace(
    current: ContainerDetail,
    desired: ContainerSpecInput,
    progress?: OperationProgress,
  ): Promise<void> {
    const oldName = current.spec.name;
    if (!oldName || !desired.name) {
      throw new ExpectedError(
        "container_name_required",
        "교체하려면 컨테이너 이름이 필요합니다.",
        409,
      );
    }
    const backupName = `${oldName.slice(0, 90)}-overseer-backup-${current.id.slice(0, 8)}`;
    let replacementId: string | undefined;
    let renamed = false;
    try {
      if (current.running) {
        progress?.step("기존 컨테이너 중지 중");
        await this.docker(["container", "stop", current.id], 120_000, progress);
      }
      progress?.step("기존 컨테이너 보존 중");
      await this.docker(["container", "rename", current.id, backupName], 120_000, progress);
      renamed = true;
      progress?.step("새 컨테이너 생성 중");
      replacementId = await this.create(desired, progress);
      if (current.running) {
        progress?.step("새 컨테이너 시작 중");
        await this.docker(["container", "start", replacementId], 120_000, progress);
      }
      progress?.step("이전 컨테이너 정리 중");
      await this.docker(["container", "rm", current.id], 120_000, progress);
    } catch (error) {
      progress?.step("기존 컨테이너 복구 중");
      try {
        if (replacementId) await this.safeRemove(replacementId, progress);
        if (renamed) {
          await this.docker(["container", "rename", current.id, oldName], 120_000, progress);
        }
        if (current.running) {
          await this.docker(["container", "start", current.id], 120_000, progress);
        }
      } catch {
        throw new ExpectedError(
          "container_rollback_failed",
          "컨테이너 교체에 실패했고 기존 컨테이너도 자동 복구하지 못했습니다.",
          503,
        );
      }
      throw error;
    }
  }

  private async safeRemove(id: string, progress?: OperationProgress): Promise<void> {
    try {
      await this.docker(["container", "rm", "--force", id], 120_000, progress);
    } catch {
      // Preserve the original operation failure.
    }
  }

  private async inspect(id: string): Promise<DockerInspectContainer> {
    const result = await this.docker(["container", "inspect", id]);
    return parseContainerInspectOutput(result.stdout);
  }

  private terminalUnavailable(
    inspected: DockerInspectContainer,
  ): ContainerTerminalAccess | undefined {
    if (inspected.State.Paused) return { status: "paused" };
    if (!inspected.State.Running || inspected.State.Restarting) return { status: "not-running" };
    return undefined;
  }
}
