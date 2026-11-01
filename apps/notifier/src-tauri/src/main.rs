#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(target_os = "macos")]
mod ipc;
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
};
use tauri::Manager;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static EVENTS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
fn record(value: &str) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("{timestamp} {value}");
    let Ok(mut events) = EVENTS.lock() else {
        return;
    };
    if events.len() >= 100 {
        events.pop_front();
    }
    events.push_back(line.clone());
    // Bounded diagnostic file, no notification body or source credentials.
    if let Some(app) = APP.get() {
        if let Ok(dir) = app.path().app_log_dir() {
            let result = (|| -> std::io::Result<()> {
                use std::io::Write;
                std::fs::create_dir_all(&dir)?;
                let path = dir.join("native.log");
                if std::fs::metadata(&path)
                    .map(|m| m.len() > 1_048_576)
                    .unwrap_or(false)
                {
                    let previous = dir.join("native.previous.log");
                    if previous.exists() {
                        std::fs::remove_file(&previous)?;
                    }
                    std::fs::rename(&path, previous)?;
                }
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)?;
                writeln!(file, "{line}")
            })();
            if let Err(error) = result {
                eprintln!("native diagnostic write failed: {error}");
            }
        }
    }
}
#[cfg(target_os = "macos")]
fn run_focus_click(
    token: String,
    hide_shell: impl FnOnce() + Send + 'static,
    route: impl FnOnce(&str) -> bool + Send + 'static,
    show_fallback: impl FnOnce() + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        // Notification activation can bring the owning app to the foreground.
        // Hide its shell before asking the source IDE window to become active.
        hide_shell();
        let request_sent = route(&token);
        record(if request_sent {
            "focus-request-sent"
        } else {
            "focus-request-unavailable"
        });
        if !request_sent {
            show_fallback();
        }
    })
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::ffi::{c_char, CStr};
    extern "C" {
        pub fn dsc_notifications_init(callback: extern "C" fn(*const c_char));
        pub fn dsc_notifications_action(action: i32);
        pub fn dsc_notifications_post(payload: *const c_char);
        pub fn dsc_notifications_withdraw(token: *const c_char);
    }
    pub extern "C" fn callback(raw: *const c_char) {
        if raw.is_null() {
            return;
        }
        // Swift owns the nul-terminated string for the duration of this call.
        let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        record(&value);
        let response = serde_json::from_str::<serde_json::Value>(&value).ok();
        if response.as_ref().is_some_and(|v| {
            v["kind"] == "native-response"
                && v["action"] == "com.apple.UNNotificationDefaultActionIdentifier"
        }) {
            let Some(token) = response
                .as_ref()
                .and_then(|v| v["id"].as_str())
                .map(str::to_owned)
            else {
                return;
            };
            // A slow IDE socket must not block UserNotifications' callback.
            // Wait for the main-thread hide to run before writing the IPC request.
            let Some(app) = APP.get().cloned() else {
                record("focus-app-handle-unavailable");
                return;
            };
            let hide_app = app.clone();
            let fallback_app = app.clone();
            let _ = run_focus_click(
                token,
                move || hide_notifier_window(hide_app),
                ipc::focus,
                move || show_notifier_fallback(fallback_app),
            );
        }
    }
}
#[cfg(target_os = "macos")]
fn hide_notifier_window(app: tauri::AppHandle) {
    let (hidden_tx, hidden_rx) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    if app
        .run_on_main_thread(move || {
            let hidden = handle
                .get_webview_window("main")
                .is_some_and(|window| window.hide().is_ok());
            record(if hidden {
                "notifier-window-hidden-for-focus"
            } else {
                "notifier-window-hide-unavailable"
            });
            let _ = hidden_tx.send(hidden);
        })
        .is_err()
    {
        record("notifier-window-hide-schedule-failed");
        return;
    }
    if hidden_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .is_err()
    {
        record("notifier-window-hide-timeout");
    }
}
#[cfg(target_os = "macos")]
fn show_notifier_fallback(app: tauri::AppHandle) {
    let handle = app.clone();
    if app
        .run_on_main_thread(move || {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .is_err()
    {
        record("notifier-fallback-show-schedule-failed");
    }
}
#[cfg(target_os = "macos")]
fn post_native_payload(payload: String) {
    if let Some(app) = APP.get() {
        if app
            .run_on_main_thread(move || {
                if let Ok(payload) = std::ffi::CString::new(payload) {
                    unsafe {
                        native::dsc_notifications_post(payload.as_ptr());
                    }
                }
            })
            .is_err()
        {
            record("native-schedule-failed");
        }
    }
}
#[cfg(target_os = "macos")]
fn withdraw_native_token(token: String) {
    if let Some(app) = APP.get() {
        let _ = app.run_on_main_thread(move || {
            if let Ok(token) = std::ffi::CString::new(token) {
                unsafe {
                    native::dsc_notifications_withdraw(token.as_ptr());
                }
            }
        });
    }
}
fn action_code(action: &str) -> Result<i32, String> {
    match action {
        "status" => Ok(0),
        "authorize" => Ok(1),
        "post" => Ok(2),
        "withdraw" => Ok(3),
        _ => Err("unsupported action".into()),
    }
}
#[tauri::command]
fn notification_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    let code = action_code(&action)?;
    #[cfg(target_os = "macos")]
    return app
        .run_on_main_thread(move || unsafe {
            native::dsc_notifications_action(code);
        })
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, code);
        Err("unsupported platform: native adapter not implemented".into())
    }
}
#[tauri::command]
fn diagnostics() -> Vec<String> {
    EVENTS
        .lock()
        .map(|e| e.iter().cloned().collect())
        .unwrap_or_default()
}
#[tauri::command]
fn connected_sources() -> usize {
    #[cfg(target_os = "macos")]
    {
        ipc::connection_count()
    }
    #[cfg(not(target_os = "macos"))]
    {
        0
    }
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            #[cfg(target_os = "macos")]
            unsafe {
                native::dsc_notifications_init(native::callback);
                native::dsc_notifications_action(0);
            }
            record("launch");
            #[cfg(target_os = "macos")]
            if let Err(error) = ipc::start(post_native_payload, withdraw_native_token) {
                record(&format!("ipc-start-failed {error}"));
            } else {
                record("ipc-ready");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notification_action,
            diagnostics,
            connected_sources
        ])
        .run(tauri::generate_context!())
        .expect("failed to run notifier");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    use std::sync::Arc;
    #[test]
    fn external_actions_cannot_execute_commands_or_urls() {
        for value in [
            "",
            "open",
            "executeCommand",
            "vscode://source/focus",
            "post;open",
            "POST",
        ] {
            assert!(action_code(value).is_err());
        }
        assert_eq!(action_code("post"), Ok(2));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn notification_click_hides_shell_before_routing_and_only_shows_on_unavailable_route() {
        let actions = Arc::new(Mutex::new(Vec::new()));
        let token = "opaque-route-token".to_owned();
        let hide_actions = actions.clone();
        let route_actions = actions.clone();
        let fallback_actions = actions.clone();
        run_focus_click(
            token,
            move || hide_actions.lock().unwrap().push("hide"),
            move |token| {
                assert_eq!(token, "opaque-route-token");
                route_actions.lock().unwrap().push("route");
                true
            },
            move || fallback_actions.lock().unwrap().push("fallback"),
        )
        .join()
        .unwrap();
        assert_eq!(*actions.lock().unwrap(), ["hide", "route"]);

        let actions = Arc::new(Mutex::new(Vec::new()));
        let hide_actions = actions.clone();
        let route_actions = actions.clone();
        let fallback_actions = actions.clone();
        run_focus_click(
            "opaque-route-token".to_owned(),
            move || hide_actions.lock().unwrap().push("hide"),
            move |_| {
                route_actions.lock().unwrap().push("route");
                false
            },
            move || fallback_actions.lock().unwrap().push("fallback"),
        )
        .join()
        .unwrap();
        assert_eq!(*actions.lock().unwrap(), ["hide", "route", "fallback"]);
    }
}
