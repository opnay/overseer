import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "opnay/overseer";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function capture(root: string, executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function run(root: string, executable: string, args: string[], env = process.env): void {
  execFileSync(executable, args, { cwd: root, env, stdio: "inherit" });
}

function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function stableVersion(value: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error("정식 SemVer 버전을 지정하십시오. 예: 0.0.2");
  }
  return value;
}

function greaterVersion(next: string, current: string): boolean {
  const left = stableVersion(next).split(".").map(BigInt);
  const right = stableVersion(current).split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! > right[index]!;
  }
  return false;
}

export function sourceVersion(root: string): string {
  const version = stableVersion(json(join(root, "package.json")).version);
  const config = json(join(root, "src-tauri/tauri.conf.json"));
  const configured = config.version === "../package.json" ? version : config.version;
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  const crateVersion = cargo.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1];
  const lockVersion = lock.match(/name = "overseer-desktop"\nversion = "([^"]+)"/)?.[1];
  if (configured !== version || crateVersion !== version || lockVersion !== version) {
    throw new Error("package.json·Tauri·Cargo 버전이 일치하지 않습니다.");
  }
  return version;
}

function cleanTree(root: string): void {
  if (capture(root, "git", ["status", "--porcelain"])) {
    throw new Error("작업 트리가 깨끗해야 합니다. 변경사항을 검토·커밋한 뒤 실행하십시오.");
  }
}

export function verifyReleaseSource(root: string): {
  version: string;
  tag: string;
  commit: string;
} {
  cleanTree(root);
  const version = sourceVersion(root);
  const tag = `v${version}`;
  const commit = capture(root, "git", ["rev-parse", "HEAD"]);
  let tagged: string;
  try {
    tagged = capture(root, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
  } catch {
    throw new Error(`${tag} 태그가 없습니다. 릴리즈 준비 커밋에 태그를 생성하십시오.`);
  }
  if (commit !== tagged) throw new Error(`${tag} 태그가 현재 커밋을 가리키지 않습니다.`);
  return { version, tag, commit };
}

export function setVersion(root: string, next: string): void {
  cleanTree(root);
  const current = sourceVersion(root);
  if (!greaterVersion(next, current)) throw new Error("현재보다 높은 정식 버전을 지정하십시오.");
  const tags = capture(root, "git", ["tag", "--list", `v${next}`]);
  if (tags) throw new Error(`v${next} 태그가 이미 있습니다. 기존 릴리즈를 덮어쓰지 마십시오.`);
  const packagePath = join(root, "package.json");
  const manifest = json(packagePath);
  manifest.version = next;
  const cargoPath = join(root, "src-tauri/Cargo.toml");
  const lockPath = join(root, "src-tauri/Cargo.lock");
  const configPath = join(root, "src-tauri/tauri.conf.json");
  const cargo = readFileSync(cargoPath, "utf8").replace(
    /(\[package\][\s\S]*?\nversion = ")[^"]+(")/,
    `$1${next}$2`,
  );
  const lock = readFileSync(lockPath, "utf8").replace(
    /(name = "overseer-desktop"\nversion = ")[^"]+(")/,
    `$1${next}$2`,
  );
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (json(configPath).version !== "../package.json") {
    // Preserve the existing formatter output when migrating a literal version.
    const config = readFileSync(configPath, "utf8").replace(
      /("version"\s*:\s*)"[^"]+"/,
      '$1"../package.json"',
    );
    writeFileSync(configPath, config);
  }
  writeFileSync(cargoPath, cargo);
  writeFileSync(lockPath, lock);
  console.log(`${current} → ${next}. 변경사항을 검토·커밋한 뒤 git tag v${next}를 실행하십시오.`);
}

// Tauri wraps Minisign's text format in base64. Use Node's Ed25519 primitive;
// verify both the archive signature and the authenticated trusted comment.
export function verifyUpdaterSignature(
  publicKey: string,
  encodedSignature: string,
  archive: Buffer,
): void {
  const publicLines = Buffer.from(publicKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const signatureLines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const key = Buffer.from(publicLines[1] ?? "", "base64");
  const signature = Buffer.from(signatureLines[1] ?? "", "base64");
  const global = Buffer.from(signatureLines[3] ?? "", "base64");
  const trusted = signatureLines[2] ?? "";
  if (
    key.length !== 42 ||
    signature.length !== 74 ||
    global.length !== 64 ||
    !trusted.startsWith("trusted comment: ") ||
    !key.subarray(2, 10).equals(signature.subarray(2, 10))
  ) {
    throw new Error("업데이트 서명 형식 또는 공개키가 일치하지 않습니다.");
  }
  const algorithm = signature.subarray(0, 2).toString();
  if (algorithm !== "Ed" && algorithm !== "ED")
    throw new Error("지원하지 않는 업데이트 서명 형식입니다.");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]);
  const signingKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  const message = algorithm === "ED" ? createHash("blake2b512").update(archive).digest() : archive;
  if (
    !verify(null, message, signingKey, signature.subarray(10)) ||
    !verify(
      null,
      Buffer.concat([signature.subarray(10), Buffer.from(trusted.slice(17))]),
      signingKey,
      global,
    )
  ) {
    throw new Error("업데이트 파일의 서명이 앱 공개키와 일치하지 않습니다.");
  }
}

export function updateManifest(version: string, arch: string, signature: string, notes: string) {
  stableVersion(version);
  if (arch !== "aarch64" && arch !== "x86_64")
    throw new Error("지원하지 않는 macOS 아키텍처입니다.");
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [`darwin-${arch}`]: {
        url: `https://github.com/${repository}/releases/download/v${version}/Overseer_${version}_${arch}.app.tar.gz`,
        signature: signature.trim(),
      },
    },
  };
}

