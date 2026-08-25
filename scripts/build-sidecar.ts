import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const targets = {
  arm64: { bun: "bun-darwin-arm64", rust: "aarch64-apple-darwin" },
  x64: { bun: "bun-darwin-x64", rust: "x86_64-apple-darwin" },
} as const;

if (process.platform !== "darwin" || !(process.arch in targets)) {
  throw new Error(`지원하지 않는 데스크톱 빌드 환경입니다: ${process.platform}/${process.arch}`);
}

const target = targets[process.arch as keyof typeof targets];
const directory = resolve("src-tauri/binaries");
await mkdir(directory, { recursive: true });

const result = await Bun.build({
  compile: {
    outfile: resolve(directory, `overseer-server-${target.rust}`),
    target: target.bun,
  },
  entrypoints: [resolve("src/server/desktop-sidecar.ts")],
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
