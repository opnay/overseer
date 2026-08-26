use auto_launch::AutoLaunch;
use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    net::Shutdown,
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

const HELPER_ARGUMENT: &str = "--helper";
const HELPER_EXECUTABLE_NAME: &str = "overseer-helper";
const HELPER_SOCKET: &str = "helper.sock";
const LAUNCHER_SOCKET: &str = "launcher.sock";
const MAIN_WINDOW_LABEL: &str = "main";
const MAX_PROCESS_MESSAGE_BYTES: u64 = 10 * 1024 * 1024;
const TRAY_OPEN_ID: &str = "tray-open";
const TRAY_QUIT_ID: &str = "tray-quit";

struct DesktopApiProcess {
    child: Child,
    input: ChildStdin,
    next_id: u64,
    output: BufReader<ChildStdout>,
}

impl DesktopApiProcess {
    fn start() -> Result<Self, String> {
        let path = sidecar_path()?;
        let mut child = Command::new(&path)
            .env("PATH", sidecar_command_path()?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("API sidecar를 실행하지 못했습니다: {error}"))?;
        let input = child
            .stdin
            .take()
            .ok_or("API sidecar 입력을 열지 못했습니다.")?;
        let output = child
            .stdout
            .take()
            .ok_or("API sidecar 출력을 열지 못했습니다.")?;
        let mut process = Self {
            child,
            input,
            next_id: 0,
            output: BufReader::new(output),
        };

        let mut ready = String::new();
        process
            .output
            .read_line(&mut ready)
            .map_err(|error| format!("API sidecar 상태를 읽지 못했습니다: {error}"))?;
        let value: serde_json::Value = serde_json::from_str(&ready)
            .map_err(|error| format!("API sidecar 시작 응답이 잘못됐습니다: {error}"))?;
        if value.get("ready").and_then(serde_json::Value::as_bool) != Some(true) {
            return Err("API sidecar가 준비되지 않았습니다.".into());
        }
        Ok(process)
    }

    fn request(
        &mut self,
        path: String,
        method: String,
        body: Option<String>,
    ) -> Result<(u16, String), String> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|error| format!("API sidecar 상태를 확인하지 못했습니다: {error}"))?
        {
            return Err(format!("API sidecar가 종료됐습니다: {status}"));
        }

        self.next_id += 1;
        let id = self.next_id;
        let request = serde_json::json!({
            "body": body,
            "id": id,
            "method": method,
            "path": path,
        });
        serde_json::to_writer(&mut self.input, &request)
            .map_err(|error| format!("API 요청을 만들지 못했습니다: {error}"))?;
        self.input
            .write_all(b"\n")
            .and_then(|_| self.input.flush())
            .map_err(|error| format!("API 요청을 보내지 못했습니다: {error}"))?;

        let mut line = String::new();
        self.output
            .read_line(&mut line)
            .map_err(|error| format!("API 응답을 읽지 못했습니다: {error}"))?;
        if line.is_empty() {
            return Err("API sidecar가 응답 전에 종료됐습니다.".into());
        }
        let response: serde_json::Value = serde_json::from_str(&line)
            .map_err(|error| format!("API 응답이 잘못됐습니다: {error}"))?;
        if response.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
            return Err("API 응답 순서가 잘못됐습니다.".into());
        }
        let status = response
            .get("status")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .ok_or("API 응답 상태가 잘못됐습니다.")?;
        let body = response
            .get("body")
            .and_then(serde_json::Value::as_str)
            .ok_or("API 응답 본문이 잘못됐습니다.")?
            .to_owned();
        Ok((status, body))
    }
}

impl Drop for DesktopApiProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("main window를 찾지 못했습니다.");
        return;
    };
    if let Err(error) = window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
    {
        eprintln!("main window를 열지 못했습니다: {error}");
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, TRAY_OPEN_ID, "Overseer 열기", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Overseer 종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id("overseer")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_OPEN_ID {
                if let Err(error) = open_launcher() {
                    eprintln!("launcher를 열지 못했습니다: {error}");
                }
            } else if event.id() == TRAY_QUIT_ID {
                app.exit(0);
            }
        })
        .tooltip("Overseer")
        .build(app)?;
    Ok(())
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

