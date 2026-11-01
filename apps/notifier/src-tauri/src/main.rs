#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
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
mod native {
    use super::*;
    use std::ffi::{c_char, CStr};
    extern "C" {
        pub fn dsc_notifications_init(callback: extern "C" fn(*const c_char));
        pub fn dsc_notifications_action(action: i32);
    }
    pub extern "C" fn callback(raw: *const c_char) {
        if raw.is_null() {
            return;
        }
        // Swift owns the nul-terminated string for the duration of this call.
        let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        record(&value);
        if serde_json::from_str::<serde_json::Value>(&value)
            .ok()
            .and_then(|v| v["kind"].as_str().map(str::to_owned))
            .as_deref()
            == Some("native-response")
        {
            if let Some(app) = APP.get() {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }
        }
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![notification_action, diagnostics])
        .run(tauri::generate_context!())
        .expect("failed to run notifier");
}
#[cfg(test)]
mod tests {
    use super::*;
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
}
