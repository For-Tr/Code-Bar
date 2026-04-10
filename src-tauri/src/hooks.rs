use std::fs;
use std::io::Read;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::provider_sessions::emit_provider_session_bound;
use crate::session_lifecycle::{
    emit_session_lifecycle, HookSource, SessionLifecycleSignal, SessionRoutingHint,
};
#[cfg(not(unix))]
use crate::util::home_dir;
use crate::util::resolve_provider_file_path;

#[derive(Debug, Clone)]
struct HookCommandSpec {
    event_name: &'static str,
    matcher: Option<&'static str>,
    command: String,
    shell: Option<&'static str>,
    timeout: Option<u64>,
    status_message: Option<&'static str>,
}

#[cfg(unix)]
fn hook_bridge_command(source: HookSource) -> Result<String, String> {
    let source_name = source.label();
    let socket_path = source.socket_path();
    Ok(format!(
        "/usr/bin/python3 -c 'import json, os, socket, sys; payload=json.load(sys.stdin); sid=os.environ.get(\"CODE_BAR_SESSION_ID\"); runner=os.environ.get(\"CODE_BAR_RUNNER_TYPE\"); payload[\"code_bar_source\"]=\"{source_name}\"; payload[\"code_bar_session_id\"]=sid if sid else payload.get(\"code_bar_session_id\"); payload[\"code_bar_runner_type\"]=runner if runner else payload.get(\"code_bar_runner_type\"); sock=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); sock.connect(\"{socket_path}\"); sock.sendall(json.dumps(payload).encode(\"utf-8\")); sock.close()' >/dev/null 2>&1 || true"
    ))
}

#[cfg(not(unix))]
const WINDOWS_POWERSHELL: &str = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";

#[cfg(not(unix))]
const WINDOWS_BRIDGE_SCRIPT: &str = r#"param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$PayloadArgs
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw) -and $PayloadArgs.Count -gt 0) {
    $raw = $PayloadArgs -join ' '
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    exit 0
  }

  $payload = $raw | ConvertFrom-Json
  if (-not $payload) {
    exit 0
  }

  if ($env:CODE_BAR_SESSION_ID) {
    $payload | Add-Member -NotePropertyName code_bar_session_id -NotePropertyValue $env:CODE_BAR_SESSION_ID -Force
  }
  if ($env:CODE_BAR_RUNNER_TYPE) {
    $payload | Add-Member -NotePropertyName code_bar_runner_type -NotePropertyValue $env:CODE_BAR_RUNNER_TYPE -Force
  }
  $payload | Add-Member -NotePropertyName code_bar_source -NotePropertyValue $Source -Force

  $json = $payload | ConvertTo-Json -Depth 32 -Compress
  $client = [System.Net.Sockets.TcpClient]::new()
  $client.Connect([System.Net.IPAddress]::Loopback, $Port)

  try {
    $stream = $client.GetStream()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    if ($stream) {
      $stream.Dispose()
    }
    $client.Dispose()
  }
} catch {
  try {
    $logPath = Join-Path (Split-Path -Parent $PSCommandPath) 'bridge-error.log'
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    Add-Content -LiteralPath $logPath -Value "$stamp [$Source] $($_.Exception.Message)" -Encoding utf8
  } catch {
  }
  exit 0
}
"#;

#[cfg(not(unix))]
fn windows_hook_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or("无法获取 HOME 环境变量")?;
    Ok(home.join(".codebar").join("hooks"))
}

#[cfg(not(unix))]
fn windows_bridge_script_path() -> Result<PathBuf, String> {
    Ok(windows_hook_dir()?.join("hook-bridge.ps1"))
}

#[cfg(not(unix))]
fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(not(unix))]
fn powershell_script_command(source: HookSource) -> Result<String, String> {
    let script = windows_bridge_script_path()?;
    let script = escape_powershell_single_quoted(&script.to_string_lossy());
    Ok(format!(
        "& '{script}' -Source '{}' -Port {}",
        source.label(),
        source.tcp_port()
    ))
}

