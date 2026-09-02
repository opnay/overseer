use crate::single_instance::BACKGROUND_ARGUMENT;
use auto_launch::AutoLaunch;
use std::env;

const LEGACY_AUTOSTART_NAME: &str = "OverseerHelper";

pub(crate) fn configure_app_autostart() -> Result<(), String> {
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