fn send_process_command(path: &Path, command: &str) -> bool {
    UnixStream::connect(path)
        .and_then(|mut stream| stream.write_all(command.as_bytes()))
        .is_ok()
}

fn ping_helper(path: &Path) -> bool {
    let Ok(mut stream) = UnixStream::connect(path) else {
        return false;
    };
    let timeout = Some(Duration::from_secs(1));
    if stream.set_read_timeout(timeout).is_err()
        || stream.set_write_timeout(timeout).is_err()
        || stream.write_all(b"ping\n").is_err()
        || stream.shutdown(Shutdown::Write).is_err()
    {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && response.trim() == "pong"
}

fn claim_process_socket(path: &Path) -> Result<Option<UnixListener>, String> {
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

fn write_process_message(stream: &mut UnixStream, value: &serde_json::Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stream, value)
        .map_err(|error| format!("프로세스 응답을 만들지 못했습니다: {error}"))?;
    stream
        .write_all(b"\n")
        .and_then(|_| stream.flush())
        .map_err(|error| format!("프로세스 응답을 보내지 못했습니다: {error}"))
}

fn handle_helper_connection(
    mut stream: UnixStream,
    api: &Arc<Mutex<DesktopApiProcess>>,
) -> Result<(), String> {
    let message = read_process_message(&mut stream)?;
    if message.trim() == "ping" {
        stream
            .write_all(b"pong\n")
            .and_then(|_| stream.flush())
            .map_err(|error| format!("helper 상태를 보내지 못했습니다: {error}"))?;
        return Ok(());
    }

    let request = serde_json::from_str::<serde_json::Value>(&message)
        .map_err(|error| format!("helper API 요청이 잘못됐습니다: {error}"))?;
    let path = request
        .get("path")
        .and_then(serde_json::Value::as_str)
        .ok_or("helper API 경로가 없습니다.")?
        .to_owned();
    let method = request
        .get("method")
        .and_then(serde_json::Value::as_str)
        .ok_or("helper API 요청 방식이 없습니다.")?
        .to_owned();
    let body = match request.get("body") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(
            value
                .as_str()
                .ok_or("helper API 요청 본문이 잘못됐습니다.")?
                .to_owned(),
        ),
    };
    let result = api
        .lock()
        .map_err(|_| "API sidecar 잠금이 손상됐습니다.".to_owned())?
        .request(path, method, body);
    let response = match result {
        Ok((status, body)) => serde_json::json!({ "body": body, "status": status }),
        Err(error) => serde_json::json!({ "error": error }),
    };
    write_process_message(&mut stream, &response)
}

fn start_helper_listener(listener: UnixListener, api: Arc<Mutex<DesktopApiProcess>>) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let api = Arc::clone(&api);
            thread::spawn(move || {
                if let Err(error) = handle_helper_connection(stream, &api) {
                    eprintln!("helper 요청을 처리하지 못했습니다: {error}");
                }
            });
        }
    });
}

fn request_helper_api(
    path: String,
    method: String,
    body: Option<String>,
) -> Result<(u16, String), String> {
    let socket = process_socket_path(HELPER_SOCKET)?;
    let mut stream = match UnixStream::connect(&socket) {
        Ok(stream) => stream,
        Err(_) => {
            ensure_helper_process()?;
            UnixStream::connect(socket)
                .map_err(|error| format!("helper API에 연결하지 못했습니다: {error}"))?
        }
    };
    let timeout = Some(Duration::from_secs(120));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|error| format!("helper API 제한 시간을 설정하지 못했습니다: {error}"))?;
    let request = serde_json::json!({ "body": body, "method": method, "path": path });
    serde_json::to_writer(&mut stream, &request)
        .map_err(|error| format!("helper API 요청을 만들지 못했습니다: {error}"))?;
    stream
        .write_all(b"\n")
        .and_then(|_| stream.flush())
        .and_then(|_| stream.shutdown(Shutdown::Write))
        .map_err(|error| format!("helper API 요청을 보내지 못했습니다: {error}"))?;
    let response = read_process_message(&mut stream)?;
    let value = serde_json::from_str::<serde_json::Value>(&response)
        .map_err(|error| format!("helper API 응답이 잘못됐습니다: {error}"))?;
    if let Some(error) = value.get("error").and_then(serde_json::Value::as_str) {
        return Err(error.to_owned());
    }
    let status = value
        .get("status")
        .and_then(serde_json::Value::as_u64)
        .and_then(|status| u16::try_from(status).ok())
        .ok_or("helper API 응답 상태가 잘못됐습니다.")?;
    let body = value
        .get("body")
        .and_then(serde_json::Value::as_str)
        .ok_or("helper API 응답 본문이 잘못됐습니다.")?
        .to_owned();
    Ok((status, body))
}

