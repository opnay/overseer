import type { ComposeProjectSummary } from "@contracts/contracts.ts";

export function composeIsRunning(status: string): boolean {
  return status.startsWith("running");
}

export function composeStatusLabel(status: string): string {
  const running = status.match(/^running\((\d+)\)$/)?.[1];
  if (running) return `${running}개 실행 중`;
  const exited = status.match(/^exited\((\d+)\)$/)?.[1];
  if (exited) return `${exited}개 중지됨`;
  const created = status.match(/^created\((\d+)\)$/)?.[1];
  if (created) return `${created}개 생성됨`;
  if (status === "registered") return "등록됨";
  if (status === "blocked") return "실행 제한";
  return status;
}

export function composeStatusTone(
  project: ComposeProjectSummary,
): "neutral" | "success" | "warning" {
  if (composeIsRunning(project.status)) return "success";
  if (project.status === "blocked") return "warning";
  return "neutral";
}

export function composeFileName(file: string): string {
  return file.split("/").filter(Boolean).at(-1) ?? file;
}
