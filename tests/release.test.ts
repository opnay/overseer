import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setVersion,
  sourceVersion,
  stableVersion,
  updateManifest,
  verifyReleaseSource,
  verifyAssets,
  verifyUpdaterSignature,
} from "../scripts/release.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "overseer-release-test-"));
  roots.push(root);
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(join(root, "package.json"), '{"version":"0.0.1"}\n');
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), '{"version":"../package.json"}\n');
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    '[package]\nname = "overseer-desktop"\nversion = "0.0.1"\n',
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.lock"),
    '[[package]]\nname = "overseer-desktop"\nversion = "0.0.1"\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("add", ".");
  git("commit", "-qm", "fixture");
  return { root, git };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("수동 릴리즈 버전과 태그", () => {
  it("정식 버전만 허용하고 package·Cargo 버전을 함께 변경합니다", () => {
    for (const value of ["v0.0.2", "01.0.0", "0.0.2-beta", "0.0", "0.0.2+build"])
      expect(() => stableVersion(value)).toThrow();
    const { root } = fixture();
    expect(() => setVersion(root, "0.0.1")).toThrow();
    setVersion(root, "0.0.2");
    expect(sourceVersion(root)).toBe("0.0.2");
    expect(() => verifyReleaseSource(root)).toThrow(/작업 트리/);
  });

  it("누락된 태그·다른 커밋의 태그·버전 불일치를 거부합니다", () => {
    const { root, git } = fixture();
    expect(() => verifyReleaseSource(root)).toThrow(/태그가 없습니다/);
    git("tag", "v0.0.1");
    expect(verifyReleaseSource(root).commit).toBe(git("rev-parse", "HEAD"));
    git("commit", "--allow-empty", "-qm", "next");
    expect(() => verifyReleaseSource(root)).toThrow(/현재 커밋/);
    writeFileSync(join(root, "src-tauri/Cargo.toml"), '[package]\nversion = "0.0.9"\n');
    expect(() => sourceVersion(root)).toThrow(/일치하지/);
  });

  it("서명 파일 내용과 태그 자산 URL을 배포 메타데이터에 넣습니다", () => {
    const manifest = updateManifest("0.0.2", "aarch64", "signed-content\n", "수정 사항");
    expect(manifest.platforms["darwin-aarch64"]).toEqual({
      signature: "signed-content",
      url: "https://github.com/opnay/overseer/releases/download/v0.0.2/Overseer_0.0.2_aarch64.app.tar.gz",
    });
    expect(() => updateManifest("0.0.2", "arm64", "signature", "")).toThrow();
  });
});

describe("Tauri CLI와 호환되는 자산 서명 검증", () => {
  let publicKey: string;
  let signature: string;
  const archive = Buffer.from("disposable signed update fixture");
  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), "overseer-signature-test-"));
    roots.push(root);
    const key = join(root, "test.key");
    const file = join(root, "fixture.tar.gz");
    const cli = resolve("node_modules/@tauri-apps/cli/tauri.js");
    // Capture CLI output: generated disposable private keys must not enter logs.
    const call = (args: string[]) =>
      execFileSync(process.execPath, [cli, ...args], { stdio: "pipe" });
    call(["signer", "generate", "--ci", "--password", "", "--write-keys", key]);
    writeFileSync(file, archive);
    call(["signer", "sign", "--private-key-path", key, "--password", "", file]);
    publicKey = readFileSync(`${key}.pub`, "utf8");
    signature = readFileSync(`${file}.sig`, "utf8");
  }, 30000);

  it("실제 CLI 서명을 허용하고 파일·서명·trusted comment 변조를 거부합니다", () => {
    expect(() => verifyUpdaterSignature(publicKey, signature, archive)).not.toThrow();
    expect(() => verifyUpdaterSignature(publicKey, signature, Buffer.from("tampered"))).toThrow();
    const decoded = Buffer.from(signature, "base64").toString();
    expect(decoded).toContain("trusted comment: ");
    const changed = Buffer.from(
      decoded.replace("\ntrusted comment: ", "\ntrusted comment: tampered "),
    ).toString("base64");
    expect(() => verifyUpdaterSignature(publicKey, changed, archive)).toThrow();
    expect(() => verifyUpdaterSignature(publicKey, "invalid", archive)).toThrow();
  });

  it("게시 전 manifest·자산 누락·체크섬 불일치를 거부합니다", () => {
    const { root } = fixture();
    const directory = join(root, "assets");
    mkdirSync(directory);
    writeFileSync(
      join(root, "src-tauri/tauri.conf.json"),
      JSON.stringify({ plugins: { updater: { pubkey: publicKey } } }),
    );
    const archiveName = "Overseer_0.0.2_aarch64.app.tar.gz";
    writeFileSync(join(directory, archiveName), archive);
    writeFileSync(join(directory, `${archiveName}.sig`), signature);
    writeFileSync(join(directory, "Overseer_0.0.2_aarch64.dmg"), "dmg fixture");
    writeFileSync(join(directory, "release-notes.md"), "notes");
    const manifest = updateManifest("0.0.2", "aarch64", signature, "notes");
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "SHA256SUMS.txt"), "checksum fixture");
    const names = [
      archiveName,
      `${archiveName}.sig`,
      "Overseer_0.0.2_aarch64.dmg",
      "latest.json",
      "SHA256SUMS.txt",
    ];
    const record = {
      version: "0.0.2",
      arch: "aarch64",
      commit: "fixture",
      assets: names.map((name) => ({
        name,
        sha256: createHash("sha256")
          .update(readFileSync(join(directory, name)))
          .digest("hex"),
      })),
    };
    const recordPath = join(directory, "release-record.json");
    writeFileSync(recordPath, JSON.stringify(record));
    expect(verifyAssets(root, directory, "0.0.2", "aarch64").commit).toBe("fixture");
    writeFileSync(
      join(directory, "latest.json"),
      JSON.stringify({ ...manifest, version: "0.0.3" }),
    );
    expect(() => verifyAssets(root, directory, "0.0.2", "aarch64")).toThrow(/latest.json/);
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
    writeFileSync(recordPath, JSON.stringify({ ...record, assets: record.assets.slice(1) }));
    expect(() => verifyAssets(root, directory, "0.0.2", "aarch64")).toThrow(/자산 목록/);
    writeFileSync(recordPath, JSON.stringify(record));
    writeFileSync(join(directory, "Overseer_0.0.2_aarch64.dmg"), "changed dmg");
    expect(() => verifyAssets(root, directory, "0.0.2", "aarch64")).toThrow(/변경됐습니다/);
  });
});
