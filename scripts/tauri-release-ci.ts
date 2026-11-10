import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { archiveApp, verifyReleaseSource, verifyUpdaterSignature } from "./release.ts";
import { verifyBundlePrivacy } from "./verify-release-privacy.ts";

// tauri-action's documented tauriScript hook: verify and normalize before upload.
try {
  const root = process.cwd();
  const source = verifyReleaseSource(root);
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { stdio: "inherit" });
  run("pnpm", ["tauri", ...process.argv.slice(2)]);
  const app = join(root, "src-tauri/target/release/bundle/macos/Overseer.app");
  const dmg = join(
    root,
    `src-tauri/target/release/bundle/dmg/Overseer_${source.version}_aarch64.dmg`,
  );
  verifyBundlePrivacy(app, [homedir(), root]);
  for (const target of [app, dmg]) run("codesign", ["--verify", "--deep", "--strict", target]);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  const version = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print CFBundleShortVersionString", join(app, "Contents/Info.plist")],
    { encoding: "utf8" },
  ).trim();
  if (version !== source.version) throw new Error("앱 버전이 릴리즈 태그와 다릅니다.");
  const archive = `${app}.tar.gz`;
  archiveApp(root, app, archive);
  run("pnpm", ["tauri", "signer", "sign", archive]);
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  verifyUpdaterSignature(
    config.plugins.updater.pubkey,
    readFileSync(`${archive}.sig`, "utf8"),
    readFileSync(archive),
  );
  const extracted = mkdtempSync(join(tmpdir(), "overseer-ci-verify-"));
  try {
    run("tar", ["-xzf", archive, "-C", extracted]);
    run("codesign", ["--verify", "--deep", "--strict", join(extracted, "Overseer.app")]);
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "CI 릴리즈 빌드 검증 실패");
  process.exitCode = 1;
}
