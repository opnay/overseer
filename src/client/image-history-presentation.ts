import type { ImageHistoryEntry } from "../shared/contracts.ts";

const DOUBLE_SHELL_OPERATORS = new Set(["&&", "||", ";;", "|&"]);

function collapseUnquotedWhitespace(value: string): string {
  let result = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let pendingSpace = false;

  for (const character of value) {
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      result += character;
      escaped = true;
      continue;
    }
    if (quote) {
      result += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      result += character;
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = Boolean(result);
      continue;
    }
    if (pendingSpace && result) result += " ";
    pendingSpace = false;
    result += character;
  }

  return result.trim();
}

function normalizeDockerfileInstruction(value: string): string {
  const flattened = value.replace(/\r?\n/g, " ").trim();
  const normalized = flattened
    .replace(/^RUN \|\d+(?:\s+\S+=\S+)+\s+\/bin\/sh -c\s+/, "RUN ")
    .replace(/^RUN \/bin\/sh -c\s+/, "RUN ")
    .replace(/^\/bin\/sh -c #\(nop\)\s+/, "")
    .replace(/^\/bin\/sh -c\s+/, "RUN ")
    .replace(/\s+# buildkit$/, "");
  return collapseUnquotedWhitespace(normalized);
}

function splitShellOperators(value: string): string[] {
  const lines: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      current += character;
      quote = character;
      continue;
    }

    const pair = value.slice(index, index + 2);
    const operator = DOUBLE_SHELL_OPERATORS.has(pair)
      ? pair
      : character === "|" || character === ";"
        ? character
        : undefined;
    if (!operator) {
      current += character;
      continue;
    }
    if (current.trim()) lines.push(current.trim());
    current = operator;
    index += operator.length - 1;
    while (value[index + 1] === " " || value[index + 1] === "\t") index += 1;
    if (value[index + 1]) current += " ";
  }

  if (current.trim()) lines.push(current.trim());
  return lines.filter(Boolean);
}

function formatDockerfileInstruction(value: string): string {
  const lines = splitShellOperators(normalizeDockerfileInstruction(value));
  if (lines.length < 2) return lines[0] ?? "# 명령 정보 없음";
  return lines
    .map(
      (line, index) =>
        `${index > 0 ? "    " : ""}${line.trim()}${index < lines.length - 1 ? " \\" : ""}`,
    )
    .join("\n");
}

export function reconstructDockerfileLayers(history: ImageHistoryEntry[]): string {
  const buildOrder = [...history].reverse();
  const numberWidth = String(buildOrder.length).length;
  return buildOrder
    .map((entry, index) => {
      const layerNumber = String(index + 1).padStart(numberWidth, "0");
      return `# Layer ${layerNumber} · ${entry.size}\n${formatDockerfileInstruction(entry.createdBy)}`;
    })
    .join("\n\n");
}
