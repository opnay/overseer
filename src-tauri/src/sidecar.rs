use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
};

pub(crate) struct DesktopApiProcess {
    child: Child,
    input: ChildStdin,
    next_id: u64,
    output: BufReader<ChildStdout>,
}

impl DesktopApiProcess {
    pub(crate) fn start() -> Result<Self, String> {
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

    pub(crate) fn request(
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

fn outer_app_bundle_path() -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("애플리케이션 경로를 확인하지 못했습니다: {error}"))?;
    executable
        .ancestors()
        .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
        .last()
        .map(PathBuf::from)
        .ok_or("Overseer.app 경로를 찾지 못했습니다.".into())
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
    let current = env::current_exe()
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
    std::fs::canonicalize(development)
        .map_err(|error| format!("API sidecar를 찾지 못했습니다: {error}"))
}

#[tauri::command]
pub(crate) async fn api_request(
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
