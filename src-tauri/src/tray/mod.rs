mod indicator;
mod menu;
mod model;

use crate::{sidecar::DesktopApiProcess, window::show_main_window};
use indicator::{set_tray_runtime_indicator, tray_runtime_indicator, TrayRuntimeIndicator};
use menu::{build_tray_menu, compose_action_path, tray_runtime_operation};
use model::tray_snapshot_from_json;
use std::{
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::tray::TrayIconBuilder;

const TRAY_MENU_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
pub(super) const TRAY_COMPOSE_ACTION_PREFIX: &str = "tray-compose-action:";
pub(super) const TRAY_OPEN_ID: &str = "tray-open";
pub(super) const TRAY_QUIT_ID: &str = "tray-quit";
pub(super) const TRAY_ROUTE_PREFIX: &str = "tray-route:";
pub(super) const TRAY_RUNTIME_RESTART_ID: &str = "tray-runtime-restart";
pub(super) const TRAY_RUNTIME_START_ID: &str = "tray-runtime-start";
pub(super) const TRAY_RUNTIME_STOP_ID: &str = "tray-runtime-stop";
pub(super) const TRAY_RUNTIME_STATUS_ID: &str = "tray-runtime-status";

fn request_operation(
    api: Arc<Mutex<DesktopApiProcess>>,
    path: String,
    failure_context: &'static str,
) {
    thread::spawn(move || {
        let result = api
            .lock()
            .map_err(|_| "API sidecar 잠금이 손상됐습니다.".to_owned())
            .and_then(|mut api| api.request(path, "POST".into(), None));
        match result {
            Ok((202, _)) => {}
            Ok((status, body)) => {
                eprintln!("{failure_context}을 요청하지 못했습니다: HTTP {status} {body}")
            }
            Err(error) => eprintln!("{failure_context}을 요청하지 못했습니다: {error}"),
        }
    });
}

pub(crate) fn setup_tray(
    app: &mut tauri::App,
    api: Arc<Mutex<DesktopApiProcess>>,
) -> tauri::Result<()> {
    let menu = build_tray_menu(app.handle(), None)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/icons/tray-icon.png"
    )))?;
    let event_api = Arc::clone(&api);

    let tray = TrayIconBuilder::with_id("overseer")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| {
            if event.id() == TRAY_OPEN_ID {
                if let Err(error) = show_main_window(app, None) {
                    eprintln!("launcher를 열지 못했습니다: {error}");
                }
            } else if let Some((path, context)) = tray_runtime_operation(event.id().as_ref()) {
                request_operation(Arc::clone(&event_api), path.into(), context);
            } else if event.id() == TRAY_QUIT_ID {
                app.exit(0);
            } else if let Some(path) = compose_action_path(event.id().as_ref()) {
                request_operation(Arc::clone(&event_api), path, "Compose 작업");
            } else if let Some(path) = event.id().as_ref().strip_prefix(TRAY_ROUTE_PREFIX) {
                if let Err(error) = show_main_window(app, Some(path)) {
                    eprintln!("launcher 화면을 열지 못했습니다: {error}");
                }
            }
        })
        .tooltip("Overseer")
        .build(app)?;

    let app_handle = app.handle().clone();
    thread::spawn(move || {
        let mut current_runtime_indicator = TrayRuntimeIndicator::Hidden;
        loop {
            let snapshot = api
                .lock()
                .map_err(|_| "API sidecar 잠금이 손상됐습니다.".to_owned())
                .and_then(|mut api| api.request("/menu-bar".into(), "GET".into(), None))
                .and_then(|(status, body)| {
                    if status == 200 {
                        tray_snapshot_from_json(&body).map_err(|error| error.to_string())
                    } else {
                        Err(format!("메뉴바 상태를 불러오지 못했습니다: HTTP {status}"))
                    }
                });
            match snapshot {
                Ok(snapshot) => {
                    let next_runtime_indicator = tray_runtime_indicator(snapshot.runtime_state);
                    if next_runtime_indicator != current_runtime_indicator {
                        if let Err(error) =
                            set_tray_runtime_indicator(&tray, next_runtime_indicator)
                        {
                            eprintln!("메뉴바 아이콘을 갱신하지 못했습니다: {error}");
                        } else {
                            current_runtime_indicator = next_runtime_indicator;
                        }
                    }
                    match build_tray_menu(&app_handle, Some(&snapshot)) {
                        Ok(menu) => {
                            if tray.set_menu(Some(menu)).is_err() {
                                break;
                            }
                        }
                        Err(error) => eprintln!("메뉴바 목록을 만들지 못했습니다: {error}"),
                    }
                }
                Err(error) => {
                    eprintln!("메뉴바 목록을 갱신하지 못했습니다: {error}");
                    if let Ok(menu) = build_tray_menu(&app_handle, None) {
                        if tray.set_menu(Some(menu)).is_err() {
                            break;
                        }
                    }
                    if set_tray_runtime_indicator(&tray, TrayRuntimeIndicator::Hidden).is_ok() {
                        current_runtime_indicator = TrayRuntimeIndicator::Hidden;
                    }
                }
            }
            thread::sleep(TRAY_MENU_REFRESH_INTERVAL);
        }
    });
    Ok(())
}
