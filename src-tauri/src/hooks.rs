use std::{fs, io::Read, path::PathBuf};

use serde_json::{Map, Value};

use crate::session_lifecycle::{
    emit_session_lifecycle, HookSource, SessionLifecycleSignal, SessionRoutingHint,
};

#[derive(Debug, Clone)]
struct HookCommandSpec {
    event_name: &'static str,
    matcher: Option<&'static str>,
    command: String,
    timeout: Option<u64>,
    status_message: Option<&'static str>,
}

fn hook_bridge_command(source: HookSource) -> String {
    let source_name = source.label();
    let socket_path = source.socket_path();
    format!(
        "/usr/bin/python3 -c 'import json, os, socket, sys; payload=json.load(sys.stdin); sid=os.environ.get(\"CODE_BAR_SESSION_ID\"); runner=os.environ.get(\"CODE_BAR_RUNNER_TYPE\"); payload[\"code_bar_source\"]=\"{source_name}\"; payload[\"code_bar_session_id\"]=sid if sid else payload.get(\"code_bar_session_id\"); payload[\"code_bar_runner_type\"]=runner if runner else payload.get(\"code_bar_runner_type\"); sock=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); sock.connect(\"{socket_path}\"); sock.sendall(json.dumps(payload).encode(\"utf-8\")); sock.close()' >/dev/null 2>&1 || true"
    )
}

fn hook_specs(source: HookSource) -> Vec<HookCommandSpec> {
    let command = hook_bridge_command(source);
    match source {
        HookSource::ClaudeCode => vec![
            HookCommandSpec {
                event_name: "UserPromptSubmit",
                matcher: Some(""),
                command: command.clone(),
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Stop",
                matcher: Some(""),
                command: command.clone(),
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "StopFailure",
                matcher: Some(""),
                command: command.clone(),
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Notification",
                matcher: Some(""),
                command,
                timeout: None,
                status_message: None,
            },
        ],
        HookSource::Codex => vec![
            HookCommandSpec {
                event_name: "UserPromptSubmit",
                matcher: None,
                command: command.clone(),
                timeout: Some(5),
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Stop",
                matcher: None,
                command,
                timeout: Some(5),
                status_message: None,
            },
        ],
    }
}

fn managed_legacy_commands(source: HookSource) -> &'static [&'static str] {
    match source {
        HookSource::ClaudeCode => &["nc -U /tmp/code-bar-hook.sock"],
        HookSource::Codex => &[],
    }
}

fn is_managed_command(command: &str, source: HookSource) -> bool {
    command.contains(source.socket_path())
        || managed_legacy_commands(source)
            .iter()
            .any(|legacy| command.contains(legacy))
}

fn load_json_file(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    Ok(serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({})))
}

fn ensure_hooks_object<'a>(
    root: &'a mut Value,
    path_label: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    if root.get("hooks").is_none() {
        root["hooks"] = serde_json::json!({});
    }
    root["hooks"]
        .as_object_mut()
        .ok_or_else(|| format!("{path_label} 中 hooks 字段格式异常"))
}

fn build_hook_entry(spec: &HookCommandSpec) -> Value {
    let mut hook = serde_json::json!({
        "type": "command",
        "command": spec.command.clone(),
    });
    if let Some(timeout) = spec.timeout {
        hook["timeout"] = Value::from(timeout);
    }
    if let Some(status_message) = spec.status_message {
        hook["statusMessage"] = Value::from(status_message);
    }

    let mut group = Map::new();
    if let Some(matcher) = spec.matcher {
        group.insert("matcher".to_string(), Value::from(matcher));
    }
    group.insert("hooks".to_string(), Value::Array(vec![hook]));
    Value::Object(group)
}

fn normalize_managed_hook(hook: &mut Value, spec: &HookCommandSpec) -> bool {
    let Some(obj) = hook.as_object_mut() else {
        *hook = serde_json::json!({});
        return normalize_managed_hook(hook, spec);
    };

    let mut changed = false;

    if obj.get("type").and_then(|v| v.as_str()) != Some("command") {
        obj.insert("type".to_string(), Value::from("command"));
        changed = true;
    }
    if obj.get("command").and_then(|v| v.as_str()) != Some(spec.command.as_str()) {
        obj.insert("command".to_string(), Value::from(spec.command.clone()));
        changed = true;
    }

    match spec.timeout {
        Some(timeout) => {
            if obj.get("timeout").and_then(|v| v.as_u64()) != Some(timeout) {
                obj.insert("timeout".to_string(), Value::from(timeout));
                changed = true;
            }
        }
        None => {
            if obj.remove("timeout").is_some() {
                changed = true;
            }
        }
    }

    match spec.status_message {
        Some(status_message) => {
            if obj.get("statusMessage").and_then(|v| v.as_str()) != Some(status_message) {
                obj.insert("statusMessage".to_string(), Value::from(status_message));
                changed = true;
            }
        }
        None => {
            if obj.remove("statusMessage").is_some() {
                changed = true;
            }
        }
    }

    changed
}

