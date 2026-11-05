use crate::window::{show_main_window, valid_window_path};
use std::{
    env, fs,
    io::{Read, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    thread,
};

const APP_SOCKET: &str = "app.sock";
pub(crate) const BACKGROUND_ARGUMENT: &str = "--background";
const LEGACY_PROCESS_SOCKETS: [&str; 3] = ["helper.sock", "launcher.sock", "menubar.sock"];
const MAX_PROCESS_MESSAGE_BYTES: u64 = 10 * 1024 * 1024;
const WINDOW_ROUTE_ARGUMENT: &str = "--route";

pub(crate) fn app_socket_path() -> Result<PathBuf, String> {
    process_socket_path(APP_SOCKET)
}

fn process_data_directory() -> Result<PathBuf, String> {
    if let Some(directory) = env::var_os("OVERSEER_DATA_DIR") {
        return Ok(PathBuf::from(directory));
    }
    let home = env::var_os("HOME").ok_or("사용자 홈 디렉터리를 확인하지 못했습니다.")?;
    Ok(PathBuf::from(home).join("Library/Application Support/Overseer"))
}

fn process_socket_path(name: &str) -> Result<PathBuf, String> {
    let directory = process_data_directory()?.join("processes");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("프로세스 디렉터리를 만들지 못했습니다: {error}"))?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("프로세스 디렉터리 권한을 설정하지 못했습니다: {error}"))?;
    Ok(directory.join(name))
}

pub(crate) fn send_process_command(path: &Path, command: &str) -> bool {
    UnixStream::connect(path)
        .and_then(|mut stream| stream.write_all(command.as_bytes()))
        .is_ok()
}

pub(crate) fn claim_process_socket(path: &Path) -> Result<Option<UnixListener>, String> {
    if send_process_command(path, "ping\n") {
        return Ok(None);
    }

    let listener = match UnixListener::bind(path) {
        Ok(listener) => listener,
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            if send_process_command(path, "ping\n") {
                return Ok(None);
            }
            fs::remove_file(path)
                .map_err(|error| format!("오래된 프로세스 소켓을 지우지 못했습니다: {error}"))?;
            match UnixListener::bind(path) {
                Ok(listener) => listener,
                Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                    if send_process_command(path, "ping\n") {
                        return Ok(None);
                    }
                    return Err(format!("프로세스 소켓을 선점하지 못했습니다: {error}"));
                }
                Err(error) => return Err(format!("프로세스 소켓을 만들지 못했습니다: {error}")),
            }
        }
        Err(error) => return Err(format!("프로세스 소켓을 만들지 못했습니다: {error}")),
    };
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("프로세스 소켓 권한을 설정하지 못했습니다: {error}"))?;
    Ok(Some(listener))
}

fn read_process_message(stream: &mut UnixStream) -> Result<String, String> {
    let mut message = String::new();
    stream
        .take(MAX_PROCESS_MESSAGE_BYTES + 1)
        .read_to_string(&mut message)
        .map_err(|error| format!("프로세스 요청을 읽지 못했습니다: {error}"))?;
    if message.len() as u64 > MAX_PROCESS_MESSAGE_BYTES {
        return Err("프로세스 요청이 너무 큽니다.".into());
    }
    Ok(message)
}

pub(crate) fn start_app_listener(listener: UnixListener, app: tauri::AppHandle) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Ok(command) = read_process_message(&mut stream) else {
                continue;
            };
            if command.trim() == "ping" {
                continue;
            }
            let Ok(command) = serde_json::from_str::<serde_json::Value>(&command) else {
                continue;
            };
            if command.get("action").and_then(serde_json::Value::as_str) == Some("show") {
                let path = command
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .filter(|path| valid_window_path(path));
                if let Err(error) = show_main_window(&app, path) {
                    eprintln!("main window를 열지 못했습니다: {error}");
                }
            }
        }
    });
}

fn show_window_command(path: Option<&str>) -> String {
    let command = serde_json::json!({
        "action": "show",
        "path": path.filter(|path| valid_window_path(path)),
    });
    format!("{command}\n")
}

pub(crate) fn window_route_argument() -> Option<String> {
    let mut arguments = env::args();
    while let Some(argument) = arguments.next() {
        if argument == WINDOW_ROUTE_ARGUMENT {
            return arguments.next().filter(|path| valid_window_path(path));
        }
    }
    None
}

pub(crate) fn is_background_start() -> bool {
    env::args().any(|argument| argument == BACKGROUND_ARGUMENT)
}

pub(crate) fn startup_command(background: bool, path: Option<&str>) -> String {
    if background {
        "ping\n".into()
    } else {
        show_window_command(path)
    }
}

pub(crate) fn keeps_background_running(exit_code: Option<i32>) -> bool {
    exit_code.is_none()
}

pub(crate) fn remove_stale_legacy_sockets() {
    for name in LEGACY_PROCESS_SOCKETS {
        let Ok(path) = process_socket_path(name) else {
            continue;
        };
        if !send_process_command(&path, "ping\n") {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_the_window_only_for_foreground_relaunches() {
        assert_eq!(startup_command(true, None), "ping\n");
        assert_eq!(startup_command(true, Some("/containers/abc123")), "ping\n");
        assert_eq!(
            startup_command(false, None),
            "{\"action\":\"show\",\"path\":null}\n"
        );
        assert_eq!(
            startup_command(false, Some("/containers/abc123")),
            "{\"action\":\"show\",\"path\":\"/containers/abc123\"}\n"
        );
        assert_eq!(
            startup_command(false, Some("/settings")),
            "{\"action\":\"show\",\"path\":null}\n"
        );
        assert!(keeps_background_running(None));
        assert!(!keeps_background_running(Some(0)));
    }
}
