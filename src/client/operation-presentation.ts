import type { OperationSnapshot, OperationStatus } from "../shared/contracts.ts";

export const operationStatusPresentation: Record<
  OperationStatus,
  { label: string; tone: "destructive" | "neutral" | "success" | "warning" }
> = {
  cancelled: { label: "취소됨", tone: "neutral" },
  failed: { label: "실패", tone: "destructive" },
  queued: { label: "대기 중", tone: "warning" },
  running: { label: "진행 중", tone: "warning" },
  succeeded: { label: "완료", tone: "success" },
};

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  year: "numeric",
});

export function operationElapsed(operation: OperationSnapshot): string {
  const start = new Date(operation.startedAt ?? operation.createdAt).getTime();
  const end = operation.finishedAt ? new Date(operation.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function operationTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

export const operationResourceLabel = {
  compose: "Compose",
  container: "컨테이너",
  image: "이미지",
  network: "네트워크",
  runtime: "런타임",
  startup: "시스템 도구",
  volume: "볼륨",
} as const;
