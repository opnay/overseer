import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = resolve("src/client");
const sourceExtensions = new Set([".ts", ".tsx"]);

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index < 0 ? "" : path.slice(index);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(sourceExtensions.has(extension(path)) ? [path] : []);
    }),
  );
  return nested.flat();
}

function clientParts(path: string): string[] {
  return relative(clientRoot, path).split(sep);
}

function layer(path: string): "app" | "pages" | "shared" | undefined {
  const value = clientParts(path)[0];
  return value === "app" || value === "pages" || value === "shared" ? value : undefined;
}

function pageSlice(path: string): string | undefined {
  const parts = clientParts(path);
  return parts[0] === "pages" ? parts[1] : undefined;
}

function aliasedTarget(specifier: string): string | undefined {
  return specifier.startsWith("@/") ? resolve(clientRoot, specifier.slice(2)) : undefined;
}

function importSpecifiers(source: string): string[] {
  const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g);
  return [...imports].map((match) => match[1]!).filter(Boolean);
}

function publicApiViolation(specifier: string): string | undefined {
  const parts = specifier.split("/");
  if (parts[1] === "pages" && parts.length !== 3) {
    return `${specifier}: page slice는 index.ts public API로만 접근해야 합니다.`;
  }
  if (parts[1] !== "shared") return undefined;
  if (parts[2] === "api" || parts[2] === "routes") {
    return parts.length === 3
      ? undefined
      : `${specifier}: shared segment public API로만 접근해야 합니다.`;
  }
  if (parts[2] === "lib" || parts[2] === "ui") {
    return parts.length === 4
      ? undefined
      : `${specifier}: shared module public API로만 접근해야 합니다.`;
  }
  return `${specifier}: 정의되지 않은 shared segment입니다.`;
}

describe("client FSD boundaries", () => {
  it("keeps imports downward and slice public APIs explicit", async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(clientRoot)) {
      const sourceLayer = layer(file);
      if (!sourceLayer) continue;
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith("@contracts/")) continue;
        const target = aliasedTarget(specifier);
        if (!target && !specifier.startsWith(".")) continue;
        const resolvedTarget = target ?? resolve(dirname(file), specifier);
        const targetLayer = layer(resolvedTarget);
        if (!targetLayer) continue;

        const ranks = { app: 3, pages: 2, shared: 1 } as const;
        if (ranks[targetLayer] > ranks[sourceLayer]) {
          violations.push(`${relative(clientRoot, file)} -> ${specifier}: 상위 레이어 import`);
          continue;
        }

        if (
          sourceLayer === "pages" &&
          targetLayer === "pages" &&
          pageSlice(file) !== pageSlice(resolvedTarget)
        ) {
          violations.push(`${relative(clientRoot, file)} -> ${specifier}: page slice 간 import`);
          continue;
        }

        if (target && sourceLayer === "pages" && pageSlice(file) === pageSlice(resolvedTarget)) {
          violations.push(
            `${relative(clientRoot, file)} -> ${specifier}: slice 내부는 상대 경로 사용`,
          );
          continue;
        }

        if (target) {
          const violation = publicApiViolation(specifier);
          if (violation) violations.push(`${relative(clientRoot, file)} -> ${violation}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
