use auto_launch::AutoLaunch;
use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Write},
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
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

const APP_SOCKET: &str = "app.sock";
const APP_WINDOW_HIDE_ID: &str = "app-window-hide";
const BACKGROUND_ARGUMENT: &str = "--background";
const LEGACY_AUTOSTART_NAME: &str = "OverseerHelper";
const LEGACY_PROCESS_SOCKETS: [&str; 3] = ["helper.sock", "launcher.sock", "menubar.sock"];
const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_ROUTE_ARGUMENT: &str = "--route";
const MAX_PROCESS_MESSAGE_BYTES: u64 = 10 * 1024 * 1024;
const TRAY_MENU_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
const TRAY_COMPOSE_ACTION_PREFIX: &str = "tray-compose-action:";
const TRAY_OPEN_ID: &str = "tray-open";
const TRAY_ROUTE_PREFIX: &str = "tray-route:";
const TRAY_RUNTIME_RESTART_ID: &str = "tray-runtime-restart";
const TRAY_RUNTIME_START_ID: &str = "tray-runtime-start";
const TRAY_RUNTIME_STATUS_ID: &str = "tray-runtime-status";
const TRAY_QUIT_ID: &str = "tray-quit";

#[derive(Clone, Copy, Debug, PartialEq)]
enum TrayRuntimeState {
    Error,
    Missing,
    Running,
    Starting,
    Stopped,
    Stopping,
}

#[derive(Debug, PartialEq)]
struct TrayRuntimeAction {
    enabled: bool,
    id: &'static str,
    label: &'static str,
}

#[derive(Debug, PartialEq)]
struct TrayComposeProject {
    containers: Vec<TrayContainer>,
    name: String,
    state: TrayComposeState,
}

#[derive(Debug, PartialEq)]
enum TrayComposeState {
    Running,
    Stopped,
    Unknown,
}

#[derive(Debug, PartialEq)]
struct TrayContainer {
    id: String,
    name: String,
}

#[derive(Debug, PartialEq)]
struct TraySnapshot {
    projects: Vec<TrayComposeProject>,
    runtime_state: TrayRuntimeState,
}

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

fn show_main_window(app: &tauri::AppHandle, path: Option<&str>) -> Result<(), String> {
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

fn hide_main_window(app: &tauri::AppHandle) -> Result<(), String> {
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

fn tray_snapshot_from_json(body: &str) -> Result<TraySnapshot, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("메뉴바 상태 응답이 잘못됐습니다: {error}"))?;
    let phase = value
        .pointer("/runtime/phase")
        .and_then(serde_json::Value::as_str)
        .ok_or("메뉴바 런타임 상태가 없습니다.")?;
    let project_values = value
        .get("composeProjects")
        .and_then(serde_json::Value::as_array)
        .ok_or("메뉴바 Compose 목록이 없습니다.")?;
    let container_values = value
        .get("containers")
        .and_then(serde_json::Value::as_array)
        .ok_or("메뉴바 컨테이너 목록이 없습니다.")?;

    let mut projects = Vec::with_capacity(project_values.len());
    for project in project_values {
        let Some(name) = project.get("name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let state = project
            .get("status")
            .and_then(serde_json::Value::as_str)
            .map(compose_state)
            .unwrap_or(TrayComposeState::Unknown);
        let containers = container_values
            .iter()
            .filter(|container| {
                container
                    .get("composeProject")
                    .and_then(serde_json::Value::as_str)
                    == Some(name)
            })
            .filter_map(|container| {
                Some(TrayContainer {
                    id: container.get("id")?.as_str()?.to_owned(),
                    name: container.get("name")?.as_str()?.to_owned(),
                })
            })
            .collect();
        projects.push(TrayComposeProject {
            containers,
            name: name.to_owned(),
            state,
        });
    }

    Ok(TraySnapshot {
        projects,
        runtime_state: tray_runtime_state(phase)?,
    })
}

fn tray_runtime_state(phase: &str) -> Result<TrayRuntimeState, String> {
    match phase {
        "error" => Ok(TrayRuntimeState::Error),
        "missing" => Ok(TrayRuntimeState::Missing),
        "running" => Ok(TrayRuntimeState::Running),
        "starting" => Ok(TrayRuntimeState::Starting),
        "stopped" => Ok(TrayRuntimeState::Stopped),
        "stopping" => Ok(TrayRuntimeState::Stopping),
        _ => Err(format!("알 수 없는 메뉴바 런타임 상태입니다: {phase}")),
    }
}

fn auto_start_runtime_path(state: TrayRuntimeState) -> Option<&'static str> {
    matches!(state, TrayRuntimeState::Stopped).then_some("/runtime/start")
}

