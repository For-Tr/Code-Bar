use std::{fs, io::Read, path::PathBuf};

use tauri::{Emitter, Manager};

use crate::state::PtyKillerMap;

// ── Claude Code hooks 配置 ────────────────────────────────────────

const HOOK_CMD: &str = "nc -U /tmp/coding-island-hook.sock";

/// 检查某个 hook event 数组里是否已包含我们的 nc 命令
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

/// 在 ~/.claude/settings.json 中添加 hooks 配置
/// 幂等操作：已有相同命令则跳过，不覆盖用户其他 hook
#[tauri::command]
pub fn setup_claude_hooks() -> Result<String, String> {
    let claude_dir =
        PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude");

    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("创建 .claude 目录失败: {e}"))?;
    }

    let settings_path = claude_dir.join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("读取 settings.json 失败: {e}"))?;
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
        .ok_or("settings.json 中 hooks 字段格式异常")?;

    let mut inserted = vec![];
    for key in &["UserPromptSubmit", "Stop", "StopFailure", "Notification"] {
        if hooks_obj.get(*key).map(already_has_hook).unwrap_or(false) {
            continue;
        }
        hooks_obj.insert(key.to_string(), our_entry.clone());
        inserted.push(*key);
    }

    if inserted.is_empty() {
        return Ok("Claude Code hooks 已是最新，无需修改".to_string());
    }

    let output = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化 settings 失败: {e}"))?;
    fs::write(&settings_path, output)
        .map_err(|e| format!("写入 settings.json 失败: {e}"))?;

    Ok(format!(
        "已配置 Claude Code hooks: {}",
        settings_path.display()
    ))
}

/// 将目录写入 ~/.claude/settings.json 的 trustedDirectories
#[tauri::command]
pub fn trust_workspace(path: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量")?;
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
        .ok_or("settings.json 格式错误")?
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

// ── Hook Socket Server ────────────────────────────────────────────

/// 启动 Unix Domain Socket 服务端，接收 Claude Code hooks 的 JSON payload
pub fn start_hook_socket_server(app: tauri::AppHandle) {
    use std::os::unix::net::UnixListener;

    let socket_path = "/tmp/coding-island-hook.sock";
    let _ = fs::remove_file(socket_path); // 清理旧 socket

    let listener = match UnixListener::bind(socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[hook-socket] bind 失败: {e}");
            return;
        }
    };

    eprintln!("[hook-socket] listening on {socket_path}");

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[hook-socket] accept 错误: {e}");
                    continue;
                }
            };

            let mut reader = std::io::BufReader::new(stream);
            let mut payload = String::new();
            if reader.read_to_string(&mut payload).is_err() {
                continue;
            }

            let json: serde_json::Value = match serde_json::from_str(&payload) {
                Ok(j) => j,
                Err(e) => {
                    eprintln!("[hook-socket] JSON 解析失败: {e}");
                    continue;
                }
            };

            let event_name = json
                .get("hook_event_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let claude_sid = json
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            eprintln!("[hook-socket] received: {event_name} claude_session={claude_sid}");

            // 取出所有活跃的 Coding Island session ID（广播）
            let active_sessions: Vec<String> = {
                let km_arc = app.state::<PtyKillerMap>().inner().clone();
                let km = km_arc.lock().unwrap();
                km.keys().cloned().collect()
            };
            eprintln!(
                "[hook-socket] broadcasting to {} active session(s): {:?}",
                active_sessions.len(),
                active_sessions
            );

            dispatch_hook_event(&app, event_name, &json, &active_sessions);
        }
    });
}

/// 根据 hook 事件类型向前端广播
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
                .unwrap_or("未知错误");
            eprintln!("[hook-socket] StopFailure: {error}");
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
            eprintln!(
                "[hook-socket] Notification: {title} - {message} ({notification_type})"
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

// ── Tauri Command ─────────────────────────────────────────────────

/// 发送系统通知
#[tauri::command]
pub fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("通知发送失败: {e}"))
}
