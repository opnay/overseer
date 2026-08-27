import type { OperationSnapshot, OperationStatus } from "@contracts/contracts.ts";
import { formatDateTime } from "@/shared/lib/date-time";

export const operationStatusPresentation: Record<
  OperationStatus,
  { label: string; tone: "destructive" | "info" | "neutral" | "success" }
> = {
  cancelled: { label: "취소됨", tone: "neutral" },
  failed: { label: "실패", tone: "destructive" },
  queued: { label: "대기 중", tone: "neutral" },
  running: { label: "진행 중", tone: "info" },
  succeeded: { label: "완료", tone: "success" },
};

export function operationElapsed(operation: OperationSnapshot): string {
  const start = new Date(operation.startedAt ?? operation.createdAt).getTime();
  const end = operation.finishedAt ? new Date(operation.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function operationTime(value: string): string {
  return formatDateTime(value);
}

export function operationListTime(value: string): string {
  return formatDateTime(value);
}

export const operationResourceLabel = {
  compose: "Compose",
  container: "컨테이너",
  image: "이미지",
  imageRepository: "이미지 저장소",
  network: "네트워크",
  runtime: "런타임",
  startup: "시스템 도구",
  volume: "볼륨",
} as const;