fn merge_hook_specs(
    root: &mut Value,
    source: HookSource,
    specs: &[HookCommandSpec],
    path_label: &str,
) -> Result<Vec<String>, String> {
    let hooks_obj = ensure_hooks_object(root, path_label)?;
    let mut changed_events = Vec::new();

    for spec in specs {
        let event_value = hooks_obj
            .entry(spec.event_name.to_string())
            .or_insert_with(|| Value::Array(Vec::new()));

        if !event_value.is_array() {
            *event_value = Value::Array(Vec::new());
        }
        let event_arr = event_value
            .as_array_mut()
            .ok_or_else(|| format!("{path_label} 中 {} hooks 不是数组", spec.event_name))?;

        let mut has_current_command = false;
        let mut event_changed = false;

        event_arr.retain_mut(|group| {
            let Some(group_obj) = group.as_object_mut() else {
                event_changed = true;
                return false;
            };

            let hooks = group_obj
                .entry("hooks".to_string())
                .or_insert_with(|| Value::Array(Vec::new()));

            if !hooks.is_array() {
                *hooks = Value::Array(Vec::new());
                event_changed = true;
            }

            let hook_arr = hooks.as_array_mut().expect("hooks array just normalized");
            let before_len = hook_arr.len();

            hook_arr.retain_mut(|hook| {
                let command = hook.get("command").and_then(|v| v.as_str()).unwrap_or("");
                if command == spec.command {
                    if has_current_command {
                        event_changed = true;
                        return false;
                    }
                    has_current_command = true;
                    if normalize_managed_hook(hook, spec) {
                        event_changed = true;
                    }
                    return true;
                }
                if is_managed_command(command, source) {
                    event_changed = true;
                    return false;
                }
                true
            });

            if hook_arr.len() != before_len {
                event_changed = true;
            }

            !hook_arr.is_empty()
        });

        if !has_current_command {
            event_arr.push(build_hook_entry(spec));
            event_changed = true;
        }

        if event_changed {
            changed_events.push(spec.event_name.to_string());
        }
    }

    Ok(changed_events)
}

fn save_json_file(path: &PathBuf, json: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }
    let output = serde_json::to_string_pretty(json)
        .map_err(|e| format!("序列化 {} 失败: {e}", path.display()))?;
    fs::write(path, output).map_err(|e| format!("写入 {} 失败: {e}", path.display()))
}

fn ensure_claude_hook_settings() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量")?;
    let settings_path = PathBuf::from(home).join(".claude").join("settings.json");
    let mut settings = load_json_file(&settings_path)?;
    let changed = merge_hook_specs(
        &mut settings,
        HookSource::ClaudeCode,
        &hook_specs(HookSource::ClaudeCode),
        &settings_path.display().to_string(),
    )?;

    if changed.is_empty() {
        return Ok("Claude Code hooks 已是最新，无需修改".to_string());
    }

    save_json_file(&settings_path, &settings)?;
    Ok(format!(
        "已配置 Claude Code hooks: {} ({})",
        settings_path.display(),
        changed.join(", ")
    ))
}

fn ensure_codex_feature_flag() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量")?;
    let config_path = PathBuf::from(home).join(".codex").join("config.toml");
    let content = if config_path.exists() {
        fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 {} 失败: {e}", config_path.display()))?
    } else {
        String::new()
    };

    let mut config: toml::Table = if content.trim().is_empty() {
        toml::Table::new()
    } else {
        content
            .parse::<toml::Table>()
            .unwrap_or_else(|_| toml::Table::new())
    };

    let features = config
        .entry("features")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    if !features.is_table() {
        *features = toml::Value::Table(toml::Table::new());
    }

    let features_table = features
        .as_table_mut()
        .ok_or_else(|| format!("{} 中 [features] 配置格式异常", config_path.display()))?;

    let already_enabled = features_table
        .get("codex_hooks")
        .and_then(|v| v.as_bool())
        == Some(true);

    if already_enabled {
        return Ok(format!(
            "Codex hooks feature 已启用: {}",
            config_path.display()
        ));
    }

    features_table.insert("codex_hooks".to_string(), toml::Value::Boolean(true));

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }

    let output = toml::to_string_pretty(&config)
        .map_err(|e| format!("序列化 {} 失败: {e}", config_path.display()))?;
    fs::write(&config_path, output)
        .map_err(|e| format!("写入 {} 失败: {e}", config_path.display()))?;

    Ok(format!(
        "已启用 Codex hooks feature: {}",
        config_path.display()
    ))
}