fn start_launcher_listener(listener: UnixListener, app: tauri::AppHandle) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut command = [0; 16];
            let Ok(length) = stream.read(&mut command) else {
                continue;
            };
            if command[..length].starts_with(b"show") {
                show_main_window(&app);
            }
        }
    });
}

fn spawn_current_process(arguments: &[&str]) -> Result<(), String> {
    let executable = env::current_exe()
        .map_err(|error| format!("애플리케이션 경로를 확인하지 못했습니다: {error}"))?;
    Command::new(executable)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Overseer 프로세스를 실행하지 못했습니다: {error}"))?;
    Ok(())
}

fn spawn_launcher_process() -> Result<(), String> {
    let bundle = outer_app_bundle_path()?;
    Command::new("open")
        .arg("-n")
        .arg(&bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Overseer launcher를 실행하지 못했습니다: {error}"))?;
    Ok(())
}

fn outer_app_bundle_path() -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("애플리케이션 경로를 확인하지 못했습니다: {error}"))?;
    executable
        .ancestors()
        .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
        .last()
        .map(Path::to_path_buf)
        .ok_or("Overseer.app 경로를 찾지 못했습니다.".into())
}

fn helper_bundle_path() -> Result<PathBuf, String> {
    Ok(outer_app_bundle_path()?.join("Contents/Library/LoginItems/OverseerHelper.app"))
}

fn helper_executable_path() -> Result<PathBuf, String> {
    Ok(helper_bundle_path()?.join("Contents/MacOS/overseer-helper"))
}

fn spawn_helper_process() -> Result<(), String> {
    let helper = helper_bundle_path()?;
    if !helper.is_dir() {
        return spawn_current_process(&[HELPER_ARGUMENT]);
    }
    Command::new("open")
        .arg("-g")
        .arg(helper)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("OverseerHelper를 실행하지 못했습니다: {error}"))?;
    Ok(())
}

fn ensure_helper_process() -> Result<(), String> {
    let path = process_socket_path(HELPER_SOCKET)?;
    if ping_helper(&path) {
        return Ok(());
    }
    spawn_helper_process()?;
    for _ in 0..100 {
        thread::sleep(Duration::from_millis(100));
        if ping_helper(&path) {
            return Ok(());
        }
    }
    Err("helper API가 준비되지 않았습니다.".into())
}

fn configure_helper_autostart() -> Result<(), String> {
    let executable = helper_executable_path()?;
    let executable = executable
        .to_str()
        .ok_or("OverseerHelper 실행 경로를 해석하지 못했습니다.")?;
    let arguments: [&str; 0] = [];
    let autostart = AutoLaunch::new("OverseerHelper", executable, true, &arguments);
    autostart.enable().map_err(|error| {
        format!("OverseerHelper 로그인 자동 시작을 등록하지 못했습니다: {error}")
    })?;
    if !autostart.is_enabled().map_err(|error| {
        format!("OverseerHelper 로그인 자동 시작을 확인하지 못했습니다: {error}")
    })? {
        return Err("OverseerHelper 로그인 자동 시작을 등록하지 못했습니다.".into());
    }
    if let Some(legacy) = env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/LaunchAgents/Overseer.plist"))
    {
        let _ = fs::remove_file(legacy);
    }
    Ok(())
}

fn open_launcher() -> Result<(), String> {
    let path = process_socket_path(LAUNCHER_SOCKET)?;
    if send_process_command(&path, "show\n") {
        return Ok(());
    }
    spawn_launcher_process()
}

