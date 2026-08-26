import type {
  DockerDaemonAddressPool,
  DockerDaemonConfigurationSection,
  DockerDaemonConfigurationSnapshot,
  DockerDaemonLogDriver,
  UpdateDockerDaemonConfigurationInput,
  UpdateDockerDaemonConfigurationSectionInput,
} from "@contracts/contracts.ts";

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

export interface DockerDaemonConfigurationForm {
  additionalJson: string;
  addressPools: string;
  debug: boolean;
  dns: string;
  httpProxy: string;
  httpsProxy: string;
  insecureRegistries: string;
  liveRestore: boolean;
  logDriver: DockerDaemonLogDriver;
  logMaxFile: number | null;
  logMaxSize: string;
  maxConcurrentDownloads: number | null;
  maxConcurrentUploads: number | null;
  noProxy: string;
  registryMirrors: string;
}

export interface DockerDaemonConfigurationErrors {
  additionalJson?: string;
  addressPools?: string;
  logMaxFile?: string;
  maxConcurrentDownloads?: string;
  maxConcurrentUploads?: string;
}

const formSectionByKey: Record<
  keyof DockerDaemonConfigurationForm,
  DockerDaemonConfigurationSection
> = {
  additionalJson: "advanced",
  addressPools: "network",
  debug: "stability",
  dns: "network",
  httpProxy: "proxy",
  httpsProxy: "proxy",
  insecureRegistries: "registry",
  liveRestore: "stability",
  logDriver: "logging",
  logMaxFile: "logging",
  logMaxSize: "logging",
  maxConcurrentDownloads: "transfer",
  maxConcurrentUploads: "transfer",
  noProxy: "proxy",
  registryMirrors: "registry",
};

export function dockerDaemonConfigurationFormSection(
  key: keyof DockerDaemonConfigurationForm,
): DockerDaemonConfigurationSection {
  return formSectionByKey[key];
}

function lines(values: string[]): string {
  return values.join("\n");
}

export function dockerDaemonConfigurationToForm(
  snapshot: DockerDaemonConfigurationSnapshot,
): DockerDaemonConfigurationForm {
  const { configuration } = snapshot;
  return {
    additionalJson: snapshot.additionalJson,
    addressPools: configuration.defaultAddressPools
      .map(({ base, size }) => `${base},${size}`)
      .join("\n"),
    debug: configuration.debug,
    dns: lines(configuration.dns),
    httpProxy: configuration.proxies.httpProxy ?? "",
    httpsProxy: configuration.proxies.httpsProxy ?? "",
    insecureRegistries: lines(configuration.insecureRegistries),
    liveRestore: configuration.liveRestore,
    logDriver: configuration.logDriver,
    logMaxFile: configuration.logMaxFile ?? null,
    logMaxSize: configuration.logMaxSize ?? "",
    maxConcurrentDownloads: configuration.maxConcurrentDownloads,
    maxConcurrentUploads: configuration.maxConcurrentUploads,
    noProxy: lines(configuration.proxies.noProxy),
    registryMirrors: lines(configuration.registryMirrors),
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addressPools(value: string): DockerDaemonAddressPool[] | undefined {
  const pools: DockerDaemonAddressPool[] = [];
  for (const line of splitLines(value)) {
    const parts = line.split(",").map((item) => item.trim());
    if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1] ?? "")) return undefined;
    pools.push({ base: parts[0], size: Number(parts[1]) });
  }
  return pools;
}

function integer(value: number | null, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function validAdditionalJson(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "추가 설정은 JSON 객체여야 합니다.";
    }
    const conflicts = Object.keys(parsed).filter((key) => MANAGED_KEYS.has(key));
    if (conflicts.length > 0) {
      return `폼에서 관리하는 키를 제거하십시오: ${conflicts.join(", ")}`;
    }
    const logOptions = (parsed as Record<string, unknown>)["log-opts"];
    if (logOptions !== undefined) {
      if (!logOptions || typeof logOptions !== "object" || Array.isArray(logOptions)) {
        return "추가 log-opts 설정은 JSON 객체여야 합니다.";
      }
      const logConflicts = Object.keys(logOptions).filter((key) =>
        MANAGED_LOG_OPTION_KEYS.has(key),
      );
      if (logConflicts.length > 0) {
        return `폼에서 관리하는 log-opts 키를 제거하십시오: ${logConflicts.join(", ")}`;
      }
    }
    return undefined;
  } catch {
    return "유효한 JSON 객체를 입력하십시오.";
  }
}

