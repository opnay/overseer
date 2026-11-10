import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { verifyBundlePrivacy } from "../scripts/verify-release-privacy.ts";
import { verifyCiReleaseAssets } from "../scripts/publish-release-ci.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  setVersion,
  sourceVersion,
  stableVersion,
  updateManifest,
  verifyReleaseSource,
  verifyAssets,
  verifyUpdaterSignature,
  archiveApp,
  verifyUpdateArchive,
  publishRelease,
} from "../scripts/release.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "overseer-release-test-"));
  roots.push(root);
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(join(root, "package.json"), '{"version":"0.0.1"}\n');
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    readFileSync(resolve("src-tauri/tauri.conf.json")),
  );
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
  it("서명된 앱을 수정하지 않고 번들 안의 로컬 경로를 검출합니다", () => {
    const { root } = fixture();
    const bundle = join(root, "Overseer.app");
    mkdirSync(join(bundle, "Contents/MacOS"), { recursive: true });
    const binary = join(bundle, "Contents/MacOS/app");
    writeFileSync(binary, "binary\0/Users/private-account/.cargo/source.rs\0");
    expect(() => verifyBundlePrivacy(bundle, ["/Users/private-account"])).toThrow(/로컬 경로/);
    expect(readFileSync(binary, "utf8")).toContain("/Users/private-account");
    writeFileSync(binary, "binary\0/build/.cargo/source.rs\0");
    expect(() => verifyBundlePrivacy(bundle, ["/Users/private-account"])).not.toThrow();
  });
  it("정식 버전만 허용하고 package·Cargo 버전을 함께 변경합니다", () => {
    for (const value of ["v0.0.2", "01.0.0", "0.0.2-beta", "0.0", "0.0.2+build"])
      expect(() => stableVersion(value)).toThrow();
    const { root } = fixture();
    const configPath = join(root, "src-tauri/tauri.conf.json");
    const originalConfig = readFileSync(configPath, "utf8");
    expect(() => setVersion(root, "0.0.1")).toThrow();
    setVersion(root, "0.0.2");
    expect(sourceVersion(root)).toBe("0.0.2");
    expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
    execFileSync(
      process.execPath,
      [resolve("node_modules/oxfmt/bin/oxfmt"), "--check", configPath],
      { stdio: "pipe" },
    );
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
  let archive: Buffer;
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
    const app = join(root, "Overseer.app");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    writeFileSync(join(app, "Contents/Info.plist"), "plist fixture");
    writeFileSync(join(app, "Contents/MacOS/overseer-desktop"), "binary fixture");
    if (process.platform === "darwin")
      execFileSync("xattr", ["-w", "org.overseer.fixture", "metadata", app]);
    archiveApp(root, app, file);
    archive = readFileSync(file);
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

  it("업데이트 압축 소유자를 빌드 계정 대신 root로 정규화합니다", () => {
    const header = gunzipSync(archive).subarray(0, 512);
    expect(header.subarray(265, 297).toString().replace(/\0.*$/, "")).toBe("root");
    expect(parseInt(header.subarray(108, 116).toString().replace(/\0.*$/, ""), 8)).toBe(0);
    expect(parseInt(header.subarray(116, 124).toString().replace(/\0.*$/, ""), 8)).toBe(0);
  });

  it("앱 외부 메타데이터가 있는 압축은 게시 전에 거부합니다", () => {
    const { root } = fixture();
    mkdirSync(join(root, "Overseer.app/Contents/MacOS"), { recursive: true });
    writeFileSync(join(root, "Overseer.app/Contents/Info.plist"), "plist fixture");
    writeFileSync(join(root, "Overseer.app/Contents/MacOS/overseer-desktop"), "binary fixture");
    writeFileSync(join(root, "._Overseer.app"), "AppleDouble fixture");
    const file = join(root, "invalid.tar.gz");
    execFileSync("tar", ["-czf", file, "-C", root, "Overseer.app", "._Overseer.app"], {
      stdio: "pipe",
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    expect(() => verifyUpdateArchive(root, file)).toThrow(/압축 구조/);
  });

  function assetsFixture(arch = "aarch64") {
    const { root, git } = fixture();
    setVersion(root, "0.0.2");
    writeFileSync(join(root, ".gitignore"), "src-tauri/target/\n");
    const directory = join(root, "src-tauri/target/release/release-assets/v0.0.2", arch);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(root, "src-tauri/tauri.conf.json"),
      JSON.stringify({ version: "../package.json", plugins: { updater: { pubkey: publicKey } } }),
    );
    git("add", ".");
    git("commit", "-qm", "release fixture");
    git("tag", "v0.0.2");
    const commit = git("rev-parse", "HEAD");
    const archiveName = `Overseer_0.0.2_${arch}.app.tar.gz`;
    writeFileSync(join(directory, archiveName), archive);
    writeFileSync(join(directory, `${archiveName}.sig`), signature);
    writeFileSync(join(directory, `Overseer_0.0.2_${arch}.dmg`), "dmg fixture");
    writeFileSync(join(directory, "release-notes.md"), "notes");
    const manifest = updateManifest("0.0.2", arch, signature, "notes");
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "SHA256SUMS.txt"), "checksum fixture");
    const names = [
      archiveName,
      `${archiveName}.sig`,
      `Overseer_0.0.2_${arch}.dmg`,
      "latest.json",
      "SHA256SUMS.txt",
    ];
    const record = {
      version: "0.0.2",
      arch,
      commit,
      assets: names.map((name) => ({
        name,
        sha256: createHash("sha256")
          .update(readFileSync(join(directory, name)))
          .digest("hex"),
      })),
    };
    const recordPath = join(directory, "release-record.json");
    writeFileSync(recordPath, JSON.stringify(record));
    return { root, git, directory, manifest, record, recordPath, commit };
  }

  it("게시 전 manifest·자산 누락·체크섬 불일치를 거부합니다", () => {
    const { root, directory, manifest, record, recordPath, commit } = assetsFixture();
    expect(verifyAssets(root, directory, "0.0.2", "aarch64").commit).toBe(commit);
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

  it("공식 액션의 자산 URL과 서명을 검증하고 다른 다운로드 URL은 거부합니다", () => {
    const { root, directory, manifest, record } = assetsFixture();
    const assets = record.assets.map((asset, index) => ({
      id: index + 1,
      name: asset.name,
      digest: `sha256:${asset.sha256}`,
    }));
    expect(verifyCiReleaseAssets(root, directory, "0.0.2", assets)).toHaveLength(4);
    manifest.platforms["darwin-aarch64"]!.url =
      "https://api.github.com/repos/opnay/overseer/releases/assets/1";
    const update = () => {
      writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
      assets.find((asset) => asset.name === "latest.json")!.digest = `sha256:${createHash("sha256")
        .update(readFileSync(join(directory, "latest.json")))
        .digest("hex")}`;
    };
    update();
    expect(() => verifyCiReleaseAssets(root, directory, "0.0.2", assets)).not.toThrow();
    manifest.platforms["darwin-aarch64"]!.url = "https://example.com/foreign-app.tar.gz";
    update();
    expect(() => verifyCiReleaseAssets(root, directory, "0.0.2", assets)).toThrow(/manifest/);
  });

  it.runIf(process.platform === "darwin")(
    "draft를 ID로 확인하고 원격 체크섬이 맞을 때만 공개합니다",
    () => {
      const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
      const { root, git, directory, record, commit } = assetsFixture(arch);
      git("remote", "add", "origin", "git@github.com:opnay/overseer.git");
      const bin = join(directory, "bin");
      mkdirSync(bin);
      const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      writeFileSync(
        join(bin, "git"),
        `#!/usr/bin/env node
const {execFileSync} = require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='ls-remote') console.log(${JSON.stringify(`${commit}\trefs/tags/v0.0.2`)});
else execFileSync(${JSON.stringify(actualGit)}, args, {stdio:'inherit'});
`,
        { mode: 0o755 },
      );
      const remotePath = join(directory, "remote-assets.json");
      const promotedPath = join(directory, "promoted");
      writeFileSync(
        remotePath,
        JSON.stringify(
          record.assets.map((asset) => ({ name: asset.name, digest: `sha256:${asset.sha256}` })),
        ),
      );
      // Exercise the real CLI boundary without contacting GitHub or changing a release.
      writeFileSync(
        join(bin, "gh"),
        `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='release' && args[1]==='create') process.exit(0);
if(args[0]==='release' && args[1]==='view') console.log(JSON.stringify({databaseId:123,isDraft:true,tagName:'v0.0.2'}));
else if(args[0]==='api' && args[1]==='repos/opnay/overseer/releases/123') console.log(JSON.stringify({id:123,draft:true,tag_name:'v0.0.2',assets:JSON.parse(fs.readFileSync(${JSON.stringify(remotePath)},'utf8'))}));
else if(args[0]==='release' && args[1]==='edit') fs.writeFileSync(${JSON.stringify(promotedPath)},'published');
else { console.error('404: published release not found'); process.exit(1); }
`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
      try {
        expect(() => publishRelease(root)).not.toThrow();
        expect(readFileSync(promotedPath, "utf8")).toBe("published");
        rmSync(promotedPath);
        writeFileSync(
          remotePath,
          JSON.stringify(
            record.assets.map((asset) => ({ name: asset.name, digest: "sha256:invalid" })),
          ),
        );
        expect(() => publishRelease(root)).toThrow(/원격 자산 체크섬/);
        expect(() => readFileSync(promotedPath)).toThrow();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
