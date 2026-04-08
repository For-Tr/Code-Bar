use std::{fs, io::Read, path::PathBuf};

use tauri::{Emitter, Manager};

use crate::{state::PtyKillerMap, util::home_dir};

#[cfg(unix)]
const HOOK_CMD: &str = "nc -U /tmp/code-bar-hook.sock";

#[cfg(not(unix))]
const HOOK_CMD: &str = "";

fn already_has_hook(arr: &serde_json::Value) -> bool {
    arr.as_array()
        .map(|entries| {
            entries.iter().any(|entry| {
                entry
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|hs| {
                        hs.iter().any(|h| {
                            h.get("command").and_then(|c| c.as_str()) == Some(HOOK_CMD)
                        })
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn setup_claude_hooks() -> Result<String, String> {
    #[cfg(not(unix))]
    {
        return Ok("Claude Code hooks use Unix domain sockets and are disabled on Windows.".into());
    }

    #[cfg(unix)]
    {
        let claude_dir = home_dir()
            .ok_or("Unable to resolve home directory")?
            .join(".claude");

        if !claude_dir.exists() {
            fs::create_dir_all(&claude_dir)
                .map_err(|e| format!("Failed to create .claude directory: {e}"))?;
        }

        let settings_path = claude_dir.join("settings.json");
        let mut settings: serde_json::Value = if settings_path.exists() {
            let content = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings.json: {e}"))?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let our_entry = serde_json::json!([{
            "matcher": "",
            "hooks": [{ "type": "command", "command": HOOK_CMD }]
        }]);

        if settings.get("hooks").is_none() {
            settings["hooks"] = serde_json::json!({});
        }

        let hooks_obj = settings["hooks"]
            .as_object_mut()
            .ok_or("settings.json hooks field has invalid format")?;

        let mut inserted = vec![];
        for key in ["UserPromptSubmit", "Stop", "StopFailure", "Notification"] {
            if hooks_obj.get(key).map(already_has_hook).unwrap_or(false) {
                continue;
            }
            hooks_obj.insert(key.to_string(), our_entry.clone());
            inserted.push(key);
        }

        if inserted.is_empty() {
            return Ok("Claude Code hooks are already configured.".into());
        }

        let output = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;
        fs::write(&settings_path, output)
            .map_err(|e| format!("Failed to write settings.json: {e}"))?;

        Ok(format!("Configured Claude Code hooks: {}", settings_path.display()))
    }
}

#[tauri::command]
pub fn trust_workspace(path: String) -> Result<(), String> {
    let home = home_dir().ok_or("Unable to resolve home directory")?;
    let settings_path = PathBuf::from(home).join(".claude").join("settings.json");

    let content = if settings_path.exists() {
        fs::read_to_string(&settings_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    let mut json: serde_json::Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    let trusted = json
        .as_object_mut()
        .ok_or("settings.json has invalid format")?
        .entry("trustedDirectories")
        .or_insert(serde_json::json!([]));

    if let serde_json::Value::Array(arr) = trusted {
        if !arr.iter().any(|v| v.as_str() == Some(&path)) {
            arr.push(serde_json::Value::String(path));
        }
    }

    let out = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&settings_path, out).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(unix)]
pub fn start_hook_socket_server(app: tauri::AppHandle) {
    use std::os::unix::net::UnixListener;

    let socket_path = "/tmp/code-bar-hook.sock";
    let _ = fs::remove_file(socket_path);

    let listener = match UnixListener::bind(socket_path) {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("[hook-socket] bind failed: {e}");
            return;
        }
    };

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(stream) => stream,
                Err(e) => {
                    eprintln!("[hook-socket] accept error: {e}");
                    continue;
                }
            };

            let mut reader = std::io::BufReader::new(stream);
            let mut payload = String::new();
            if reader.read_to_string(&mut payload).is_err() {
                continue;
            }

            let json: serde_json::Value = match serde_json::from_str(&payload) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("[hook-socket] invalid JSON: {e}");
                    continue;
                }
            };

            let event_name = json
                .get("hook_event_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let active_sessions: Vec<String> = {
                let km_arc = app.state::<PtyKillerMap>().inner().clone();
                let km = km_arc.lock().unwrap();
                km.keys().cloned().collect()
            };

            dispatch_hook_event(&app, event_name, &json, &active_sessions);
        }
    });
}

#[cfg(not(unix))]
pub fn start_hook_socket_server(_app: tauri::AppHandle) {}

fn dispatch_hook_event(
    app: &tauri::AppHandle,
    event_name: &str,
    json: &serde_json::Value,
    sessions: &[String],
) {
    match event_name {
        "UserPromptSubmit" => {
            for sid in sessions {
                let _ = app.emit("pty-running", serde_json::json!({ "session_id": sid }));
            }
        }
        "Stop" => {
            for sid in sessions {
                let _ = app.emit("pty-waiting", serde_json::json!({ "session_id": sid }));
            }
        }
        "StopFailure" => {
            let error = json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            for sid in sessions {
                let _ = app.emit(
                    "pty-error",
                    serde_json::json!({ "session_id": sid, "error": error }),
                );
            }
        }
        "Notification" => {
            let title = json
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Claude Code");
            let message = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let notification_type = json
                .get("notification_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let _ = crate::notification::send_notification_with_callback(
                app.clone(),
                title.to_string(),
                message.to_string(),
                None,
                Some(true),
            );

            for sid in sessions {
                let _ = app.emit(
                    "pty-notification",
                    serde_json::json!({
                        "session_id": sid,
                        "title": title,
                        "message": message,
                        "notification_type": notification_type,
                    }),
                );
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    crate::notification::send_notification_with_callback(app, title, body, None, Some(true))
}