#[cfg(not(unix))]
fn codex_notify_command() -> Result<Vec<String>, String> {
    let script = windows_bridge_script_path()?;
    Ok(vec![
        WINDOWS_POWERSHELL.to_string(),
        "-NoProfile".to_string(),
        "-NonInteractive".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-File".to_string(),
        script.to_string_lossy().to_string(),
        "-Source".to_string(),
        HookSource::Codex.label().to_string(),
        "-Port".to_string(),
        HookSource::Codex.tcp_port().to_string(),
    ])
}

#[cfg(not(unix))]
fn write_text_file_if_changed(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }

    let needs_write = match fs::read_to_string(path) {
        Ok(existing) => existing != content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(err) => return Err(format!("读取 {} 失败: {err}", path.display())),
    };

    if needs_write {
        fs::write(path, content).map_err(|e| format!("写入 {} 失败: {e}", path.display()))?;
    }

    Ok(())
}

#[cfg(not(unix))]
fn ensure_windows_hook_bridge_assets() -> Result<(), String> {
    let script_path = windows_bridge_script_path()?;
    write_text_file_if_changed(&script_path, WINDOWS_BRIDGE_SCRIPT)?;
    Ok(())
}

#[cfg(not(unix))]
fn hook_bridge_command(source: HookSource) -> Result<String, String> {
    ensure_windows_hook_bridge_assets()?;
    powershell_script_command(source)
}

fn hook_specs(source: HookSource) -> Result<Vec<HookCommandSpec>, String> {
    let command = hook_bridge_command(source)?;
    #[cfg(unix)]
    let shell = None;
    #[cfg(not(unix))]
    let shell = Some("powershell");

    match source {
        HookSource::ClaudeCode => Ok(vec![
            HookCommandSpec {
                event_name: "UserPromptSubmit",
                matcher: Some(""),
                command: command.clone(),
                shell,
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Stop",
                matcher: Some(""),
                command: command.clone(),
                shell,
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "StopFailure",
                matcher: Some(""),
                command: command.clone(),
                shell,
                timeout: None,
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Notification",
                matcher: Some(""),
                command,
                shell,
                timeout: None,
                status_message: None,
            },
        ]),
        #[cfg(unix)]
        HookSource::Codex => Ok(vec![
            HookCommandSpec {
                event_name: "UserPromptSubmit",
                matcher: None,
                command: command.clone(),
                shell: None,
                timeout: Some(5),
                status_message: None,
            },
            HookCommandSpec {
                event_name: "Stop",
                matcher: None,
                command,
                shell: None,
                timeout: Some(5),
                status_message: None,
            },
        ]),
        #[cfg(not(unix))]
        HookSource::Codex => Ok(Vec::new()),
    }
}

#[cfg(unix)]
fn managed_legacy_commands(source: HookSource) -> &'static [&'static str] {
    match source {
        HookSource::ClaudeCode => &["nc -U /tmp/code-bar-hook.sock"],
        HookSource::Codex => &[],
    }
}

fn is_managed_command(command: &str, source: HookSource) -> bool {
    #[cfg(unix)]
    {
        return command.contains(source.socket_path())
            || managed_legacy_commands(source)
                .iter()
                .any(|legacy| command.contains(legacy));
    }

    #[cfg(not(unix))]
    {
        hook_bridge_command(source)
            .map(|managed| {
                command == managed
                    || command.contains("hook-bridge.ps1")
                    || command.contains(".codebar")
                    || (command.contains(WINDOWS_POWERSHELL) && command.contains("EncodedCommand"))
            })
            .unwrap_or_else(|_| {
                command.contains("hook-bridge.ps1")
                    || command.contains(".codebar")
                    || (command.contains(WINDOWS_POWERSHELL) && command.contains("EncodedCommand"))
            })
    }
}

