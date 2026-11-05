import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface AppUpdateCheck {
  currentVersion: string;
  version: string | null;
  notes: string | null;
}

export type AppUpdateProgress =
  | { state: "downloading"; downloaded: number; total: number | null }
  | { state: "installing" }
  | { state: "restarting" };

export const supportsAppUpdates = isTauri;
export const readAppVersion = getVersion;

export function checkAppUpdate(): Promise<AppUpdateCheck> {
  return invoke("check_app_update");
}

export function installAppUpdate(onProgress: (progress: AppUpdateProgress) => void): Promise<void> {
  const channel = new Channel<AppUpdateProgress>();
  channel.onmessage = onProgress;
  return invoke("install_app_update", { onProgress: channel });
}
