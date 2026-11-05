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
    updating: bool,
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
            updating: false,
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
        if self.updating && !method.eq_ignore_ascii_case("GET") {
            return Err("앱 업데이트 중에는 새 작업을 시작할 수 없습니다.".into());
        }
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

    pub(crate) fn begin_update(&mut self) -> Result<(), String> {
        for status in ["queued", "running"] {
            let (code, body) = self.request(
                format!("/operations?status={status}&pageSize=1"),
                "GET".into(),
                None,
            )?;
            if code != 200 {
                return Err("실행 중인 작업을 확인하지 못했습니다. 다시 시도하십시오.".into());
            }
            if operation_count(&body)? > 0 {
                return Err(
                    "실행 중이거나 대기 중인 작업이 있습니다. 작업이 끝난 뒤 업데이트하십시오."
                        .into(),
                );
            }
        }
        self.updating = true;
        Ok(())
    }

    pub(crate) fn end_update(&mut self) {
        self.updating = false;
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn operation_count(body: &str) -> Result<u64, String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("pagination")?.get("total")?.as_u64())
        .ok_or_else(|| "작업 상태 응답을 확인하지 못했습니다. 다시 시도하십시오.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(queued: u64, running: u64, malformed: bool) -> DesktopApiProcess {
        let script = r#"
import sys, json
queued, running, malformed = map(int, sys.argv[1:])
for line in sys.stdin:
    request = json.loads(line)
    total = queued if 'status=queued' in request['path'] else running
    body = {} if malformed else {'pagination': {'total': total}, 'operations': []}
    print(json.dumps({'id': request['id'], 'status': 200, 'body': json.dumps(body)}), flush=True)
"#;
        let mut child = Command::new("/usr/bin/python3")
            .args([
                "-u",
                "-c",
                script,
                &queued.to_string(),
                &running.to_string(),
                if malformed { "1" } else { "0" },
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        DesktopApiProcess {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            next_id: 0,
            updating: false,
        }
    }

    #[test]
    fn rejects_pending_work_using_pagination_total_and_fails_closed() {
        for (queued, running, malformed) in [(1, 0, false), (0, 100, false), (0, 0, true)] {
            let mut api = fixture(queued, running, malformed);
            assert!(api.begin_update().is_err());
            assert!(api
                .request("/runtime/start".into(), "POST".into(), None)
                .is_ok());
        }
        assert!(operation_count(r#"{"pagination":{"total":-1}}"#).is_err());
    }

    #[test]
    fn blocks_new_mutations_during_update_and_restores_them_after_failure() {
        let mut api = fixture(0, 0, false);
        api.begin_update().unwrap();
        assert!(api.request("/health".into(), "GET".into(), None).is_ok());
        for method in ["POST", "PATCH", "DELETE"] {
            assert!(api
                .request("/runtime/start".into(), method.into(), None)
                .is_err());
        }
        api.end_update();
        assert!(api
            .request("/runtime/start".into(), "POST".into(), None)
            .is_ok());
    }
}

impl Drop for DesktopApiProcess {
    fn drop(&mut self) {
        self.stop();
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
