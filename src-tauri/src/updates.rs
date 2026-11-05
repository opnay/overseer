use crate::sidecar::DesktopApiProcess;
use serde::Serialize;
use std::{
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct AppUpdates {
    busy: AtomicBool,
    pub(crate) installing: AtomicBool,
    pub(crate) relaunch: AtomicBool,
    pending: Mutex<Option<Update>>,
}

struct UpdateLease<'a>(&'a AtomicBool);

impl Drop for UpdateLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl AppUpdates {
    fn begin(&self) -> Result<UpdateLease<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "업데이트 작업이 이미 진행 중입니다.".to_owned())?;
        Ok(UpdateLease(&self.busy))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheck {
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub(crate) enum UpdateProgress {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
    Restarting,
}

#[tauri::command]
pub(crate) async fn check_app_update(
    app: tauri::AppHandle,
    updates: tauri::State<'_, AppUpdates>,
) -> Result<UpdateCheck, String> {
    let _lease = updates.begin()?;
    *updates
        .pending
        .lock()
        .map_err(|_| "업데이트 상태를 읽지 못했습니다.")? = None;
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("업데이트 확인을 준비하지 못했습니다: {error}"))?
        .check()
        .await
        .map_err(|error| {
            format!(
                "업데이트를 확인하지 못했습니다. 네트워크와 릴리즈 상태를 확인하십시오: {error}"
            )
        })?;
    let result = UpdateCheck {
        current_version: app.package_info().version.to_string(),
        version: update.as_ref().map(|value| value.version.clone()),
        notes: update.as_ref().and_then(|value| value.body.clone()),
    };
    *updates
        .pending
        .lock()
        .map_err(|_| "업데이트 상태를 저장하지 못했습니다.")? = update;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: tauri::AppHandle,
    updates: tauri::State<'_, AppUpdates>,
    api: tauri::State<'_, Arc<Mutex<DesktopApiProcess>>>,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    let _lease = updates.begin()?;
    let mut update = updates
        .pending
        .lock()
        .map_err(|_| "업데이트 상태를 읽지 못했습니다.")?
        .clone()
        .ok_or("먼저 업데이트 확인을 실행하십시오.")?;
    update.timeout = Some(Duration::from_secs(10 * 60));
    api.lock()
        .map_err(|_| "API sidecar 잠금이 손상됐습니다.")?
        .begin_update()?;
    updates.installing.store(true, Ordering::Release);
    let mut downloaded = 0;
    let result = update
        .download_and_install(
            |length, total| {
                downloaded += length as u64;
                let _ = on_progress.send(UpdateProgress::Downloading { downloaded, total });
            },
            || {
                let _ = on_progress.send(UpdateProgress::Installing);
            },
        )
        .await;
    if let Err(error) = result {
        if let Ok(mut api) = api.lock() {
            api.end_update();
        }
        updates.installing.store(false, Ordering::Release);
        return Err(format!("업데이트를 설치하지 못했습니다. 설치 위치의 쓰기 권한과 네트워크를 확인하고 다시 시도하십시오: {error}"));
    }
    updates.relaunch.store(true, Ordering::Release);
    let _ = on_progress.send(UpdateProgress::Restarting);
    app.exit(0);
    Ok(())
}

pub(crate) fn relaunch_after_exit(app: &tauri::AppHandle) -> Result<(), String> {
    if !app.state::<AppUpdates>().relaunch.load(Ordering::Acquire) {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundle = app_bundle(&executable).ok_or("재실행할 앱 번들을 찾지 못했습니다.")?;
    // LaunchServices starts a foreground instance outside the old LaunchAgent job.
    let status = Command::new("/usr/bin/open")
        .arg("-n")
        .arg(bundle)
        .status()
        .map_err(|error| format!("업데이트 후 앱을 다시 열지 못했습니다: {error}"))?;
    if !status.success() {
        return Err(
            "업데이트는 설치됐지만 앱을 다시 열지 못했습니다. Overseer를 직접 실행하십시오.".into(),
        );
    }
    Ok(())
}

fn app_bundle(executable: &std::path::Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|value| value == "app"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_update_work_and_releases_after_errors() {
        let state = AppUpdates::default();
        let lease = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(lease);
        assert!(state.begin().is_ok());
    }

    #[test]
    fn finds_the_installed_bundle_for_foreground_relaunch() {
        assert_eq!(
            app_bundle(std::path::Path::new(
                "/Applications/Overseer.app/Contents/MacOS/overseer-desktop"
            )),
            Some(PathBuf::from("/Applications/Overseer.app"))
        );
        assert_eq!(
            app_bundle(std::path::Path::new("/tmp/overseer-desktop")),
            None
        );
    }
}