fn tray_runtime_action(state: Option<TrayRuntimeState>) -> TrayRuntimeAction {
    match state {
        Some(TrayRuntimeState::Running) => TrayRuntimeAction {
            enabled: true,
            id: TRAY_RUNTIME_RESTART_ID,
            label: "VM 재시작",
        },
        Some(TrayRuntimeState::Stopped) => TrayRuntimeAction {
            enabled: true,
            id: TRAY_RUNTIME_START_ID,
            label: "VM 시작",
        },
        Some(TrayRuntimeState::Starting) => TrayRuntimeAction {
            enabled: false,
            id: TRAY_RUNTIME_STATUS_ID,
            label: "VM 시작 중",
        },
        Some(TrayRuntimeState::Stopping) => TrayRuntimeAction {
            enabled: false,
            id: TRAY_RUNTIME_STATUS_ID,
            label: "VM 중지 중",
        },
        Some(TrayRuntimeState::Missing) => TrayRuntimeAction {
            enabled: false,
            id: TRAY_RUNTIME_STATUS_ID,
            label: "VM 없음",
        },
        Some(TrayRuntimeState::Error) => TrayRuntimeAction {
            enabled: false,
            id: TRAY_RUNTIME_STATUS_ID,
            label: "VM 상태 확인 필요",
        },
        None => TrayRuntimeAction {
            enabled: false,
            id: TRAY_RUNTIME_STATUS_ID,
            label: "VM 상태 확인 중",
        },
    }
}

fn tray_runtime_operation(menu_id: &str) -> Option<(&'static str, &'static str)> {
    match menu_id {
        TRAY_RUNTIME_RESTART_ID => Some(("/runtime/restart", "VM 재시작")),
        TRAY_RUNTIME_START_ID => Some(("/runtime/start", "VM 시작")),
        _ => None,
    }
}

fn compose_state(status: &str) -> TrayComposeState {
    let status = status.to_ascii_lowercase();
    if status.starts_with("running(") {
        TrayComposeState::Running
    } else if status.starts_with("created(")
        || status.starts_with("exited(")
        || status == "registered"
    {
        TrayComposeState::Stopped
    } else {
        TrayComposeState::Unknown
    }
}

fn compose_actions(state: &TrayComposeState) -> &'static [(&'static str, &'static str)] {
    match state {
        TrayComposeState::Running => &[("stop", "중지"), ("restart", "재시작")],
        TrayComposeState::Stopped => &[("up", "시작")],
        TrayComposeState::Unknown => &[],
    }
}

fn detail_path(resource: &str, identifier: &str) -> String {
    let mut url =
        tauri::Url::parse("http://localhost").expect("고정된 launcher 기본 URL은 유효합니다.");
    url.path_segments_mut()
        .expect("고정된 launcher 기본 URL은 경로를 지원합니다.")
        .push(resource)
        .push(identifier);
    url.path().to_owned()
}

fn route_menu_id(path: &str) -> String {
    format!("{TRAY_ROUTE_PREFIX}{path}")
}

fn compose_action_menu_id(action: &str, name: &str) -> String {
    let encoded_name = detail_path("compose", name)
        .strip_prefix("/compose/")
        .expect("Compose 상세 경로에는 인코딩된 이름이 포함됩니다.")
        .to_owned();
    format!("{TRAY_COMPOSE_ACTION_PREFIX}{action}:{encoded_name}")
}

