import { isIP } from "node:net";
import type {
  DockerDaemonAddressPool,
  DockerDaemonConfiguration,
  DockerDaemonConfigurationSnapshot,
  DockerDaemonProxyConfiguration,
  UpdateDockerDaemonConfigurationInput,
  UpdateDockerDaemonConfigurationSectionInput,
} from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";

const MANAGED_KEYS = new Set([
  "debug",
  "default-address-pools",
  "dns",
  "insecure-registries",
  "live-restore",
  "log-driver",
  "max-concurrent-downloads",
  "max-concurrent-uploads",
  "proxies",
  "registry-mirrors",
]);
const MANAGED_LOG_OPTION_KEYS = new Set(["max-file", "max-size"]);
const DOCKER_SIZE = /^\d+(?:\.\d+)?(?:[kmgt]i?b?|b)?$/i;
const MAX_ADDITIONAL_JSON_LENGTH = 64 * 1024;
const MAX_LIST_ITEMS = 64;

export const DEFAULT_DOCKER_DAEMON_CONFIGURATION: DockerDaemonConfiguration = {
  debug: false,
  defaultAddressPools: [],
  dns: [],
  insecureRegistries: [],
  liveRestore: false,
  logDriver: "json-file",
  maxConcurrentDownloads: 3,
  maxConcurrentUploads: 5,
  proxies: { noProxy: [] },
  registryMirrors: [],
};

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpectedError("invalid_daemon_configuration", message, 400);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      `${label}에서 지원하지 않는 키를 제거하십시오: ${unexpected.join(", ")}`,
      400,
    );
  }
  return input;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ExpectedError("invalid_daemon_configuration", `${label} 설정을 확인하십시오.`, 400);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      `${label}은 ${minimum}–${maximum} 사이의 정수여야 합니다.`,
      400,
    );
  }
  return value;
}

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  return integer(value, label, minimum, maximum);
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new ExpectedError("invalid_daemon_configuration", `${label} 목록을 확인하십시오.`, 400);
  }
  const values = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 2_048 || /[\r\n\0]/.test(item)) {
      throw new ExpectedError("invalid_daemon_configuration", `${label} 항목을 확인하십시오.`, 400);
    }
    return item.trim();
  });
  if (new Set(values).size !== values.length) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      `${label}에 중복 항목이 있습니다.`,
      400,
    );
  }
  return values;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2_048 || /[\r\n\0]/.test(value)) {
    throw new ExpectedError("invalid_daemon_configuration", `${label} 값을 확인하십시오.`, 400);
  }
  return value.trim();
}

