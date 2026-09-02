use super::{TRAY_RUNTIME_RESTART_ID, TRAY_RUNTIME_START_ID, TRAY_RUNTIME_STATUS_ID};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum TrayRuntimeState {
    Error,
    Missing,
    Running,
    Starting,
    Stopped,
    Stopping,
}

#[derive(Debug, PartialEq)]
pub(super) struct TrayRuntimeAction {
    pub(super) enabled: bool,
    pub(super) id: &'static str,
    pub(super) label: &'static str,
}

#[derive(Debug, PartialEq)]
pub(super) struct TrayComposeProject {
    pub(super) containers: Vec<TrayContainer>,
    pub(super) name: String,
    pub(super) state: TrayComposeState,
}

#[derive(Debug, PartialEq)]
pub(super) enum TrayComposeState {
    Running,
    Stopped,
    Unknown,
}

#[derive(Debug, PartialEq)]
pub(super) struct TrayContainer {
    pub(super) id: String,
    pub(super) name: String,
}

#[derive(Debug, PartialEq)]
pub(super) struct TraySnapshot {
    pub(super) projects: Vec<TrayComposeProject>,
    pub(super) runtime_state: TrayRuntimeState,
}

pub(super) fn tray_snapshot_from_json(body: &str) -> Result<TraySnapshot, String> {
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

pub(super) fn auto_start_runtime_path(state: TrayRuntimeState) -> Option<&'static str> {
    matches!(state, TrayRuntimeState::Stopped).then_some("/runtime/start")
}

pub(super) fn tray_runtime_action(state: Option<TrayRuntimeState>) -> TrayRuntimeAction {
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

pub(super) fn compose_state(status: &str) -> TrayComposeState {
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

pub(super) fn compose_actions(state: &TrayComposeState) -> &'static [(&'static str, &'static str)] {
    match state {
        TrayComposeState::Running => &[("stop", "중지"), ("restart", "재시작")],
        TrayComposeState::Stopped => &[("up", "시작")],
        TrayComposeState::Unknown => &[],
    }
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
    }

    #[test]
    fn maps_compose_states_to_available_actions() {
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
}