fn create_main_window(app: &mut tauri::App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .center()
        .inner_size(1_200.0, 800.0)
        .min_inner_size(760.0, 560.0)
        .resizable(true)
        .title("Overseer")
        .build()?;
    Ok(())
}

fn sidecar_command_path() -> Result<std::ffi::OsString, String> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(current) = env::var_os("PATH") {
        paths.extend(env::split_paths(&current));
    }
    env::join_paths(paths).map_err(|error| format!("명령 경로를 구성하지 못했습니다: {error}"))
}

fn sidecar_path() -> Result<PathBuf, String> {
    let current = std::env::current_exe()
        .map_err(|error| format!("애플리케이션 경로를 확인하지 못했습니다: {error}"))?;
    let packaged = current.with_file_name("overseer-server");
    if packaged.is_file() {
        return Ok(packaged);
    }
    if let Ok(bundle) = outer_app_bundle_path() {
        let packaged = bundle.join("Contents/MacOS/overseer-server");
        if packaged.is_file() {
            return Ok(packaged);
        }
    }

    let target = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64-apple-darwin"
    } else {
        return Err("지원하지 않는 macOS 아키텍처입니다.".into());
    };
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("overseer-server-{target}"));
    fs::canonicalize(development).map_err(|error| format!("API sidecar를 찾지 못했습니다: {error}"))
}

#[tauri::command]
async fn api_request(
    path: String,
    method: String,
    body: Option<String>,
) -> Result<(u16, String), String> {
    tauri::async_runtime::spawn_blocking(move || request_helper_api(path, method, body))
        .await
        .map_err(|error| format!("API 요청 작업이 중단됐습니다: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let helper = env::args().any(|argument| argument == HELPER_ARGUMENT)
        || env::current_exe()
            .ok()
            .and_then(|path| path.file_name().map(|name| name == HELPER_EXECUTABLE_NAME))
            .unwrap_or(false);
    let result = if helper {
        run_helper(context)
    } else {
        run_launcher(context)
    };
    if let Err(error) = result {
        panic!("Overseer를 실행하지 못했습니다: {error}");
    }
}

fn run_helper(context: tauri::Context<tauri::Wry>) -> Result<(), String> {
    let socket_path = process_socket_path(HELPER_SOCKET)?;
    let Some(listener) = claim_process_socket(&socket_path)? else {
        return Ok(());
    };
    let api = Arc::new(Mutex::new(DesktopApiProcess::start()?));
    let cleanup_path = socket_path.clone();
    let app = tauri::Builder::default()
        .setup(move |app| {
            setup_tray(app)?;
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            app.handle().set_dock_visibility(false)?;
            start_helper_listener(listener, api);
            Ok(())
        })
        .build(context)
        .map_err(|error| format!("OverseerHelper를 만들지 못했습니다: {error}"))?;

    app.run(move |_app, event| match event {
        tauri::RunEvent::Reopen { .. } => {
            if let Err(error) = open_launcher() {
                eprintln!("launcher를 열지 못했습니다: {error}");
            }
        }
        tauri::RunEvent::Exit => {
            let _ = fs::remove_file(&cleanup_path);
        }
        _ => {}
    });
    Ok(())
}

fn run_launcher(context: tauri::Context<tauri::Wry>) -> Result<(), String> {
    let socket_path = process_socket_path(LAUNCHER_SOCKET)?;
    if send_process_command(&socket_path, "show\n") {
        return Ok(());
    }
    let Some(listener) = claim_process_socket(&socket_path)? else {
        let _ = send_process_command(&socket_path, "show\n");
        return Ok(());
    };
    ensure_helper_process()?;

    let cleanup_path = socket_path.clone();
    let app = tauri::Builder::default()
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            configure_helper_autostart()?;
            create_main_window(app)?;
            show_main_window(app.handle());
            start_launcher_listener(listener, app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![api_request])
        .build(context)
        .map_err(|error| format!("launcher 앱을 만들지 못했습니다: {error}"))?;

    app.run(move |_app, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = fs::remove_file(&cleanup_path);
        }
    });
    Ok(())
}
