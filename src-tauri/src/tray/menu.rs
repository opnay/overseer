use super::{
    model::{compose_actions, tray_runtime_action, TraySnapshot},
    TRAY_COMPOSE_ACTION_PREFIX, TRAY_OPEN_ID, TRAY_QUIT_ID, TRAY_ROUTE_PREFIX,
    TRAY_RUNTIME_RESTART_ID, TRAY_RUNTIME_START_ID,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

pub(super) fn tray_runtime_operation(menu_id: &str) -> Option<(&'static str, &'static str)> {
    match menu_id {
        TRAY_RUNTIME_RESTART_ID => Some(("/runtime/restart", "VM 재시작")),
        TRAY_RUNTIME_START_ID => Some(("/runtime/start", "VM 시작")),
        _ => None,
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

pub(super) fn compose_action_path(menu_id: &str) -> Option<String> {
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

pub(super) fn build_tray_menu(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tray::{model::TrayComposeState, TRAY_RUNTIME_STATUS_ID};

    #[test]
    fn builds_encoded_detail_and_compose_action_routes() {
        assert_eq!(
            detail_path("compose", "내 프로젝트/a"),
            "/compose/%EB%82%B4%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%2Fa"
        );
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
    }

    #[test]
    fn maps_runtime_menu_ids_to_operations() {
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
    fn keeps_unknown_compose_states_actionless() {
        assert!(compose_actions(&TrayComposeState::Unknown).is_empty());
    }
}