export function validateDockerDaemonConfigurationSection(
  form: DockerDaemonConfigurationForm,
  section: DockerDaemonConfigurationSection,
): {
  errors: DockerDaemonConfigurationErrors;
  input?: UpdateDockerDaemonConfigurationSectionInput;
} {
  if (section === "advanced") {
    const error = validAdditionalJson(form.additionalJson);
    return error
      ? { errors: { additionalJson: error } }
      : { errors: {}, input: { additionalJson: form.additionalJson, section } };
  }
  if (section === "stability") {
    return {
      errors: {},
      input: {
        configuration: { debug: form.debug, liveRestore: form.liveRestore },
        section,
      },
    };
  }
  if (section === "logging") {
    const logMaxFile = form.logMaxFile === null ? undefined : integer(form.logMaxFile, 1, 100);
    if (form.logMaxFile !== null && logMaxFile === undefined) {
      return { errors: { logMaxFile: "보관 파일 수는 1–100 사이의 정수여야 합니다." } };
    }
    return {
      errors: {},
      input: {
        configuration: {
          logDriver: form.logDriver,
          ...(logMaxFile === undefined ? {} : { logMaxFile }),
          ...(form.logMaxSize.trim() ? { logMaxSize: form.logMaxSize.trim() } : {}),
        },
        section,
      },
    };
  }
  if (section === "network") {
    const parsedAddressPools = addressPools(form.addressPools);
    if (!parsedAddressPools) {
      return {
        errors: { addressPools: "한 줄에 CIDR과 서브넷 크기를 쉼표로 구분하십시오." },
      };
    }
    return {
      errors: {},
      input: {
        configuration: { defaultAddressPools: parsedAddressPools, dns: splitLines(form.dns) },
        section,
      },
    };
  }
  if (section === "registry") {
    return {
      errors: {},
      input: {
        configuration: {
          insecureRegistries: splitLines(form.insecureRegistries),
          registryMirrors: splitLines(form.registryMirrors),
        },
        section,
      },
    };
  }
  if (section === "proxy") {
    return {
      errors: {},
      input: {
        configuration: {
          proxies: {
            ...(form.httpProxy.trim() ? { httpProxy: form.httpProxy.trim() } : {}),
            ...(form.httpsProxy.trim() ? { httpsProxy: form.httpsProxy.trim() } : {}),
            noProxy: splitLines(form.noProxy),
          },
        },
        section,
      },
    };
  }
  const maxConcurrentDownloads = integer(form.maxConcurrentDownloads, 0, 100);
  const maxConcurrentUploads = integer(form.maxConcurrentUploads, 0, 100);
  const errors: DockerDaemonConfigurationErrors = {};
  if (maxConcurrentDownloads === undefined) {
    errors.maxConcurrentDownloads = "동시 다운로드 수는 0–100 사이의 정수여야 합니다.";
  }
  if (maxConcurrentUploads === undefined) {
    errors.maxConcurrentUploads = "동시 업로드 수는 0–100 사이의 정수여야 합니다.";
  }
  return maxConcurrentDownloads === undefined || maxConcurrentUploads === undefined
    ? { errors }
    : {
        errors: {},
        input: {
          configuration: { maxConcurrentDownloads, maxConcurrentUploads },
          section: "transfer",
        },
      };
}

export function resetDockerDaemonConfigurationSection(
  form: DockerDaemonConfigurationForm,
  snapshot: DockerDaemonConfigurationSnapshot,
  section: DockerDaemonConfigurationSection,
): DockerDaemonConfigurationForm {
  return copyDockerDaemonConfigurationSection(
    form,
    dockerDaemonConfigurationToForm(snapshot),
    section,
  );
}

