use super::MAIN_WINDOW_LABEL;
use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
use std::{cell::RefCell, ptr::NonNull};
use tauri::Manager;

thread_local! {
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

fn history_direction(button: isize) -> Option<&'static str> {
    match button {
        3 => Some("back"),
        4 => Some("forward"),
        _ => None,
    }
}

fn swipe_direction(x: f64, y: f64) -> Option<&'static str> {
    if !x.is_finite() || !y.is_finite() || x.abs() <= y.abs() {
        return None;
    }
    if x > 0.0 {
        Some("back")
    } else {
        Some("forward")
    }
}

pub(crate) fn install_navigation_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    MainThreadMarker::new().ok_or("마우스 입력 처리는 메인 스레드가 필요합니다.")?;
    MONITOR.with(|monitor| {
        if monitor.borrow().is_some() {
            return Ok(());
        }
        let app = app.clone();
        let handler = RcBlock::new(move |pointer: NonNull<NSEvent>| -> *mut NSEvent {
            // AppKit invokes app-local monitors on the main thread. The event remains
            // owned by AppKit; returning its pointer leaves normal dispatch intact.
            let event = unsafe { pointer.as_ref() };
            if !matches!(event.r#type(), NSEventType::OtherMouseDown | NSEventType::OtherMouseUp | NSEventType::Swipe) {
                return pointer.as_ptr();
            }
            let Some(mtm) = MainThreadMarker::new() else {
                return pointer.as_ptr();
            };
            let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                return pointer.as_ptr();
            };
            let Ok(native_window) = window.ns_window() else {
                return pointer.as_ptr();
            };
            let targets_main = event.window(mtm).map_or_else(
                || window.is_focused().unwrap_or(false),
                |target| Retained::as_ptr(&target).cast::<std::ffi::c_void>() == native_window,
            );
            if !targets_main {
                return pointer.as_ptr();
            }

            let direction = if event.r#type() == NSEventType::Swipe {
                swipe_direction(event.deltaX(), event.deltaY())
            } else {
                history_direction(event.buttonNumber())
            };
            let Some(direction) = direction else {
                return pointer.as_ptr();
            };
            if event.r#type() != NSEventType::OtherMouseDown {
                #[cfg(debug_assertions)]
                eprintln!("history-navigation source={:?} direction={direction}", event.r#type());
                let script = format!(
                    "window.dispatchEvent(new CustomEvent('overseer:history', {{detail: {{direction: '{direction}'}}}}));"
                );
                if let Err(error) = window.eval(script) {
                    eprintln!("마우스 화면 이동을 전달하지 못했습니다: {error}");
                    return pointer.as_ptr();
                }
            }
            // Consume handled input so Wry never emits a second navigation.
            std::ptr::null_mut()
        });
        let mask = NSEventMask::OtherMouseDown | NSEventMask::OtherMouseUp | NSEventMask::Swipe;
        let token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                mask,
                &handler,
            )
        }
        .ok_or("앱 마우스 입력 처리를 등록하지 못했습니다.")?;
        *monitor.borrow_mut() = Some(token);
        #[cfg(debug_assertions)]
        eprintln!("history-mouse-native monitor=ready");
        Ok(())
    })
}

pub(crate) fn remove_navigation_monitor() {
    MONITOR.with(|monitor| {
        if let Some(token) = monitor.borrow_mut().take() {
            unsafe { NSEvent::removeMonitor(&token) };
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{history_direction, swipe_direction};

    #[test]
    fn maps_horizontal_swipes_only() {
        assert_eq!(swipe_direction(1.0, 0.0), Some("back"));
        assert_eq!(swipe_direction(-1.0, 0.0), Some("forward"));
        for (x, y) in [
            (0.0, 0.0),
            (0.0, 1.0),
            (0.0, -1.0),
            (1.0, 1.0),
            (0.5, 1.0),
            (f64::NAN, 0.0),
        ] {
            assert_eq!(swipe_direction(x, y), None);
        }
    }

    #[test]
    fn maps_only_native_back_and_forward_buttons() {
        assert_eq!(history_direction(3), Some("back"));
        assert_eq!(history_direction(4), Some("forward"));
        for button in [0, 1, 2, 5, -1] {
            assert_eq!(history_direction(button), None);
        }
    }
}