function architecture(): string {
  if (process.platform !== "darwin") throw new Error("수동 릴리즈 빌드는 macOS에서 실행하십시오.");
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x86_64";
  throw new Error("지원하지 않는 빌드 아키텍처입니다.");
}

function outputDirectory(root: string, version: string, arch: string): string {
  return join(root, "src-tauri/target/release/release-assets", `v${version}`, arch);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyUpdateArchive(root: string, path: string): void {
  // libarchive otherwise hides AppleDouble entries while listing macOS archives.
  const options = process.platform === "darwin" ? ["--options", "!mac-ext"] : [];
  const entries = capture(root, "tar", [...options, "-tzf", path]).split("\n");
  const required = [
    "Overseer.app/Contents/Info.plist",
    "Overseer.app/Contents/MacOS/overseer-desktop",
  ];
  if (
    !required.every((name) => entries.includes(name)) ||
    entries.some(
      (name) =>
        !name.startsWith("Overseer.app/") ||
        name.split("/").some((part) => part === "." || part === ".." || part.startsWith("._")),
    )
  ) {
    throw new Error(
      "업데이트 압축 구조가 잘못됐습니다. 앱 외부 경로와 macOS 메타데이터를 제외하십시오.",
    );
  }
}

export function archiveApp(root: string, app: string, path: string): void {
  const options =
    process.platform === "darwin"
      ? [
          "--no-mac-metadata",
          "--no-xattrs",
          "--uid",
          "0",
          "--gid",
          "0",
          "--uname",
          "root",
          "--gname",
          "wheel",
        ]
      : ["--owner=root:0", "--group=root:0"];
  run(root, "tar", [...options, "-czf", path, "-C", resolve(app, ".."), "Overseer.app"]);
  verifyUpdateArchive(root, path);
}

export function verifyAssets(root: string, directory: string, version: string, arch: string) {
  const record = json(join(directory, "release-record.json"));
  const config = json(join(root, "src-tauri/tauri.conf.json"));
  const archiveName = `Overseer_${version}_${arch}.app.tar.gz`;
  const archive = readFileSync(join(directory, archiveName));
  const signature = readFileSync(join(directory, `${archiveName}.sig`), "utf8").trim();
  verifyUpdaterSignature(config.plugins.updater.pubkey, signature, archive);
  verifyUpdateArchive(root, join(directory, archiveName));
  const manifest = json(join(directory, "latest.json"));
  const expected = updateManifest(
    version,
    arch,
    signature,
    readFileSync(join(directory, "release-notes.md"), "utf8"),
  );
  if (
    manifest.version !== expected.version ||
    manifest.notes !== expected.notes ||
    JSON.stringify(manifest.platforms) !== JSON.stringify(expected.platforms)
  ) {
    throw new Error("latest.json 버전·URL·서명이 릴리즈 자산과 일치하지 않습니다.");
  }
  const required = [
    `Overseer_${version}_${arch}.dmg`,
    archiveName,
    `${archiveName}.sig`,
    "latest.json",
    "SHA256SUMS.txt",
  ].sort();
  if (
    record.version !== version ||
    record.arch !== arch ||
    JSON.stringify(record.assets.map((asset: { name: string }) => asset.name).sort()) !==
      JSON.stringify(required)
  ) {
    throw new Error("릴리즈 자산 목록 또는 버전이 일치하지 않습니다.");
  }
  for (const asset of record.assets as { name: string; sha256: string }[]) {
    if (
      basename(asset.name) !== asset.name ||
      sha256(join(directory, asset.name)) !== asset.sha256
    ) {
      throw new Error("빌드 이후 릴리즈 자산이 변경됐습니다. 다시 빌드하십시오.");
    }
  }
  return record as { commit: string; assets: { name: string; sha256: string }[] };
}

export function buildRelease(root: string, notesPath: string): void {
  const source = verifyReleaseSource(root);
  const arch = architecture();
  const notes = readFileSync(resolve(notesPath), "utf8");
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (!identity?.startsWith("Developer ID Application:"))
    throw new Error("APPLE_SIGNING_IDENTITY에 Developer ID Application 인증서를 지정하십시오.");
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined)
    throw new Error("TAURI_SIGNING_PRIVATE_KEY_PASSWORD를 터미널의 숨김 입력으로 설정하십시오.");
  const keyPath =
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), ".tauri/overseer.key");
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? readFileSync(keyPath, "utf8");
  const keyContent = existsSync(key) ? readFileSync(key, "utf8") : key;
  const env = { ...process.env, CI: "true", TAURI_SIGNING_PRIVATE_KEY: keyContent };
  const profile = process.env.OVERSEER_NOTARY_PROFILE ?? "overseer-notary";
  const directory = outputDirectory(root, source.version, arch);
  mkdirSync(directory, { recursive: true });
  run(
    root,
    "pnpm",
    [
      "tauri",
      "build",
      "--bundles",
      "app,dmg",
      "--config",
      JSON.stringify({ bundle: { createUpdaterArtifacts: true } }),
    ],
    env,
  );
  const app = join(root, "src-tauri/target/release/bundle/macos/Overseer.app");
  const dmg = join(
    root,
    `src-tauri/target/release/bundle/dmg/Overseer_${source.version}_${arch}.dmg`,
  );
  run(root, "codesign", ["--verify", "--deep", "--strict", app]);
  const bundledVersion = capture(root, "/usr/libexec/PlistBuddy", [
    "-c",
    "Print CFBundleShortVersionString",
    join(app, "Contents/Info.plist"),
  ]);
  if (bundledVersion !== source.version) throw new Error("빌드된 앱 버전이 태그와 다릅니다.");
  const zip = join(directory, "notarization.zip");
  run(root, "ditto", ["-c", "-k", "--keepParent", app, zip]);
  for (const target of [zip, dmg]) {
    const submission = JSON.parse(
      capture(root, "xcrun", [
        "notarytool",
        "submit",
        target,
        "--keychain-profile",
        profile,
        "--wait",
        "--output-format",
        "json",
      ]),
    );
    if (submission.status !== "Accepted")
      throw new Error(`공증이 승인되지 않았습니다: ${submission.id} (${submission.status})`);
    console.log(`공증 승인: ${submission.id}`);
  }
  for (const target of [app, dmg]) {
    run(root, "xcrun", ["stapler", "staple", target]);
    run(root, "xcrun", ["stapler", "validate", target]);
  }
  run(root, "spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  run(root, "spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=2",
    dmg,
  ]);
  const archiveName = `Overseer_${source.version}_${arch}.app.tar.gz`;
  const archivePath = join(directory, archiveName);
  archiveApp(root, app, archivePath);
  const extracted = mkdtempSync(join(directory, "verify-app-"));
  try {
    run(root, "tar", ["-xzf", archivePath, "-C", extracted]);
    const extractedApp = join(extracted, "Overseer.app");
    run(root, "codesign", ["--verify", "--deep", "--strict", extractedApp]);
    run(root, "spctl", ["--assess", "--type", "execute", "--verbose=2", extractedApp]);
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
  run(root, "pnpm", ["tauri", "signer", "sign", archivePath], env);
  const signature = readFileSync(`${archivePath}.sig`, "utf8");
  const dmgName = basename(dmg);
  run(root, "ditto", [dmg, join(directory, dmgName)]);
  writeFileSync(join(directory, "release-notes.md"), notes);
  writeFileSync(
    join(directory, "latest.json"),
    `${JSON.stringify(updateManifest(source.version, arch, signature, notes), null, 2)}\n`,
  );
  const names = [dmgName, archiveName, `${archiveName}.sig`, "latest.json"];
  const assets = names.map((name) => ({ name, sha256: sha256(join(directory, name)) }));
  writeFileSync(
    join(directory, "SHA256SUMS.txt"),
    assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(""),
  );
  assets.push({ name: "SHA256SUMS.txt", sha256: sha256(join(directory, "SHA256SUMS.txt")) });
  writeFileSync(
    join(directory, "release-record.json"),
    `${JSON.stringify({ ...source, arch, assets }, null, 2)}\n`,
  );
  verifyAssets(root, directory, source.version, arch);
  console.log(`릴리즈 자산 검증 완료: ${directory}`);
}

