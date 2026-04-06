use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
};

use tauri::{Emitter, Manager};

use crate::{
    git::diff::get_git_diff_raw,
    state::ProcessMap,
    util::{expand_path, find_cli_path},
};

// ── 辅助：从 AppHandle 取出 ProcessMap ───────────────────────────

fn process_map(app: &tauri::AppHandle) -> ProcessMap {
    app.state::<ProcessMap>().inner().clone()
}

// ── claude-code 输出解析 ──────────────────────────────────────────

/// 将 claude-code stream-json 行解析为可读文本
pub fn parse_claude_line(line: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
        if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
            return content.to_string();
        }
        if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    line.to_string()
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 启动任意 Runner（claude-code / codex / custom-cli）
#[tauri::command]
pub async fn start_runner(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
    task: String,
    runner_type: String,
    cli_path: String,
    cli_args: String,
) -> Result<(), String> {
    let expanded_dir = expand_path(&workdir);
    let bin = find_cli_path(&runner_type, &cli_path);

    let _ = app.emit(
        "runner-output",
        serde_json::json!({
            "session_id": session_id,
            "line": format!("🚀 启动 {runner_type} ({bin})")
        }),
    );

    let mut cmd = Command::new(&bin);
    cmd.current_dir(&expanded_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match runner_type.as_str() {
        "claude-code" => {
            // 读取 ~/.claude/settings.json 中的 env 字段并注入子进程
            let mut model_from_settings: Option<String> = None;
            if let Ok(home) = std::env::var("HOME") {
                let settings_path = std::path::PathBuf::from(&home)
                    .join(".claude")
                    .join("settings.json");
                if let Ok(content) = std::fs::read_to_string(&settings_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(env_obj) = json.get("env").and_then(|v| v.as_object()) {
                            for (k, v) in env_obj {
                                if let Some(val) = v.as_str() {
                                    if k == "ANTHROPIC_MODEL" {
                                        model_from_settings = Some(val.to_string());
                                    }
                                    cmd.env(k, val);
                                }
                            }
                        }
                    }
                }
            }

            // cli_args 中的 --model 优先级最高，其次 settings.json，最后默认值
            let model_from_args = cli_args
                .split_whitespace()
                .collect::<Vec<_>>()
                .windows(2)
                .find(|w| w[0] == "--model")
                .map(|w| w[1].to_string());
            let model = model_from_args
                .or(model_from_settings)
                .unwrap_or_else(|| "glm-4-flash".to_string());
            cmd.env("ANTHROPIC_MODEL", &model);

            cmd.arg("--print")
                .arg("--output-format")
                .arg("stream-json")
                .arg(&task);
        }
        "codex" => {
            cmd.arg("--non-interactive")
                .arg("--no-color")
                .arg(&task);
        }
        "custom-cli" => {
            for arg in cli_args.split_whitespace() {
                cmd.arg(arg);
            }
            cmd.arg(&task);
        }
        _ => {
            cmd.arg(&task);
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("启动失败: {e}（命令: {bin}）");
        let _ = app.emit(
            "runner-done",
            serde_json::json!({"session_id": session_id, "error": msg}),
        );
        msg
    })?;

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    {
        let map = process_map(&app);
        let mut map = map.lock().unwrap();
        map.insert(session_id.clone(), child);
    }

    // 异步读取 stdout
    let app_out = app.clone();
    let sid_out = session_id.clone();
    let rtype_out = runner_type.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let display = if rtype_out == "claude-code" {
                parse_claude_line(&line)
            } else {
                line
            };
            let _ = app_out.emit(
                "runner-output",
                serde_json::json!({"session_id": sid_out, "line": display}),
            );
        }
        let _ = app_out.emit("runner-done", serde_json::json!({"session_id": sid_out}));
    });

    // 异步读取 stderr
    let app_err = app.clone();
    let sid_err = session_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = app_err.emit(
                "runner-output",
                serde_json::json!({"session_id": sid_err, "line": format!("[stderr] {line}")}),
            );
        }
    });

    // 启动后延迟刷新 diff
    let app_diff = app.clone();
    let sid_diff = session_id.clone();
    let dir_diff = expanded_dir.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if let Ok(diff) = get_git_diff_raw(&dir_diff) {
            let _ = app_diff.emit(
                "diff-update",
                serde_json::json!({"session_id": sid_diff, "files": diff}),
            );
        }
    });

    Ok(())
}

/// 停止 Runner 子进程
#[tauri::command]
pub fn stop_runner(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let map = process_map(&app);
    let mut map = map.lock().unwrap();
    if let Some(mut child) = map.remove(&session_id) {
        let _ = child.kill();
        let _ = app.emit("runner-done", serde_json::json!({"session_id": session_id}));
    }
    Ok(())
}

// ── 兼容旧接口 ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_claude_session(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
) -> Result<(), String> {
    start_runner(
        app,
        session_id,
        workdir,
        String::new(),
        "claude-code".to_string(),
        String::new(),
        String::new(),
    )
    .await
}

#[tauri::command]
pub fn stop_claude_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    stop_runner(app, session_id)
}
