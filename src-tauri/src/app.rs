use crate::{
    autostart::configure_app_autostart,
    sidecar::{self, DesktopApiProcess},
    single_instance::{
        app_socket_path, claim_process_socket, is_background_start, keeps_background_running,
        remove_stale_legacy_sockets, send_process_command, start_app_listener, startup_command,
        window_route_argument,
    },
    tray::setup_tray,
    updates::{self, AppUpdates},
    window::{
        build_app_menu, hide_main_window, show_main_window, APP_WINDOW_HIDE_ID, MAIN_WINDOW_LABEL,
    },
};
use std::{
    fs,
    sync::{Arc, Mutex},
};
use tauri::Manager;

pub(crate) fn run() {
    let context = tauri::generate_context!();
    if let Err(error) = run_app(context) {
        panic!("Overseer를 실행하지 못했습니다: {error}");
    }
}

fn run_app(context: tauri::Context<tauri::Wry>) -> Result<(), String> {
    let socket_path = app_socket_path()?;
    let route = window_route_argument();
    let background = is_background_start();
    let command = startup_command(background, route.as_deref());
    if send_process_command(&socket_path, &command) {
        return Ok(());
    }
    let Some(listener) = claim_process_socket(&socket_path)? else {
        let _ = send_process_command(&socket_path, &command);
        return Ok(());
    };

    let api = Arc::new(Mutex::new(DesktopApiProcess::start()?));
    let tray_api = Arc::clone(&api);
    let shutdown_api = Arc::clone(&api);
    let cleanup_path = socket_path.clone();
    let app = tauri::Builder::default()
        .manage(api)
        .manage(AppUpdates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == APP_WINDOW_HIDE_ID {
                if let Err(error) = hide_main_window(app) {
                    eprintln!("launcher를 숨기지 못했습니다: {error}");
                }
            }
        })
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            app.set_dock_visibility(false);
            #[cfg(target_os = "macos")]
            if let Err(error) = crate::window::install_navigation_monitor(app.handle()) {
                eprintln!("{error}");
            }
            setup_tray(app, tray_api)?;
            if let Err(error) = configure_app_autostart() {
                eprintln!("로그인 자동 시작을 설정하지 못했습니다: {error}");
            }
            remove_stale_legacy_sockets();
            start_app_listener(listener, app.handle().clone());
            if !background {
                show_main_window(app.handle(), route.as_deref())?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = hide_main_window(window.app_handle()) {
                        eprintln!("launcher를 숨기지 못했습니다: {error}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::api_request,
            updates::check_app_update,
            updates::install_app_update
        ])
        .build(context)
        .map_err(|error| format!("Overseer 앱을 만들지 못했습니다: {error}"))?;

    app.run(move |app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. }
            if app
                .state::<AppUpdates>()
                .installing
                .load(std::sync::atomic::Ordering::Acquire)
                && !app
                    .state::<AppUpdates>()
                    .relaunch
                    .load(std::sync::atomic::Ordering::Acquire) =>
        {
            api.prevent_exit();
        }
        tauri::RunEvent::ExitRequested { code, api, .. } if keeps_background_running(code) => {
            api.prevent_exit();
            if let Err(error) = hide_main_window(app) {
                eprintln!("launcher를 숨기지 못했습니다: {error}");
            }
        }
        tauri::RunEvent::Reopen { .. } => {
            if let Err(error) = show_main_window(app, None) {
                eprintln!("launcher를 열지 못했습니다: {error}");
            }
        }
        tauri::RunEvent::Exit => {
            #[cfg(target_os = "macos")]
            crate::window::remove_navigation_monitor();
            if let Ok(mut api) = shutdown_api.lock() {
                api.stop();
            }
            let _ = fs::remove_file(&cleanup_path);
            if let Err(error) = updates::relaunch_after_exit(app) {
                eprintln!("{error}");
            }
        }
        _ => {}
    });
    Ok(())
}
