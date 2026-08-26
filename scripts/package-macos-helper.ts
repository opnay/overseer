import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const app = resolve("src-tauri/target/release/bundle/macos/Overseer.app");
const helper = resolve(app, "Contents/Library/LoginItems/OverseerHelper.app");
const helperContents = resolve(helper, "Contents");
const helperExecutable = resolve(helperContents, "MacOS/overseer-helper");

await rm(helper, { force: true, recursive: true });
await mkdir(resolve(helperContents, "MacOS"), { recursive: true });
await mkdir(resolve(helperContents, "Resources"), { recursive: true });
await copyFile(resolve(app, "Contents/MacOS/overseer-desktop"), helperExecutable);
await chmod(helperExecutable, 0o755);
await copyFile(resolve("src-tauri/helper/Info.plist"), resolve(helperContents, "Info.plist"));
await copyFile(
  resolve(app, "Contents/Resources/icon.icns"),
  resolve(helperContents, "Resources/icon.icns"),
);
