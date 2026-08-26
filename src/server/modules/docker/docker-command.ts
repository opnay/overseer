import type { ContainerKeyValue } from "../../../shared/contracts.ts";
import type { OperationProgress } from "../operations/index.ts";

export interface DockerCommandResult {
  stderr: string;
  stdout: string;
}

export type DockerCommand = (
  args: readonly string[],
  timeoutMs?: number,
  progress?: OperationProgress,
) => Promise<DockerCommandResult>;

export function sortedKeyValues(
  value: Record<string, string> | null | undefined,
): ContainerKeyValue[] {
  return Object.entries(value ?? {})
    .map(([key, item]) => ({ key, value: item }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function environmentValues(value: string[] | null | undefined): ContainerKeyValue[] {
  return (value ?? [])
    .map((entry) => {
      const index = entry.indexOf("=");
      return index < 0
        ? { key: entry, value: "" }
        : { key: entry.slice(0, index), value: entry.slice(index + 1) };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

export const imageLabels = sortedKeyValues;
