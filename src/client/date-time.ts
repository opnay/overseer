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
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