fn compose_action_path(menu_id: &str) -> Option<String> {
    let (action, encoded_name) = menu_id
        .strip_prefix(TRAY_COMPOSE_ACTION_PREFIX)?
        .split_once(':')?;
    if !matches!(action, "restart" | "stop" | "up")
        || encoded_name.is_empty()
        || encoded_name.contains('/')
    {
        return None;
    }
    Some(format!("/compose/projects/{encoded_name}/actions/{action}"))
}

fn build_tray_menu(
    app: &tauri::AppHandle,
    snapshot: Option<&TraySnapshot>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, TRAY_OPEN_ID, "Overseer 열기", true, None::<&str>)?;
    let runtime_action = tray_runtime_action(snapshot.map(|snapshot| snapshot.runtime_state));
    let runtime = MenuItem::with_id(
        app,
        runtime_action.id,
        runtime_action.label,
        runtime_action.enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Overseer 종료", true, None::<&str>)?;
    let menu = Menu::new(app)?;
    menu.append(&open)?;
    menu.append(&runtime)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if let Some(snapshot) = snapshot.filter(|snapshot| !snapshot.projects.is_empty()) {
        for project in &snapshot.projects {
            let submenu = Submenu::new(app, &project.name, true)?;
            let path = detail_path("compose", &project.name);
            let project_open = MenuItem::with_id(
                app,
                route_menu_id(&path),
                format!("{} 열기", project.name),
                true,
                None::<&str>,
            )?;
            submenu.append(&project_open)?;
            for (action, label) in compose_actions(&project.state) {
                submenu.append(&MenuItem::with_id(
                    app,
                    compose_action_menu_id(action, &project.name),
                    label,
                    true,
                    None::<&str>,
                )?)?;
            }
            if compose_actions(&project.state).is_empty() {
                submenu.append(&MenuItem::new(app, "상태 확인 필요", false, None::<&str>)?)?;
            }
            if !project.containers.is_empty() {
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                for container in &project.containers {
                    let path = detail_path("containers", &container.id);
                    let item = MenuItem::with_id(
                        app,
                        route_menu_id(&path),
                        &container.name,
                        true,
                        None::<&str>,
                    )?;
                    submenu.append(&item)?;
                }
            }
            menu.append(&submenu)?;
        }
    } else {
        menu.append(&MenuItem::new(
            app,
            "Compose 프로젝트 없음",
            false,
            None::<&str>,
        )?)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

fn setup_tray(app: &mut tauri::App, api: Arc<Mutex<DesktopApiProcess>>) -> tauri::Result<()> {
    let menu = build_tray_menu(app.handle(), None)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
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
        let mut initial_runtime_checked = false;
        loop {
            let snapshot = api
                .lock()
                .map_err(|_| "API sidecar 잠금이 손상됐습니다.".to_owned())
                .and_then(|mut api| api.request("/menu-bar".into(), "GET".into(), None))
                .and_then(|(status, body)| {
                    if status == 200 {
                        tray_snapshot_from_json(&body)
                    } else {
                        Err(format!("메뉴바 상태를 불러오지 못했습니다: HTTP {status}"))
                    }
                });
            match snapshot {
                Ok(snapshot) => {
                    if !initial_runtime_checked {
                        initial_runtime_checked = true;
                        if let Some(path) = auto_start_runtime_path(snapshot.runtime_state) {
                            request_operation(Arc::clone(&api), path.into(), "VM 자동 시작");
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
                Err(error) => eprintln!("메뉴바 목록을 갱신하지 못했습니다: {error}"),
            }
            thread::sleep(TRAY_MENU_REFRESH_INTERVAL);
        }
    });
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

fn start_app_listener(listener: UnixListener, app: tauri::AppHandle) {
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

fn configure_app_autostart() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let executable = env::current_exe()
        .map_err(|error| format!("애플리케이션 경로를 확인하지 못했습니다: {error}"))?;
    let executable = executable
        .to_str()
        .ok_or("Overseer 실행 경로를 해석하지 못했습니다.")?;
    let autostart = AutoLaunch::new("Overseer", executable, true, &[BACKGROUND_ARGUMENT]);
    autostart
        .enable()
        .map_err(|error| format!("Overseer 로그인 자동 시작을 등록하지 못했습니다: {error}"))?;
    if !autostart
        .is_enabled()
        .map_err(|error| format!("Overseer 로그인 자동 시작을 확인하지 못했습니다: {error}"))?
    {
        return Err("Overseer 로그인 자동 시작을 등록하지 못했습니다.".into());
    }

    let legacy = AutoLaunch::new(LEGACY_AUTOSTART_NAME, executable, true, &[] as &[&str]);
    legacy
        .disable()
        .map_err(|error| format!("이전 OverseerHelper 자동 시작을 제거하지 못했습니다: {error}"))?;
    Ok(())
}

fn valid_window_path(path: &str) -> bool {
    let identifier = path
        .strip_prefix("/compose/")
        .or_else(|| path.strip_prefix("/containers/"));
    identifier.is_some_and(|identifier| {
        !identifier.is_empty() && !identifier.contains('/') && !identifier.contains(['\n', '\r'])
    })
}

fn show_window_command(path: Option<&str>) -> String {
    let command = serde_json::json!({
        "action": "show",
        "path": path.filter(|path| valid_window_path(path)),
    });
    format!("{command}\n")
}

fn window_route_argument() -> Option<String> {
    let mut arguments = env::args();
    while let Some(argument) = arguments.next() {
        if argument == WINDOW_ROUTE_ARGUMENT {
            return arguments.next().filter(|path| valid_window_path(path));
        }
    }
    None
}

fn is_background_start() -> bool {
    env::args().any(|argument| argument == BACKGROUND_ARGUMENT)
}

fn startup_command(background: bool, path: Option<&str>) -> String {
    if background {
        "ping\n".into()
    } else {
        show_window_command(path)
    }
}

fn keeps_background_running(exit_code: Option<i32>) -> bool {
    exit_code.is_none()
}

fn remove_stale_legacy_sockets() {
    for name in LEGACY_PROCESS_SOCKETS {
        let Ok(path) = process_socket_path(name) else {
            continue;
        };
        if !send_process_command(&path, "ping\n") {
            let _ = fs::remove_file(path);
        }
    }
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
    api: tauri::State<'_, Arc<Mutex<DesktopApiProcess>>>,
    path: String,
    method: String,
    body: Option<String>,
) -> Result<(u16, String), String> {
    let api = Arc::clone(api.inner());
    tauri::async_runtime::spawn_blocking(move || {
        api.lock()
            .map_err(|_| "API sidecar 잠금이 손상됐습니다.".to_owned())?
            .request(path, method, body)
    })
    .await
    .map_err(|error| format!("API 요청 작업이 중단됐습니다: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    if let Err(error) = run_app(context) {
        panic!("Overseer를 실행하지 못했습니다: {error}");
    }
}

fn run_app(context: tauri::Context<tauri::Wry>) -> Result<(), String> {
    let socket_path = process_socket_path(APP_SOCKET)?;
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
    let cleanup_path = socket_path.clone();
    let app = tauri::Builder::default()
        .manage(api)
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
            setup_tray(app, tray_api)?;
            configure_app_autostart()?;
            remove_stale_legacy_sockets();
            start_app_listener(listener, app.handle().clone());
            if route.is_some() && !background {
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
        .invoke_handler(tauri::generate_handler![api_request])
        .build(context)
        .map_err(|error| format!("Overseer 앱을 만들지 못했습니다: {error}"))?;

    app.run(move |app, event| match event {
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
            let _ = fs::remove_file(&cleanup_path);
        }
        _ => {}
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_menu_bar_projects_to_their_containers() {
        let snapshot = tray_snapshot_from_json(
            r#"{
                "runtime":{"phase":"running"},
                "composeProjects":[
                    {"name":"alpha","status":"running(2)"},
                    {"name":"beta","status":"registered"}
                ],
                "containers":[
                    {"composeProject":"alpha","id":"one","name":"web"},
                    {"composeProject":"alpha","id":"two","name":"worker"},
                    {"id":"standalone","name":"standalone"}
                ]
            }"#,
        )
        .expect("dashboard snapshot should parse");

        assert_eq!(
            snapshot,
            TraySnapshot {
                projects: vec![
                    TrayComposeProject {
                        containers: vec![
                            TrayContainer {
                                id: "one".into(),
                                name: "web".into(),
                            },
                            TrayContainer {
                                id: "two".into(),
                                name: "worker".into(),
                            },
                        ],
                        name: "alpha".into(),
                        state: TrayComposeState::Running,
                    },
                    TrayComposeProject {
                        containers: vec![],
                        name: "beta".into(),
                        state: TrayComposeState::Stopped,
                    },
                ],
                runtime_state: TrayRuntimeState::Running,
            }
        );
    }

    #[test]
    fn auto_starts_only_an_existing_stopped_runtime() {
        assert_eq!(
            auto_start_runtime_path(TrayRuntimeState::Stopped),
            Some("/runtime/start")
        );
        assert_eq!(auto_start_runtime_path(TrayRuntimeState::Running), None);
        assert_eq!(auto_start_runtime_path(TrayRuntimeState::Starting), None);
        assert_eq!(auto_start_runtime_path(TrayRuntimeState::Stopping), None);
        assert_eq!(auto_start_runtime_path(TrayRuntimeState::Missing), None);
        assert_eq!(auto_start_runtime_path(TrayRuntimeState::Error), None);
    }

    #[test]
    fn maps_runtime_states_to_menu_actions() {
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Stopped)),
            TrayRuntimeAction {
                enabled: true,
                id: TRAY_RUNTIME_START_ID,
                label: "VM 시작",
            }
        );
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Running)),
            TrayRuntimeAction {
                enabled: true,
                id: TRAY_RUNTIME_RESTART_ID,
                label: "VM 재시작",
            }
        );
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Starting)).label,
            "VM 시작 중"
        );
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Stopping)).label,
            "VM 중지 중"
        );
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Missing)).label,
            "VM 없음"
        );
        assert_eq!(
            tray_runtime_action(Some(TrayRuntimeState::Error)).label,
            "VM 상태 확인 필요"
        );
        assert_eq!(tray_runtime_action(None).label, "VM 상태 확인 중");
        assert_eq!(
            tray_runtime_operation(TRAY_RUNTIME_START_ID),
            Some(("/runtime/start", "VM 시작"))
        );
        assert_eq!(
            tray_runtime_operation(TRAY_RUNTIME_RESTART_ID),
            Some(("/runtime/restart", "VM 재시작"))
        );
        assert_eq!(tray_runtime_operation(TRAY_RUNTIME_STATUS_ID), None);
    }

    #[test]
    fn builds_encoded_detail_routes_and_rejects_unscoped_paths() {
        assert_eq!(
            detail_path("compose", "내 프로젝트/a"),
            "/compose/%EB%82%B4%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%2Fa"
        );
        assert!(valid_window_path("/compose/my%20project"));
        assert!(valid_window_path("/containers/abc123"));
        assert!(!valid_window_path("/settings"));
        assert!(!valid_window_path("/containers/abc/extra"));
        assert_eq!(
            compose_action_path(&compose_action_menu_id("restart", "내 프로젝트/a")),
            Some(
                "/compose/projects/%EB%82%B4%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%2Fa/actions/restart"
                    .into()
            )
        );
        assert_eq!(
            compose_action_path("tray-compose-action:down:project"),
            None
        );
        assert_eq!(
            compose_actions(&TrayComposeState::Running),
            &[("stop", "중지"), ("restart", "재시작")]
        );
        assert_eq!(
            compose_actions(&TrayComposeState::Stopped),
            &[("up", "시작")]
        );
        assert!(compose_actions(&TrayComposeState::Unknown).is_empty());
    }

    #[test]
    fn shows_the_window_only_for_foreground_relaunches() {
        assert_eq!(startup_command(true, None), "ping\n");
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
