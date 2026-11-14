export type BuildStatus = "running" | "succeeded" | "failed" | "unknown";

export function isBuildIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

export interface BuildRecord {
  id: string;
  name: string;
  status: BuildStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  totalSteps?: number;
  completedSteps?: number;
  cachedSteps?: number;
}

export interface BuildListQuery {
  name?: string;
  status?: BuildStatus;
  page: number;
  pageSize: number;
}

export interface BuildHistory {
  instance: string;
  builder: "default";
  records: BuildRecord[];
  count: number;
  page: number;
  pageSize: number;
}

export interface BuildDetail extends BuildRecord {
  context?: string;
  dockerfile?: string;
  target?: string;
  platforms: string[];
  repository?: string;
  revision?: string;
  error?: string;
  materials: Array<{ uri: string; digest?: string }>;
  outputs: Array<{ type: string; digest: string; platform?: string }>;
}

export interface BuildDetailResponse {
  instance: string;
  build: BuildDetail;
}

export interface BuildLogsResponse {
  instance: string;
  logs: { text: string };
}
