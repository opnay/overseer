import type {
  CreateNamedResourceInput,
  NetworkDetail,
  NetworkSummary,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import { parseJsonLines } from "../../core/json-lines.ts";
import { imageLabels, type DockerCommand } from "../docker/index.ts";
import type { OperationProgress } from "../operations/index.ts";

interface DockerNetworkRow {
  CreatedAt: string;
  Driver: string;
  ID: string;
  IPv4: string;
  IPv6: string;
  Internal: string;
  Labels: string;
  Name: string;
  Scope: string;
}

interface DockerInspectNetworkContainer {
  EndpointID?: string;
  IPv4Address?: string;
  IPv6Address?: string;
  MacAddress?: string;
  Name?: string;
}

interface DockerInspectNetwork {
  Attachable?: boolean;
  ConfigOnly?: boolean;
  Containers?: Record<string, DockerInspectNetworkContainer> | null;
  Created: string;
  Driver: string;
  EnableIPv4?: boolean;
  EnableIPv6?: boolean;
  Id: string;
  Ingress?: boolean;
  Internal?: boolean;
  IPAM?: {
    Config?: Array<{
      AuxAddress?: Record<string, string> | null;
      AuxiliaryAddresses?: Record<string, string> | null;
      Gateway?: string;
      IPRange?: string;
      Subnet?: string;
    }> | null;
    Driver?: string;
    Options?: Record<string, string> | null;
  } | null;
  Labels?: Record<string, string> | null;
  Name: string;
  Options?: Record<string, string> | null;
  Scope: string;
}

const NETWORK_ROW_FORMAT = "{{json .}}";
const BUILT_IN_NETWORKS = new Set(["bridge", "host", "none"]);

function parseNetworkInspectOutput(stdout: string): DockerInspectNetwork {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value) || !value[0]) throw new Error("empty inspect output");
    const inspected = value[0] as Partial<DockerInspectNetwork>;
    if (
      typeof inspected.Name !== "string" ||
      typeof inspected.Id !== "string" ||
      typeof inspected.Created !== "string" ||
      typeof inspected.Driver !== "string" ||
      typeof inspected.Scope !== "string"
    ) {
      throw new Error("invalid network inspect output");
    }
    return inspected as DockerInspectNetwork;
  } catch {
    throw new ExpectedError(
      "invalid_network_output",
      "Docker 네트워크 원본 정보를 해석하지 못했습니다.",
      503,
    );
  }
}

export class DockerNetworkService {
  private readonly docker: DockerCommand;

  constructor(docker: DockerCommand) {
    this.docker = docker;
  }

  async create(input: CreateNamedResourceInput, progress?: OperationProgress): Promise<void> {
    progress?.step("네트워크 만드는 중");
    await this.docker(["network", "create", input.name], undefined, progress);
  }

  async remove(name: string, progress?: OperationProgress): Promise<void> {
    if (BUILT_IN_NETWORKS.has(name)) {
      throw new ExpectedError(
        "built_in_network",
        "기본 Docker 네트워크는 삭제할 수 없습니다.",
        409,
      );
    }
    progress?.step("네트워크 삭제 중");
    await this.docker(["network", "rm", name], undefined, progress);
  }

  async list(): Promise<NetworkSummary[]> {
    const result = await this.docker(["network", "ls", "--format", NETWORK_ROW_FORMAT]);
    return parseJsonLines<DockerNetworkRow>(result.stdout).map((row) => ({
      builtIn: BUILT_IN_NETWORKS.has(row.Name),
      createdAt: row.CreatedAt,
      driver: row.Driver,
      id: row.ID,
      internal: row.Internal === "true",
      ipv4: row.IPv4 === "true",
      ipv6: row.IPv6 === "true",
      labels: row.Labels,
      name: row.Name,
      scope: row.Scope,
    }));
  }

  async get(name: string): Promise<NetworkDetail> {
    const result = await this.docker(["network", "inspect", name]);
    const inspected = parseNetworkInspectOutput(result.stdout);
    return {
      attachable: inspected.Attachable === true,
      builtIn: BUILT_IN_NETWORKS.has(inspected.Name),
      configOnly: inspected.ConfigOnly === true,
      containers: Object.entries(inspected.Containers ?? {})
        .map(([id, container]) => ({
          ...(container.EndpointID ? { endpointId: container.EndpointID } : {}),
          id,
          ...(container.IPv4Address ? { ipv4Address: container.IPv4Address } : {}),
          ...(container.IPv6Address ? { ipv6Address: container.IPv6Address } : {}),
          ...(container.MacAddress ? { macAddress: container.MacAddress } : {}),
          name: container.Name || id.slice(0, 12),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      createdAt: inspected.Created,
      driver: inspected.Driver,
      enableIpv4:
        inspected.EnableIPv4 === true ||
        (inspected.IPAM?.Config ?? []).some(({ Subnet }) => Subnet?.includes(".")),
      enableIpv6:
        inspected.EnableIPv6 === true ||
        (inspected.IPAM?.Config ?? []).some(({ Subnet }) => Subnet?.includes(":")),
      id: inspected.Id,
      ingress: inspected.Ingress === true,
      inspectJson: JSON.stringify(inspected, null, 2),
      internal: inspected.Internal === true,
      ipamConfigurations: (inspected.IPAM?.Config ?? []).map((configuration) => ({
        auxiliaryAddresses: imageLabels(
          configuration.AuxAddress ?? configuration.AuxiliaryAddresses,
        ),
        ...(configuration.Gateway ? { gateway: configuration.Gateway } : {}),
        ...(configuration.IPRange ? { ipRange: configuration.IPRange } : {}),
        ...(configuration.Subnet ? { subnet: configuration.Subnet } : {}),
      })),
      ipamDriver: inspected.IPAM?.Driver ?? "—",
      ipamOptions: imageLabels(inspected.IPAM?.Options),
      labels: imageLabels(inspected.Labels),
      name: inspected.Name,
      options: imageLabels(inspected.Options),
      scope: inspected.Scope,
    };
  }
}
