import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseSource, verifyUpdateArchive, verifyUpdaterSignature } from "./release.ts";

interface ReleaseAsset {
  id: number;
  name: string;
  digest: string;
}

export function verifyCiReleaseAssets(
  root: string,
  directory: string,
  version: string,
  assets: ReleaseAsset[],
) {
  const names = [
    `Overseer_${version}_aarch64.dmg`,
    `Overseer_${version}_aarch64.app.tar.gz`,
    `Overseer_${version}_aarch64.app.tar.gz.sig`,
    "latest.json",
  ];
  const checksums = names.map((name) => {
    const sha256 = createHash("sha256")
      .update(readFileSync(join(directory, name)))
      .digest("hex");
    if (assets.find((asset) => asset.name === name)?.digest !== `sha256:${sha256}`)
      throw new Error(`원격 자산 체크섬이 다릅니다: ${name}`);
    return { name, sha256 };
  });
  const archive = names[1]!;
  verifyUpdateArchive(root, join(directory, archive));
  const signature = readFileSync(join(directory, `${archive}.sig`), "utf8").trim();
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  verifyUpdaterSignature(
    config.plugins.updater.pubkey,
    signature,
    readFileSync(join(directory, archive)),
  );
  const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  const platform =
    manifest.platforms?.["darwin-aarch64-app"] ?? manifest.platforms?.["darwin-aarch64"];
  const asset = assets.find((asset) => asset.name === archive)!;
  const urls = [
    `https://github.com/opnay/overseer/releases/download/v${version}/${archive}`,
    `https://api.github.com/repos/opnay/overseer/releases/assets/${asset.id}`,
  ];
  if (
    manifest.version !== version ||
    platform?.signature?.trim() !== signature ||
    !urls.includes(platform?.url)
  )
    throw new Error("공식 액션의 업데이트 manifest가 릴리즈 자산과 다릅니다.");
  return checksums;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = mkdtempSync(join(tmpdir(), "overseer-release-download-"));
  try {
    const root = process.cwd();
    const source = verifyReleaseSource(root);
    const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();
    const draft = JSON.parse(
      gh(
        "release",
        "view",
        source.tag,
        "--repo",
        "opnay/overseer",
        "--json",
        "databaseId,isDraft,tagName",
      ),
    );
    if (!draft.isDraft || draft.tagName !== source.tag)
      throw new Error("게시할 draft 릴리즈가 아닙니다.");
    const release = JSON.parse(gh("api", `repos/opnay/overseer/releases/${draft.databaseId}`));
    if (release.draft !== true || release.target_commitish !== source.commit)
      throw new Error("draft의 빌드 커밋이 현재 커밋과 다릅니다.");
    const refs = execFileSync(
      "git",
      ["ls-remote", "origin", `refs/tags/${source.tag}`, `refs/tags/${source.tag}^{}`],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
    const remoteCommit = (refs.find((line) => line.endsWith("^{}")) ?? refs[0])?.split(/\s+/)[0];
    if (remoteCommit !== source.commit) throw new Error("원격 태그가 빌드 커밋과 다릅니다.");
    gh("release", "download", source.tag, "--repo", "opnay/overseer", "--dir", directory);
    const checksums = verifyCiReleaseAssets(root, directory, source.version, release.assets);
    const sums = join(directory, "SHA256SUMS.txt");
    writeFileSync(sums, checksums.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""));
    gh("release", "upload", source.tag, sums, "--repo", "opnay/overseer");
    const uploaded = JSON.parse(
      gh("api", `repos/opnay/overseer/releases/${draft.databaseId}/assets`),
    );
    const digest = createHash("sha256").update(readFileSync(sums)).digest("hex");
    if (
      uploaded.find((asset: ReleaseAsset) => asset.name === "SHA256SUMS.txt")?.digest !==
      `sha256:${digest}`
    )
      throw new Error("원격 체크섬 파일 검증 실패");
    gh("release", "edit", source.tag, "--repo", "opnay/overseer", "--draft=false", "--latest");
    console.log(`${source.tag} 릴리즈 검증·공개 완료`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CI 릴리즈 게시 검증 실패");
    process.exitCode = 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
