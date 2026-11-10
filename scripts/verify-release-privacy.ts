import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyBundlePrivacy(bundle: string, prefixes: string[]): void {
  const forbidden = prefixes
    .filter((prefix) => prefix.length > 1)
    .map((prefix) => Buffer.from(prefix));
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const contents = readFileSync(path);
        if (forbidden.some((prefix) => contents.includes(prefix))) {
          throw new Error(`빌드 머신의 로컬 경로가 남아 있습니다: ${relative(bundle, path)}`);
        }
      }
    }
  }
  visit(bundle);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bundle = process.argv[2];
    if (!bundle) throw new Error("검사할 앱 번들 경로를 지정하십시오.");
    verifyBundlePrivacy(resolve(bundle), [homedir(), resolve(".")]);
    console.log("릴리즈 앱의 로컬 경로 검사 완료");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "릴리즈 경로 검사 실패");
    process.exitCode = 1;
  }
}