export function publishRelease(root: string): void {
  const source = verifyReleaseSource(root);
  const arch = architecture();
  const directory = outputDirectory(root, source.version, arch);
  const record = verifyAssets(root, directory, source.version, arch);
  if (record.commit !== source.commit)
    throw new Error("릴리즈 자산이 현재 태그 커밋에서 생성되지 않았습니다.");
  const origin = capture(root, "git", ["remote", "get-url", "origin"]);
  if (
    ![
      "git@github.com:opnay/overseer.git",
      "https://github.com/opnay/overseer.git",
      "https://github.com/opnay/overseer",
    ].includes(origin)
  )
    throw new Error("origin이 opnay/overseer 저장소가 아닙니다.");
  const refs = capture(root, "git", [
    "ls-remote",
    "origin",
    `refs/tags/${source.tag}`,
    `refs/tags/${source.tag}^{}`,
  ]);
  const lines = refs.split("\n");
  const remoteCommit = (lines.find((line) => line.endsWith("^{}")) ?? lines[0])?.split(/\s+/)[0];
  if (remoteCommit !== source.commit)
    throw new Error("원격 태그를 먼저 푸시하고 커밋 일치를 확인하십시오.");
  const names = record.assets.map(({ name }) => join(directory, name));
  run(root, "gh", [
    "release",
    "create",
    source.tag,
    ...names,
    "--repo",
    repository,
    "--verify-tag",
    "--draft",
    "--title",
    source.version,
    "--notes-file",
    join(directory, "release-notes.md"),
  ]);
  // gh resolves drafts through GraphQL; REST's tag endpoint only finds published releases.
  const draft = JSON.parse(
    capture(root, "gh", [
      "release",
      "view",
      source.tag,
      "--repo",
      repository,
      "--json",
      "databaseId,isDraft,tagName",
    ]),
  );
  if (
    draft.isDraft !== true ||
    draft.tagName !== source.tag ||
    !Number.isSafeInteger(draft.databaseId) ||
    draft.databaseId <= 0
  ) {
    throw new Error("게시할 draft 릴리즈를 확인하지 못했습니다.");
  }
  const published = JSON.parse(
    capture(root, "gh", ["api", `repos/${repository}/releases/${draft.databaseId}`]),
  );
  if (
    published.draft !== true ||
    published.id !== draft.databaseId ||
    published.tag_name !== source.tag
  ) {
    throw new Error("자산을 확인할 draft 릴리즈가 일치하지 않습니다.");
  }
  for (const asset of record.assets) {
    const remote = published.assets.find(
      (candidate: { name: string }) => candidate.name === asset.name,
    );
    if (remote?.digest !== `sha256:${asset.sha256}`)
      throw new Error("원격 자산 체크섬이 다릅니다. draft를 확인하십시오.");
  }
  run(root, "gh", [
    "release",
    "edit",
    source.tag,
    "--repo",
    repository,
    "--draft=false",
    "--latest",
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, argument] = process.argv.slice(2);
    if (command === "version" && argument) setVersion(projectRoot, argument);
    else if (command === "build" && argument) buildRelease(projectRoot, argument);
    else if (command === "verify") {
      const source = verifyReleaseSource(projectRoot);
      const arch = architecture();
      const record = verifyAssets(
        projectRoot,
        outputDirectory(projectRoot, source.version, arch),
        source.version,
        arch,
      );
      if (record.commit !== source.commit) throw new Error("빌드 커밋이 현재 태그와 다릅니다.");
      console.log("릴리즈 자산 검증 완료");
    } else if (command === "publish") publishRelease(projectRoot);
    else
      throw new Error(
        "사용법: release.ts version <X.Y.Z> | build <릴리즈노트.md> | verify | publish",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "릴리즈 작업에 실패했습니다.");
    process.exitCode = 1;
  }
}
