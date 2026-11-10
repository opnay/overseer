const DOCKER_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})(?: \S+)?$/;

function parseDateTime(value: string | number | Date): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const normalized =
    typeof value === "string" ? value.replace(DOCKER_DATE_TIME, "$1T$2$3:$4") : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateTime(value: string | number | Date): string {
  const date = parseDateTime(value);
  if (!date) return typeof value === "string" ? value : "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const relativeTime = new Intl.RelativeTimeFormat("ko", { numeric: "always" });

export function formatRelativeDateTime(
  value: string | number | Date,
  now = Date.now(),
): string | undefined {
  const date = parseDateTime(value);
  if (!date) return undefined;
  const seconds = (date.getTime() - now) / 1000;
  const elapsed = Math.abs(seconds);
  if (elapsed < 60) return "방금";
  const units = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ] as const;
  const [duration, unit] = units.find(([duration]) => elapsed >= duration)!;
  return relativeTime.format(Math.trunc(seconds / duration), unit);
}
