use super::model::TrayRuntimeState;

#[cfg(target_os = "macos")]
use objc2::{MainThreadMarker, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSImage, NSImageNameStatusAvailable, NSImageNameStatusPartiallyAvailable,
    NSImageNameStatusUnavailable, NSImageScaling, NSImageView, NSWindowOrderingMode,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};

#[cfg(target_os = "macos")]
const TRAY_RUNTIME_INDICATOR_TAG: isize = 0x4f565253;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum TrayRuntimeIndicator {
    Available,
    Hidden,
    PartiallyAvailable,
    Unavailable,
}

pub(super) fn tray_runtime_indicator(state: TrayRuntimeState) -> TrayRuntimeIndicator {
    match state {
        TrayRuntimeState::Running => TrayRuntimeIndicator::Available,
        TrayRuntimeState::Starting | TrayRuntimeState::Stopping => {
            TrayRuntimeIndicator::PartiallyAvailable
        }
        TrayRuntimeState::Stopped | TrayRuntimeState::Error => TrayRuntimeIndicator::Unavailable,
        TrayRuntimeState::Missing => TrayRuntimeIndicator::Hidden,
    }
}

#[cfg(target_os = "macos")]
pub(super) fn set_tray_runtime_indicator(
    tray: &tauri::tray::TrayIcon,
    state: TrayRuntimeIndicator,
) -> Result<(), String> {
    tray.with_inner_tray_icon(move |inner| {
        let mtm = MainThreadMarker::new().ok_or("메인 스레드를 확인하지 못했습니다.")?;
        let status_item = inner
            .ns_status_item()
            .ok_or("macOS 상태 아이템을 찾지 못했습니다.")?;
        let button = status_item
            .button(mtm)
            .ok_or("macOS 상태 아이템 버튼을 찾지 못했습니다.")?;
        let indicator = button.viewWithTag(TRAY_RUNTIME_INDICATOR_TAG);
        if state == TrayRuntimeIndicator::Hidden {
            if let Some(indicator) = indicator {
                indicator.setHidden(true);
            }
            return Ok(());
        }
        let indicator = match indicator {
            Some(indicator) => indicator
                .downcast::<NSImageView>()
                .map_err(|_| "macOS VM 상태점 형식이 잘못됐습니다.")?,
            None => {
                let bounds = button.bounds();
                let size = 7.0;
                let frame = NSRect::new(
                    NSPoint::new(
                        bounds.size.width - size - 1.0,
                        bounds.size.height - size - 1.0,
                    ),
                    NSSize::new(size, size),
                );
                let indicator = NSImageView::initWithFrame(NSImageView::alloc(mtm), frame);
                indicator.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
                indicator.setTag(TRAY_RUNTIME_INDICATOR_TAG);
                indicator.setEnabled(false);
                button.addSubview_positioned_relativeTo(
                    &indicator,
                    NSWindowOrderingMode::Below,
                    None,
                );
                indicator
            }
        };
        let image_name = unsafe {
            match state {
                TrayRuntimeIndicator::Available => NSImageNameStatusAvailable,
                TrayRuntimeIndicator::PartiallyAvailable => NSImageNameStatusPartiallyAvailable,
                TrayRuntimeIndicator::Unavailable => NSImageNameStatusUnavailable,
                TrayRuntimeIndicator::Hidden => unreachable!(),
            }
        };
        let image =
            NSImage::imageNamed(image_name).ok_or("macOS VM 상태 이미지를 찾지 못했습니다.")?;
        indicator.setImage(Some(&image));
        indicator.setHidden(false);
        Ok::<(), String>(())
    })
    .map_err(|error| format!("메뉴바 상태점을 갱신하지 못했습니다: {error}"))?
}

#[cfg(not(target_os = "macos"))]
pub(super) fn set_tray_runtime_indicator(
    _tray: &tauri::tray::TrayIcon,
    _state: TrayRuntimeIndicator,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_runtime_states_to_native_status_indicators() {
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Running),
            TrayRuntimeIndicator::Available
        );
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Starting),
            TrayRuntimeIndicator::PartiallyAvailable
        );
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Stopping),
            TrayRuntimeIndicator::PartiallyAvailable
        );
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Stopped),
            TrayRuntimeIndicator::Unavailable
        );
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Error),
            TrayRuntimeIndicator::Unavailable
        );
        assert_eq!(
            tray_runtime_indicator(TrayRuntimeState::Missing),
            TrayRuntimeIndicator::Hidden
        );
    }
}
