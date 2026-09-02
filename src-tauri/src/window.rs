use tauri::{
    menu::{Menu, MenuItem},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

pub(crate) const APP_WINDOW_HIDE_ID: &str = "app-window-hide";
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

pub(crate) fn show_main_window(app: &tauri::AppHandle, path: Option<&str>) -> Result<(), String> {
    let (window, navigate) = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => (window, true),
        None => (
            create_main_window(app, path)
                .map_err(|error| format!("main window를 만들지 못했습니다: {error}"))?,
            false,
        ),
    };
    if let Some(path) = path.filter(|path| navigate && valid_window_path(path)) {
        let path = serde_json::to_string(path).expect("launcher 경로는 JSON 문자열로 변환됩니다.");
        if let Err(error) = window.eval(format!(
            "window.history.pushState(null, '', {path}); window.dispatchEvent(new PopStateEvent('popstate'));"
        )) {
            eprintln!("launcher 화면을 이동하지 못했습니다: {error}");
        }
    }
    app.set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|error| format!("앱 활성화 정책을 변경하지 못했습니다: {error}"))?;
    app.set_dock_visibility(true)
        .map_err(|error| format!("Dock 아이콘을 표시하지 못했습니다: {error}"))?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("main window를 열지 못했습니다: {error}"))?;
    Ok(())
}

pub(crate) fn hide_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|error| format!("main window를 숨기지 못했습니다: {error}"))?;
    }
    app.set_dock_visibility(false)
        .map_err(|error| format!("Dock 아이콘을 숨기지 못했습니다: {error}"))?;
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)
        .map_err(|error| format!("백그라운드 앱으로 전환하지 못했습니다: {error}"))?;
    Ok(())
}

pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let app_menu = menu
        .items()?
        .into_iter()
        .next()
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| tauri::Error::AssetNotFound("macOS application menu".into()))?;
    let quit_position = app_menu
        .items()?
        .len()
        .checked_sub(1)
        .ok_or_else(|| tauri::Error::AssetNotFound("macOS quit menu item".into()))?;
    app_menu.remove_at(quit_position)?;
    let hide = MenuItem::with_id(
        app,
        APP_WINDOW_HIDE_ID,
        "Overseer 창 닫기",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    app_menu.insert(&hide, quit_position)?;
    Ok(menu)
}

pub(crate) fn valid_window_path(path: &str) -> bool {
    let identifier = path
        .strip_prefix("/compose/")
        .or_else(|| path.strip_prefix("/containers/"));
    identifier.is_some_and(|identifier| {
        !identifier.is_empty() && !identifier.contains('/') && !identifier.contains(['\n', '\r'])
    })
}

fn create_main_window(
    app: &tauri::AppHandle,
    path: Option<&str>,
) -> tauri::Result<tauri::WebviewWindow> {
    let mut window =
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()));
    if let Some(path) = path.filter(|path| valid_window_path(path)) {
        let path = serde_json::to_string(path).expect("launcher 경로는 JSON 문자열로 변환됩니다.");
        window =
            window.initialization_script(format!("window.history.replaceState(null, '', {path});"));
    }
    window
        .center()
        .inner_size(1_200.0, 800.0)
        .min_inner_size(760.0, 560.0)
        .resizable(true)
        .title("Overseer")
        .visible(false)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supported_detail_routes() {
        assert!(valid_window_path("/compose/my%20project"));
        assert!(valid_window_path("/containers/abc123"));
        assert!(!valid_window_path("/settings"));
        assert!(!valid_window_path("/containers/abc/extra"));
    }
}
