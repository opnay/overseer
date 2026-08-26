import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const serverRoot = resolve("src/server");
const sourceExtensions = new Set([".ts", ".tsx"]);
const rootEntrypoints = new Set(["desktop-sidecar.ts", "dev.ts", "start.ts"]);

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

function parts(path: string): string[] {
  return relative(serverRoot, path).split(sep);
}

function imports(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g)]
    .map((match) => match[1]!)
    .filter(Boolean);
}

function serverTarget(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(file), specifier);
  return target.startsWith(serverRoot) ? target : undefined;
}

function moduleName(path: string): string | undefined {
  const value = parts(path);
  return value[0] === "modules" ? value[1] : undefined;
}

describe("server modular monolith boundaries", () => {
  it("keeps root files, dependency direction, and module public APIs explicit", async () => {
    const violations: string[] = [];
    const files = await sourceFiles(serverRoot);

    for (const file of files) {
      const sourceParts = parts(file);
      const sourceBoundary = sourceParts[0];
      if (sourceParts.length === 1 && !rootEntrypoints.has(sourceParts[0]!)) {
        violations.push(`${sourceParts[0]}: 서버 루트에는 실행 진입점만 둘 수 있습니다.`);
      }

      const source = await readFile(file, "utf8");
      for (const specifier of imports(source)) {
        const target = serverTarget(file, specifier);
        if (!target) continue;
        const targetParts = parts(target);
        const targetBoundary = targetParts[0];

        if (sourceBoundary === "core" && targetBoundary !== "core") {
          violations.push(`${relative(serverRoot, file)} -> ${specifier}: core 상위 경계 import`);
        }
        if (
          sourceBoundary === "application" &&
          (targetBoundary === "app" || targetBoundary === "infrastructure")
        ) {
          violations.push(
            `${relative(serverRoot, file)} -> ${specifier}: application 외부 구현 import`,
          );
        }
        if (
          sourceBoundary === "modules" &&
          (targetBoundary === "app" || targetBoundary === "application")
        ) {
          violations.push(`${relative(serverRoot, file)} -> ${specifier}: module 상위 경계 import`);
        }

        const targetModule = moduleName(target);
        const sourceModule = moduleName(file);
        if (targetModule && targetModule !== sourceModule && targetParts[2] !== "index.ts") {
          violations.push(
            `${relative(serverRoot, file)} -> ${specifier}: 다른 module은 index.ts로 접근해야 합니다.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