function url(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ExpectedError("invalid_daemon_configuration", `${label} URL을 확인하십시오.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      `${label}는 HTTP 또는 HTTPS URL이어야 합니다.`,
      400,
    );
  }
  return parsed.href;
}

function cidr(value: string, label: string): { bits: number; prefix: number } {
  const [address, prefixSource, ...rest] = value.split("/");
  const version = address ? isIP(address) : 0;
  const prefix = Number(prefixSource);
  const bits = version === 4 ? 32 : version === 6 ? 128 : 0;
  if (
    rest.length > 0 ||
    !bits ||
    !/^\d+$/.test(prefixSource ?? "") ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > bits
  ) {
    throw new ExpectedError("invalid_daemon_configuration", `${label} CIDR을 확인하십시오.`, 400);
  }
  return { bits, prefix };
}

function addressPools(value: unknown): DockerDaemonAddressPool[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "기본 주소 풀 목록을 확인하십시오.",
      400,
    );
  }
  return value.map((item) => {
    const input = record(item, "기본 주소 풀 항목을 확인하십시오.");
    if (typeof input.base !== "string") {
      throw new ExpectedError(
        "invalid_daemon_configuration",
        "기본 주소 풀 CIDR을 확인하십시오.",
        400,
      );
    }
    const base = input.base.trim();
    const { bits, prefix } = cidr(base, "기본 주소 풀");
    const size = integer(input.size, "기본 주소 풀 크기", prefix, bits);
    return { base, size };
  });
}

function proxies(value: unknown): DockerDaemonProxyConfiguration {
  const input = record(value, "프록시 설정을 확인하십시오.");
  const httpProxySource = optionalString(input.httpProxy, "HTTP 프록시");
  const httpsProxySource = optionalString(input.httpsProxy, "HTTPS 프록시");
  return {
    ...(httpProxySource ? { httpProxy: url(httpProxySource, "HTTP 프록시") } : {}),
    ...(httpsProxySource ? { httpsProxy: url(httpsProxySource, "HTTPS 프록시") } : {}),
    noProxy: strings(input.noProxy, "프록시 제외"),
  };
}

function additionalConfiguration(source: string): Record<string, unknown> {
  if (source.length > MAX_ADDITIONAL_JSON_LENGTH) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "추가 daemon.json 설정은 64KiB 이하여야 합니다.",
      400,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "추가 daemon.json 설정은 유효한 JSON 객체여야 합니다.",
      400,
    );
  }
  const input = record(value, "추가 daemon.json 설정은 JSON 객체여야 합니다.");
  const conflicts = Object.keys(input).filter((key) => MANAGED_KEYS.has(key));
  if (conflicts.length > 0) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      `추가 설정에서 폼 관리 키를 제거하십시오: ${conflicts.join(", ")}`,
      400,
    );
  }
  if (input["log-opts"] !== undefined) {
    const logOptions = record(input["log-opts"], "추가 log-opts 설정은 JSON 객체여야 합니다.");
    const logConflicts = Object.keys(logOptions).filter((key) => MANAGED_LOG_OPTION_KEYS.has(key));
    if (logConflicts.length > 0) {
      throw new ExpectedError(
        "invalid_daemon_configuration",
        `추가 설정에서 폼 관리 log-opts 키를 제거하십시오: ${logConflicts.join(", ")}`,
        400,
      );
    }
  }
  return input;
}

function parseLoggingConfiguration(
  value: unknown,
): Pick<DockerDaemonConfiguration, "logDriver" | "logMaxFile" | "logMaxSize"> {
  const input = record(value, "컨테이너 로그 설정을 확인하십시오.");
  if (input.logDriver !== "json-file" && input.logDriver !== "local") {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "로그 드라이버는 local 또는 json-file이어야 합니다.",
      400,
    );
  }
  const logMaxSize = optionalString(input.logMaxSize, "로그 최대 크기");
  if (logMaxSize && !DOCKER_SIZE.test(logMaxSize)) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "로그 최대 크기는 10m 또는 1GiB 같은 형식이어야 합니다.",
      400,
    );
  }
  const logMaxFile = optionalInteger(input.logMaxFile, "로그 보관 파일 수", 1, 100);
  return {
    logDriver: input.logDriver,
    ...(logMaxFile === undefined ? {} : { logMaxFile }),
    ...(logMaxSize ? { logMaxSize } : {}),
  };
}

function parseNetworkConfiguration(
  value: unknown,
): Pick<DockerDaemonConfiguration, "defaultAddressPools" | "dns"> {
  const input = record(value, "네트워크 설정을 확인하십시오.");
  const dns = strings(input.dns, "DNS");
  if (dns.some((entry) => !isIP(entry))) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "DNS에는 IPv4 또는 IPv6 주소만 입력하십시오.",
      400,
    );
  }
  return { defaultAddressPools: addressPools(input.defaultAddressPools), dns };
}

function parseRegistryConfiguration(
  value: unknown,
): Pick<DockerDaemonConfiguration, "insecureRegistries" | "registryMirrors"> {
  const input = record(value, "레지스트리 설정을 확인하십시오.");
  const registryMirrors = strings(input.registryMirrors, "레지스트리 미러").map((entry) =>
    url(entry, "레지스트리 미러"),
  );
  const insecureRegistries = strings(input.insecureRegistries, "비보안 레지스트리");
  if (insecureRegistries.some((entry) => /\s/.test(entry))) {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "비보안 레지스트리에는 공백을 사용할 수 없습니다.",
      400,
    );
  }
  return { insecureRegistries, registryMirrors };
}

function parseStabilityConfiguration(
  value: unknown,
): Pick<DockerDaemonConfiguration, "debug" | "liveRestore"> {
  const input = record(value, "Docker Engine 동작 및 진단 설정을 확인하십시오.");
  return {
    debug: boolean(input.debug, "Debug mode"),
    liveRestore: boolean(input.liveRestore, "Live restore"),
  };
}

function parseTransferConfiguration(
  value: unknown,
): Pick<DockerDaemonConfiguration, "maxConcurrentDownloads" | "maxConcurrentUploads"> {
  const input = record(value, "전송 설정을 확인하십시오.");
  return {
    maxConcurrentDownloads: integer(input.maxConcurrentDownloads, "최대 동시 다운로드", 0, 100),
    maxConcurrentUploads: integer(input.maxConcurrentUploads, "최대 동시 업로드", 0, 100),
  };
}

function parseProxyConfiguration(value: unknown): Pick<DockerDaemonConfiguration, "proxies"> {
  const input = record(value, "프록시 설정을 확인하십시오.");
  return { proxies: proxies(input.proxies) };
}

export function parseDockerDaemonConfiguration(value: unknown): DockerDaemonConfiguration {
  const input = record(value, "Docker Engine 설정을 확인하십시오.");
  return {
    ...parseStabilityConfiguration(input),
    ...parseLoggingConfiguration(input),
    ...parseNetworkConfiguration(input),
    ...parseRegistryConfiguration(input),
    ...parseTransferConfiguration(input),
    ...parseProxyConfiguration(input),
  };
}

export function parseUpdateDockerDaemonConfigurationInput(
  value: unknown,
): UpdateDockerDaemonConfigurationInput {
  const input = record(value, "Docker Engine 설정 요청을 확인하십시오.");
  if (typeof input.additionalJson !== "string") {
    throw new ExpectedError(
      "invalid_daemon_configuration",
      "추가 daemon.json 설정을 확인하십시오.",
      400,
    );
  }
  additionalConfiguration(input.additionalJson);
  return {
    additionalJson: input.additionalJson,
    configuration: parseDockerDaemonConfiguration(input.configuration),
  };
}

export function parseUpdateDockerDaemonConfigurationSectionInput(
  section: string,
  value: unknown,
): UpdateDockerDaemonConfigurationSectionInput {
  const input = record(value, "Docker Engine 부분 설정 요청을 확인하십시오.");
  switch (section) {
    case "advanced":
      onlyKeys(input, ["additionalJson"], "고급 JSON 설정 요청");
      if (typeof input.additionalJson !== "string") {
        throw new ExpectedError(
          "invalid_daemon_configuration",
          "추가 daemon.json 설정을 확인하십시오.",
          400,
        );
      }
      additionalConfiguration(input.additionalJson);
      return { additionalJson: input.additionalJson, section };
    case "logging": {
      onlyKeys(input, ["configuration"], "컨테이너 로그 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "컨테이너 로그 설정을 확인하십시오."),
        ["logDriver", "logMaxFile", "logMaxSize"],
        "컨테이너 로그 설정",
      );
      return { configuration: parseLoggingConfiguration(configuration), section };
    }
    case "network": {
      onlyKeys(input, ["configuration"], "네트워크 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "네트워크 설정을 확인하십시오."),
        ["defaultAddressPools", "dns"],
        "네트워크 설정",
      );
      return { configuration: parseNetworkConfiguration(configuration), section };
    }
    case "proxy": {
      onlyKeys(input, ["configuration"], "프록시 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "프록시 설정을 확인하십시오."),
        ["proxies"],
        "프록시 설정",
      );
      return { configuration: parseProxyConfiguration(configuration), section };
    }
    case "registry": {
      onlyKeys(input, ["configuration"], "Registry 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "Registry 설정을 확인하십시오."),
        ["insecureRegistries", "registryMirrors"],
        "Registry 설정",
      );
      return { configuration: parseRegistryConfiguration(configuration), section };
    }
    case "stability": {
      onlyKeys(input, ["configuration"], "Docker Engine 동작 및 진단 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "Docker Engine 동작 및 진단 설정을 확인하십시오."),
        ["debug", "liveRestore"],
        "Docker Engine 동작 및 진단 설정",
      );
      return { configuration: parseStabilityConfiguration(configuration), section };
    }
    case "transfer": {
      onlyKeys(input, ["configuration"], "전송 설정 요청");
      const configuration = onlyKeys(
        record(input.configuration, "전송 설정을 확인하십시오."),
        ["maxConcurrentDownloads", "maxConcurrentUploads"],
        "전송 설정",
      );
      return { configuration: parseTransferConfiguration(configuration), section };
    }
    default:
      throw new ExpectedError(
        "invalid_daemon_configuration_section",
        "지원하지 않는 Docker Engine 설정 섹션입니다.",
        400,
      );
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function configurationFromObject(input: Record<string, unknown>): DockerDaemonConfiguration {
  const logOptions =
    input["log-opts"] && typeof input["log-opts"] === "object" && !Array.isArray(input["log-opts"])
      ? (input["log-opts"] as Record<string, unknown>)
      : {};
  const proxyOptions =
    input.proxies && typeof input.proxies === "object" && !Array.isArray(input.proxies)
      ? (input.proxies as Record<string, unknown>)
      : {};
  const logMaxFileSource = logOptions["max-file"];
  const logMaxFile =
    typeof logMaxFileSource === "string" && /^\d+$/.test(logMaxFileSource)
      ? Number(logMaxFileSource)
      : undefined;
  const logMaxSize =
    typeof logOptions["max-size"] === "string" ? logOptions["max-size"] : undefined;
  return {
    debug: input.debug === true,
    defaultAddressPools: Array.isArray(input["default-address-pools"])
      ? input["default-address-pools"].flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const pool = item as Record<string, unknown>;
          return typeof pool.base === "string" && typeof pool.size === "number"
            ? [{ base: pool.base, size: pool.size }]
            : [];
        })
      : [],
    dns: stringArray(input.dns),
    insecureRegistries: stringArray(input["insecure-registries"]),
    liveRestore: input["live-restore"] === true,
    logDriver: input["log-driver"] === "local" ? "local" : "json-file",
    ...(logMaxFile === undefined ? {} : { logMaxFile }),
    ...(logMaxSize === undefined ? {} : { logMaxSize }),
    maxConcurrentDownloads: integerOr(input["max-concurrent-downloads"], 3),
    maxConcurrentUploads: integerOr(input["max-concurrent-uploads"], 5),
    proxies: {
      ...(typeof proxyOptions["http-proxy"] === "string"
        ? { httpProxy: proxyOptions["http-proxy"] }
        : {}),
      ...(typeof proxyOptions["https-proxy"] === "string"
        ? { httpsProxy: proxyOptions["https-proxy"] }
        : {}),
      noProxy:
        typeof proxyOptions["no-proxy"] === "string"
          ? proxyOptions["no-proxy"]
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
    },
    registryMirrors: stringArray(input["registry-mirrors"]),
  };
}

export function dockerDaemonSnapshot(
  source: string,
  exists: boolean,
  available: boolean,
  message: string,
): DockerDaemonConfigurationSnapshot {
  let input: Record<string, unknown> = {};
  if (source.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new ExpectedError(
        "invalid_daemon_configuration_file",
        "VM의 daemon.json을 읽지 못했습니다.",
        503,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ExpectedError(
        "invalid_daemon_configuration_file",
        "VM의 daemon.json은 JSON 객체여야 합니다.",
        503,
      );
    }
    input = parsed as Record<string, unknown>;
  }
  const additional = Object.fromEntries(
    Object.entries(input).filter(([key]) => !MANAGED_KEYS.has(key)),
  );
  const logOptions =
    input["log-opts"] && typeof input["log-opts"] === "object" && !Array.isArray(input["log-opts"])
      ? (input["log-opts"] as Record<string, unknown>)
      : {};
  const additionalLogOptions = Object.fromEntries(
    Object.entries(logOptions).filter(([key]) => !MANAGED_LOG_OPTION_KEYS.has(key)),
  );
  if (Object.keys(additionalLogOptions).length > 0) {
    additional["log-opts"] = additionalLogOptions;
  } else {
    delete additional["log-opts"];
  }
  return {
    additionalJson: `${JSON.stringify(additional, null, 2)}\n`,
    available,
    configuration: available
      ? configurationFromObject(input)
      : structuredClone(DEFAULT_DOCKER_DAEMON_CONFIGURATION),
    message,
    path: "~/.config/docker/daemon.json",
    source: exists ? "file" : "default",
  };
}

export function mergeDockerDaemonConfigurationSection(
  snapshot: DockerDaemonConfigurationSnapshot,
  input: UpdateDockerDaemonConfigurationSectionInput,
): UpdateDockerDaemonConfigurationInput {
  const current = structuredClone(snapshot.configuration);
  if (input.section === "advanced") {
    return { additionalJson: input.additionalJson, configuration: current };
  }
  if (input.section === "logging") {
    const { logMaxFile: _logMaxFile, logMaxSize: _logMaxSize, ...rest } = current;
    return {
      additionalJson: snapshot.additionalJson,
      configuration: { ...rest, ...input.configuration },
    };
  }
  return {
    additionalJson: snapshot.additionalJson,
    configuration: { ...current, ...input.configuration },
  };
}

export function dockerDaemonJson(input: UpdateDockerDaemonConfigurationInput): string {
  const additional = additionalConfiguration(input.additionalJson);
  const configuration = parseDockerDaemonConfiguration(input.configuration);
  const { "log-opts": additionalLogOptions = {}, ...additionalTopLevel } = additional;
  const logOptions = {
    ...(additionalLogOptions as Record<string, unknown>),
    ...(configuration.logMaxSize ? { "max-size": configuration.logMaxSize } : {}),
    ...(configuration.logMaxFile === undefined
      ? {}
      : { "max-file": String(configuration.logMaxFile) }),
  };
  const proxyOptions = {
    ...(configuration.proxies.httpProxy ? { "http-proxy": configuration.proxies.httpProxy } : {}),
    ...(configuration.proxies.httpsProxy
      ? { "https-proxy": configuration.proxies.httpsProxy }
      : {}),
    ...(configuration.proxies.noProxy.length > 0
      ? { "no-proxy": configuration.proxies.noProxy.join(",") }
      : {}),
  };
  const output = {
    ...additionalTopLevel,
    debug: configuration.debug,
    "live-restore": configuration.liveRestore,
    "log-driver": configuration.logDriver,
    ...(Object.keys(logOptions).length > 0 ? { "log-opts": logOptions } : {}),
    ...(configuration.dns.length > 0 ? { dns: configuration.dns } : {}),
    ...(configuration.defaultAddressPools.length > 0
      ? { "default-address-pools": configuration.defaultAddressPools }
      : {}),
    ...(configuration.registryMirrors.length > 0
      ? { "registry-mirrors": configuration.registryMirrors }
      : {}),
    ...(configuration.insecureRegistries.length > 0
      ? { "insecure-registries": configuration.insecureRegistries }
      : {}),
    ...(Object.keys(proxyOptions).length > 0 ? { proxies: proxyOptions } : {}),
    "max-concurrent-downloads": configuration.maxConcurrentDownloads,
    "max-concurrent-uploads": configuration.maxConcurrentUploads,
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}
