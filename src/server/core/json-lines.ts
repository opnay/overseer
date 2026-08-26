export function parseJsonLines<T>(text: string): T[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as T[];

  return trimmed.split("\n").map((line) => JSON.parse(line) as T);
}