fn ensure_codex_hook_settings() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量")?;
    let hooks_path = PathBuf::from(home).join(".codex").join("hooks.json");
    let mut hooks = load_json_file(&hooks_path)?;
    let changed = merge_hook_specs(
        &mut hooks,
        HookSource::Codex,
        &hook_specs(HookSource::Codex),
        &hooks_path.display().to_string(),
    )?;

    if changed.is_empty() {
        return Ok("Codex hooks 已是最新，无需修改".to_string());
    }

    save_json_file(&hooks_path, &hooks)?;
    Ok(format!(
        "已配置 Codex hooks: {} ({})",
        hooks_path.display(),
        changed.join(", ")
    ))
}

#[tauri::command]
pub fn setup_claude_hooks() -> Result<String, String> {
    ensure_claude_hook_settings()
}

#[tauri::command]
pub fn setup_codex_hooks() -> Result<String, String> {
    let feature = ensure_codex_feature_flag()?;
    let hooks = ensure_codex_hook_settings()?;
    Ok(format!("{feature}\n{hooks}"))
}

#[tauri::command]
pub fn setup_all_hooks() -> Result<String, String> {
    let claude = ensure_claude_hook_settings()?;
    let codex_feature = ensure_codex_feature_flag()?;
    let codex_hooks = ensure_codex_hook_settings()?;
    Ok(format!("{claude}\n{codex_feature}\n{codex_hooks}"))
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

    let mut json: Value = serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}));

    let trusted = json
        .as_object_mut()
        .ok_or("settings.json 格式错误")?
        .entry("trustedDirectories")
        .or_insert(serde_json::json!([]));

    if let Value::Array(arr) = trusted {
        if !arr.iter().any(|v| v.as_str() == Some(&path)) {
            arr.push(Value::String(path));
        }
    }

    let out = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&settings_path, out).map_err(|e| e.to_string())?;

    Ok(())
}

fn dispatch_hook_event(
    app: &tauri::AppHandle,
    source: HookSource,
    json: &Value,
) {
    let event_name = json
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let routing = SessionRoutingHint {
        source,
        code_bar_session_id: json
            .get("code_bar_session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        cwd: json
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    eprintln!(
        "[hooks:{}] received: {} code_bar_session={:?} cwd={:?}",
        source.label(),
        event_name,
        routing.code_bar_session_id,
        routing.cwd
    );

    match source {
        HookSource::ClaudeCode => match event_name {
            "UserPromptSubmit" => {
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Running);
            }
            "Stop" => {
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Waiting);
            }
            "StopFailure" => {
                let error = json
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误");
                emit_session_lifecycle(
                    app,
                    routing,
                    SessionLifecycleSignal::Error {
                        message: error.to_string(),
                    },
                );
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
                emit_session_lifecycle(
                    app,
                    routing,
                    SessionLifecycleSignal::Attention {
                        title: title.to_string(),
                        message: message.to_string(),
                        notification_type: notification_type.to_string(),
                    },
                );
            }
            _ => {}
        },
        HookSource::Codex => match event_name {
            "UserPromptSubmit" => {
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Running);
            }
            "Stop" => {
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Waiting);
            }
            _ => {}
        },
    }
}

fn start_hook_socket_server(app: tauri::AppHandle, source: HookSource) {
    use std::os::unix::net::UnixListener;

    let socket_path = source.socket_path();
    let _ = fs::remove_file(socket_path);

    let listener = match UnixListener::bind(socket_path) {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("[hooks:{}] bind 失败: {e}", source.label());
            return;
        }
    };

    eprintln!("[hooks:{}] listening on {}", source.label(), socket_path);

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(stream) => stream,
                Err(e) => {
                    eprintln!("[hooks:{}] accept 错误: {e}", source.label());
                    continue;
                }
            };

            let mut reader = std::io::BufReader::new(stream);
            let mut payload = String::new();
            if let Err(e) = reader.read_to_string(&mut payload) {
                eprintln!("[hooks:{}] read 失败: {e}", source.label());
                continue;
            }

            let json: Value = match serde_json::from_str(&payload) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("[hooks:{}] JSON 解析失败: {e}", source.label());
                    continue;
                }
            };

            dispatch_hook_event(&app, source, &json);
        }
    });
}

pub fn start_hook_socket_servers(app: tauri::AppHandle) {
    start_hook_socket_server(app.clone(), HookSource::ClaudeCode);
    start_hook_socket_server(app, HookSource::Codex);
}

/// 发送系统通知（支持点击回调，委托给 notification 模块）
///
/// macOS 下使用 mac-notification-sys 实现常驻通知 + 点击回调；
/// 前端监听 "notification-clicked" 事件即可响应用户点击。
#[tauri::command]
pub fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    crate::notification::send_notification_with_callback(
        app,
        title,
        body,
        None,
        Some(true),
    )
}