fn load_json_file(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
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
    if let Some(shell) = spec.shell {
        hook["shell"] = Value::from(shell);
    }
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
    match spec.shell {
        Some(shell) => {
            if obj.get("shell").and_then(|v| v.as_str()) != Some(shell) {
                obj.insert("shell".to_string(), Value::from(shell));
                changed = true;
            }
        }
        None => {
            if obj.remove("shell").is_some() {
                changed = true;
            }
        }
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
    let settings_path = resolve_provider_file_path("claude-code", "", "settings.json")
        .ok_or("无法解析 Claude Code 配置目录")?;
    let mut settings = load_json_file(&settings_path)?;
    let specs = hook_specs(HookSource::ClaudeCode)?;
    let changed = merge_hook_specs(
        &mut settings,
        HookSource::ClaudeCode,
        &specs,
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

fn load_toml_file(path: &PathBuf) -> Result<toml::Table, String> {
    let content = if path.exists() {
        fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?
    } else {
        String::new()
    };

    if content.trim().is_empty() {
        Ok(toml::Table::new())
    } else {
        Ok(content
            .parse::<toml::Table>()
            .unwrap_or_else(|_| toml::Table::new()))
    }
}

fn save_toml_file(path: &PathBuf, table: &toml::Table) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }

    let output = toml::to_string_pretty(table)
        .map_err(|e| format!("序列化 {} 失败: {e}", path.display()))?;
    fs::write(path, output).map_err(|e| format!("写入 {} 失败: {e}", path.display()))
}

#[cfg(unix)]
fn ensure_codex_feature_flag() -> Result<String, String> {
    let config_path =
        resolve_provider_file_path("codex", "", "config.toml").ok_or("无法解析 Codex 配置目录")?;
    let mut config = load_toml_file(&config_path)?;

    let features = config
        .entry("features")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    if !features.is_table() {
        *features = toml::Value::Table(toml::Table::new());
    }

    let features_table = features
        .as_table_mut()
        .ok_or_else(|| format!("{} 中 [features] 配置格式异常", config_path.display()))?;

    let already_enabled = features_table.get("codex_hooks").and_then(|v| v.as_bool()) == Some(true);

    if already_enabled {
        return Ok(format!(
            "Codex hooks feature 已启用: {}",
            config_path.display()
        ));
    }

    features_table.insert("codex_hooks".to_string(), toml::Value::Boolean(true));
    save_toml_file(&config_path, &config)?;

    Ok(format!(
        "已启用 Codex hooks feature: {}",
        config_path.display()
    ))
}

#[cfg(not(unix))]
fn ensure_codex_notify_settings() -> Result<String, String> {
    ensure_windows_hook_bridge_assets()?;

    let config_path =
        resolve_provider_file_path("codex", "", "config.toml").ok_or("无法解析 Codex 配置目录")?;
    let mut config = load_toml_file(&config_path)?;
    let desired = codex_notify_command()?;
    let desired_values: Vec<toml::Value> =
        desired.iter().cloned().map(toml::Value::String).collect();

    let notify_changed = match config.get("notify") {
        Some(toml::Value::Array(current)) => current != &desired_values,
        Some(_) => true,
        None => true,
    };

    if notify_changed {
        config.insert("notify".to_string(), toml::Value::Array(desired_values));
        save_toml_file(&config_path, &config)?;
        return Ok(format!(
            "已配置 Codex Windows notify: {}",
            config_path.display()
        ));
    }

    Ok(format!(
        "Codex Windows notify 已是最新: {}",
        config_path.display()
    ))
}

#[cfg(unix)]
fn ensure_codex_hook_settings() -> Result<String, String> {
    let hooks_path =
        resolve_provider_file_path("codex", "", "hooks.json").ok_or("无法解析 Codex 配置目录")?;
    let mut hooks = load_json_file(&hooks_path)?;
    let specs = hook_specs(HookSource::Codex)?;
    let changed = merge_hook_specs(
        &mut hooks,
        HookSource::Codex,
        &specs,
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

#[cfg(not(unix))]
fn ensure_codex_hook_settings() -> Result<String, String> {
    ensure_codex_notify_settings()
}

#[tauri::command]
pub fn setup_claude_hooks() -> Result<String, String> {
    ensure_claude_hook_settings()
}

#[tauri::command]
pub fn setup_codex_hooks() -> Result<String, String> {
    #[cfg(unix)]
    {
        let feature = ensure_codex_feature_flag()?;
        let hooks = ensure_codex_hook_settings()?;
        return Ok(format!("{feature}\n{hooks}"));
    }

    #[cfg(not(unix))]
    {
        let notify = ensure_codex_hook_settings()?;
        return Ok(format!(
            "Codex 官方文档当前声明 Windows hooks 已禁用；已改为配置 notify。\n{notify}"
        ));
    }

    #[allow(unreachable_code)]
    Ok(String::new())
}

#[tauri::command]
pub fn setup_all_hooks() -> Result<String, String> {
    let claude = ensure_claude_hook_settings()?;
    #[cfg(unix)]
    {
        let codex_feature = ensure_codex_feature_flag()?;
        let codex_hooks = ensure_codex_hook_settings()?;
        return Ok(format!("{claude}\n{codex_feature}\n{codex_hooks}"));
    }

    #[cfg(not(unix))]
    {
        let codex_notify = ensure_codex_hook_settings()?;
        return Ok(format!(
            "{claude}\nCodex 官方文档当前声明 Windows hooks 已禁用；已改为配置 notify。\n{codex_notify}"
        ));
    }

    #[allow(unreachable_code)]
    Ok(claude)
}

/// 将目录写入 Claude settings.json 的 trustedDirectories
#[tauri::command]
pub fn trust_workspace(path: String) -> Result<(), String> {
    let settings_path = resolve_provider_file_path("claude-code", "", "settings.json")
        .ok_or("无法解析 Claude Code 配置目录")?;

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

fn codex_notify_message(json: &Value) -> Option<(String, String, String)> {
    let notification_type = json
        .get("type")
        .or_else(|| json.get("event"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| "Codex".to_string());

    let message = [
        json.get("message"),
        json.get("last-assistant-message"),
        json.get("last_assistant_message"),
        json.get("summary"),
        json.get("detail"),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| value.as_str())
    .map(str::trim)
    .find(|s| !s.is_empty())
    .map(ToString::to_string)
    .unwrap_or_else(|| match notification_type.as_str() {
        "agent-turn-complete" => "Codex 已完成当前回合".to_string(),
        other => format!("Codex 通知: {other}"),
    });

    Some((title, message, notification_type))
}

fn dispatch_hook_event(app: &tauri::AppHandle, source: HookSource, json: &Value) {
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
                emit_provider_session_bound(app, &routing, json);
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
                let message = json.get("message").and_then(|v| v.as_str()).unwrap_or("");
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
            "" => {
                // Windows 上 Codex 走 notify（无 hook_event_name），
                // 这里也要尝试绑定 provider session id，才能支持 resume。
                emit_provider_session_bound(app, &routing, json);
                if let Some((title, message, notification_type)) = codex_notify_message(json) {
                    emit_session_lifecycle(
                        app,
                        routing,
                        SessionLifecycleSignal::Attention {
                            title,
                            message,
                            notification_type,
                        },
                    );
                }
            }
            "UserPromptSubmit" => {
                emit_provider_session_bound(app, &routing, json);
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Running);
            }
            "Stop" => {
                emit_session_lifecycle(app, routing, SessionLifecycleSignal::Waiting);
            }
            _ => {}
        },
    }
}

#[cfg(unix)]
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

#[cfg(not(unix))]
fn start_hook_socket_server(app: tauri::AppHandle, source: HookSource) {
    use std::net::{Ipv4Addr, SocketAddr, TcpListener};

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, source.tcp_port()));
    let listener = match TcpListener::bind(addr) {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("[hooks:{}] bind {} 失败: {e}", source.label(), addr);
            return;
        }
    };

    eprintln!("[hooks:{}] listening on {}", source.label(), addr);

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

            let payload = payload.trim();
            if payload.is_empty() {
                continue;
            }

            let json: Value = match serde_json::from_str(payload) {
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
    session_id: Option<String>,
) -> Result<(), String> {
    crate::notification::send_notification_with_callback(
        app,
        title,
        body,
        None,
        Some(true),
        session_id,
    )
}
