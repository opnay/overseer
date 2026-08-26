import type {
  DockerEngineConfiguration,
  DockerEngineConfigurationSnapshot,
  LimaVmType,
} from "@contracts/contracts.ts";

export interface DockerEngineConfigurationForm {
  cpus: number | null;
  diskGiB: number | null;
  memoryGiB: number | null;
  provider: "lima";
  vmType: LimaVmType;
}

export interface DockerEngineConfigurationErrors {
  cpus?: string;
  diskGiB?: string;
  form?: string;
  memoryGiB?: string;
  vmType?: string;
}

export function configurationToForm(
  configuration: DockerEngineConfiguration,
): DockerEngineConfigurationForm {
  return { ...configuration };
}

function integer(value: number | null, minimum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : undefined;
}

export function validateDockerEngineConfiguration(
  form: DockerEngineConfigurationForm,
  snapshot: DockerEngineConfigurationSnapshot,
): {
  configuration?: DockerEngineConfiguration;
  errors: DockerEngineConfigurationErrors;
} {
  const errors: DockerEngineConfigurationErrors = {};
  const cpus = integer(form.cpus, 1);
  const memoryGiB = integer(form.memoryGiB, 1);
  const diskGiB = integer(form.diskGiB, 10);
  if (cpus === undefined) errors.cpus = "CPU는 1 이상의 정수여야 합니다.";
  if (memoryGiB === undefined) errors.memoryGiB = "메모리는 1GiB 이상의 정수여야 합니다.";
  if (diskGiB === undefined) errors.diskGiB = "디스크는 10GiB 이상의 정수여야 합니다.";
  const vmType = snapshot.vmTypes.find(({ value }) => value === form.vmType);
  if (!vmType?.available) {
    errors.vmType = vmType?.unavailableReason ?? "선택한 VM 드라이버를 사용할 수 없습니다.";
  }
  if (cpus === undefined || memoryGiB === undefined || diskGiB === undefined || errors.vmType) {
    return { errors };
  }
  return {
    configuration: { cpus, diskGiB, memoryGiB, provider: form.provider, vmType: form.vmType },
    errors,
  };
}
