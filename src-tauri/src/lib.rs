mod app;
mod autostart;
mod sidecar;
mod single_instance;
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