function copyDockerDaemonConfigurationSection(
  target: DockerDaemonConfigurationForm,
  source: DockerDaemonConfigurationForm,
  section: DockerDaemonConfigurationSection,
): DockerDaemonConfigurationForm {
  switch (section) {
    case "advanced":
      return { ...target, additionalJson: source.additionalJson };
    case "logging":
      return {
        ...target,
        logDriver: source.logDriver,
        logMaxFile: source.logMaxFile,
        logMaxSize: source.logMaxSize,
      };
    case "network":
      return { ...target, addressPools: source.addressPools, dns: source.dns };
    case "proxy":
      return {
        ...target,
        httpProxy: source.httpProxy,
        httpsProxy: source.httpsProxy,
        noProxy: source.noProxy,
      };
    case "registry":
      return {
        ...target,
        insecureRegistries: source.insecureRegistries,
        registryMirrors: source.registryMirrors,
      };
    case "stability":
      return { ...target, debug: source.debug, liveRestore: source.liveRestore };
    case "transfer":
      return {
        ...target,
        maxConcurrentDownloads: source.maxConcurrentDownloads,
        maxConcurrentUploads: source.maxConcurrentUploads,
      };
  }
}

export function preserveDockerDaemonConfigurationDrafts(
  fresh: DockerDaemonConfigurationForm,
  draft: DockerDaemonConfigurationForm,
  dirtySections: Iterable<DockerDaemonConfigurationSection>,
): DockerDaemonConfigurationForm {
  let merged = fresh;
  for (const section of dirtySections) {
    merged = copyDockerDaemonConfigurationSection(merged, draft, section);
  }
  return merged;
}

export function validateDockerDaemonConfiguration(form: DockerDaemonConfigurationForm): {
  errors: DockerDaemonConfigurationErrors;
  input?: UpdateDockerDaemonConfigurationInput;
} {
  const errors: DockerDaemonConfigurationErrors = {};
  const parsedAddressPools = addressPools(form.addressPools);
  if (!parsedAddressPools) {
    errors.addressPools = "한 줄에 CIDR과 서브넷 크기를 쉼표로 구분하십시오.";
  }
  const logMaxFile = form.logMaxFile === null ? undefined : integer(form.logMaxFile, 1, 100);
  if (form.logMaxFile !== null && logMaxFile === undefined) {
    errors.logMaxFile = "보관 파일 수는 1–100 사이의 정수여야 합니다.";
  }
  const maxConcurrentDownloads = integer(form.maxConcurrentDownloads, 0, 100);
  if (maxConcurrentDownloads === undefined) {
    errors.maxConcurrentDownloads = "동시 다운로드 수는 0–100 사이의 정수여야 합니다.";
  }
  const maxConcurrentUploads = integer(form.maxConcurrentUploads, 0, 100);
  if (maxConcurrentUploads === undefined) {
    errors.maxConcurrentUploads = "동시 업로드 수는 0–100 사이의 정수여야 합니다.";
  }
  errors.additionalJson = validAdditionalJson(form.additionalJson);
  if (
    errors.additionalJson ||
    errors.addressPools ||
    errors.logMaxFile ||
    errors.maxConcurrentDownloads ||
    errors.maxConcurrentUploads ||
    maxConcurrentDownloads === undefined ||
    maxConcurrentUploads === undefined ||
    !parsedAddressPools
  ) {
    return { errors };
  }
  return {
    errors: {},
    input: {
      additionalJson: form.additionalJson,
      configuration: {
        debug: form.debug,
        defaultAddressPools: parsedAddressPools,
        dns: splitLines(form.dns),
        insecureRegistries: splitLines(form.insecureRegistries),
        liveRestore: form.liveRestore,
        logDriver: form.logDriver,
        ...(logMaxFile === undefined ? {} : { logMaxFile }),
        ...(form.logMaxSize.trim() ? { logMaxSize: form.logMaxSize.trim() } : {}),
        maxConcurrentDownloads,
        maxConcurrentUploads,
        proxies: {
          ...(form.httpProxy.trim() ? { httpProxy: form.httpProxy.trim() } : {}),
          ...(form.httpsProxy.trim() ? { httpsProxy: form.httpsProxy.trim() } : {}),
          noProxy: splitLines(form.noProxy),
        },
        registryMirrors: splitLines(form.registryMirrors),
      },
    },
  };
}
