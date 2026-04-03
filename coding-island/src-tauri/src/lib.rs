use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

// ── 全局子进程注册表 ─────────────────────────────────────────
type ProcessMap = Arc<Mutex<HashMap<String, Child>>>;

fn process_map(app: &tauri::AppHandle) -> ProcessMap {
    app.state::<ProcessMap>().inner().clone()
}

// ── 窗口管理 ─────────────────────────────────────────────────

fn toggle_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            position_popup(&win);
            let _ = win.show();
            let _ = win.set_focus();
        }
    } else {
        create_popup(app);
    }
}

fn create_popup(app: &tauri::AppHandle) {
    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(360.0, 240.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .expect("Failed to create popup window");

    position_popup(&win);

    #[cfg(target_os = "macos")]
    setup_popup_window(&win);

    let _ = win.show();
    let _ = win.set_focus();

    let win_clone = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = win_clone.hide();
        }
    });
}

fn position_popup(win: &tauri::WebviewWindow) {
    if let Some(monitor) = win.current_monitor().ok().flatten() {
        let screen_w = monitor.size().width as f64 / monitor.scale_factor();
        let win_w = 376.0_f64;
        let x = screen_w - win_w - 0.0;
        let y = 28.0;
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
}

#[cfg(target_os = "macos")]
fn setup_popup_window(win: &tauri::WebviewWindow) {
    use cocoa::base::NO;
    unsafe {
        let ns_window = win.ns_window().expect("ns_window") as cocoa::base::id;
        let _: () = msg_send![ns_window, setOpaque: NO];
        let clear: cocoa::base::id = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];
        let behavior: u64 = 1 | 16 | 64 | 256;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setLevel: 26_i64];
    }
}

// ── 路径工具 ─────────────────────────────────────────────────

fn expand_path(path: &str) -> String {
    if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        path.replacen("~", &home, 1)
    } else {
        path.to_string()
    }
}

fn find_cli_path(runner_type: &str, custom_path: &str) -> String {
    if !custom_path.is_empty() {
        return custom_path.to_string();
    }
    let bin_name = match runner_type {
        "claude-code" => "claude",
        "codex" => "codex",
        _ => return custom_path.to_string(),
    };
    let candidates = [
        format!("/usr/local/bin/{bin_name}"),
        format!("/opt/homebrew/bin/{bin_name}"),
        format!("/usr/bin/{bin_name}"),
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.clone();
        }
    }
    if let Ok(out) = Command::new("which").arg(bin_name).output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return p;
        }
    }
    bin_name.to_string()
}

// ── Tauri Commands — 窗口控制 ─────────────────────────────────

#[tauri::command]
fn close_popup(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn resize_popup(window: tauri::WebviewWindow, height: f64) {
    let h = height.clamp(240.0, 720.0);

    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSScreen;
        use cocoa::base::{nil, YES};
        use cocoa::foundation::{NSPoint, NSRect, NSSize};
        unsafe {
            let ns_window = window.ns_window().expect("ns_window") as cocoa::base::id;
            let main_screen = NSScreen::mainScreen(nil);
            if main_screen == nil {
                return;
            }
            let screen_frame: NSRect = NSScreen::frame(main_screen);
            let cur = cocoa::appkit::NSWindow::frame(ns_window);
            let new_y = (screen_frame.size.height - 28.0) - h - 4.0;
            let frame = NSRect::new(
                NSPoint::new(cur.origin.x, new_y),
                NSSize::new(cur.size.width, h),
            );
            cocoa::appkit::NSWindow::setFrame_display_(ns_window, frame, YES);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 376.0,
            height: h,
        }));
    }
}

// ── Tauri Commands — API Key 安全存储 ──────────────────────────

/// 将 API Key 写入 macOS Keychain（简化版：存本地加密文件）
#[tauri::command]
async fn save_api_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
) -> Result<(), String> {
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&key_dir).map_err(|e| e.to_string())?;

    // 用简单的 XOR 混淆（生产环境应接入 macOS Keychain）
    let obfuscated: Vec<u8> = key.bytes().enumerate().map(|(i, b)| b ^ (i as u8 ^ 0xA5)).collect();
    let hex = obfuscated.iter().map(|b| format!("{b:02x}")).collect::<String>();

    let key_file = key_dir.join(format!(".key_{provider}"));
    fs::write(key_file, hex).map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取保存的 API Key
#[tauri::command]
async fn load_api_key(
    app: tauri::AppHandle,
    provider: String,
) -> Result<String, String> {
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let key_file = key_dir.join(format!(".key_{provider}"));

    if !key_file.exists() {
        return Ok(String::new());
    }

    let hex = fs::read_to_string(key_file).map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect();
    let key: String = bytes
        .into_iter()
        .enumerate()
        .map(|(i, b)| (b ^ (i as u8 ^ 0xA5)) as char)
        .collect();
    Ok(key)
}

// ── Tauri Commands — 统一 Runner 路由 ────────────────────────

/// 启动任意 Runner（claude-code / codex / custom-cli）
#[tauri::command]
async fn start_runner(
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

    // 发送 running 状态
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

    // 按 Runner 类型设置参数
    match runner_type.as_str() {
        "claude-code" => {
            cmd.arg("--output-format")
                .arg("stream-json")
                .arg("--no-pager")
                .arg(&task);
        }
        "codex" => {
            cmd.arg("--non-interactive")
                .arg("--no-color")
                .arg(&task);
        }
        "custom-cli" => {
            // 附加用户自定义参数
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
        let _ = app_out.emit(
            "runner-done",
            serde_json::json!({"session_id": sid_out}),
        );
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
fn stop_runner(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let map = process_map(&app);
    let mut map = map.lock().unwrap();
    if let Some(mut child) = map.remove(&session_id) {
        let _ = child.kill();
        let _ = app.emit(
            "runner-done",
            serde_json::json!({"session_id": session_id}),
        );
    }
    Ok(())
}

// ── Tauri Commands — 兼容旧接口 ─────────────────────────────

#[tauri::command]
async fn start_claude_session(
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
fn stop_claude_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    stop_runner(app, session_id)
}

#[tauri::command]
async fn get_git_diff(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    let files = get_git_diff_raw(&expanded)?;
    let _ = app.emit(
        "diff-update",
        serde_json::json!({"session_id": session_id, "files": files}),
    );
    Ok(())
}

// ── Tauri Commands — NativeHarness 工具 ──────────────────────

/// 读取文件（相对于 workdir）
#[tauri::command]
async fn harness_read_file(workdir: String, path: String) -> Result<String, String> {
    let full = PathBuf::from(expand_path(&workdir)).join(&path);
    fs::read_to_string(&full).map_err(|e| format!("读取 {path} 失败: {e}"))
}

/// 写入文件（相对于 workdir）
#[tauri::command]
async fn harness_write_file(
    workdir: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let full = PathBuf::from(expand_path(&workdir)).join(&path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let mut file = fs::File::create(&full).map_err(|e| format!("创建文件失败: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))
}

/// 列出目录内容
#[tauri::command]
async fn harness_list_dir(workdir: String, path: String) -> Result<Vec<String>, String> {
    let full = PathBuf::from(expand_path(&workdir)).join(if path.is_empty() { "." } else { &path });
    let entries = fs::read_dir(&full).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut result = vec![];
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.path().is_dir();
        result.push(if is_dir { format!("{name}/") } else { name });
    }
    result.sort();
    Ok(result)
}

/// 执行 Shell 命令
#[tauri::command]
async fn harness_run_command(
    workdir: String,
    command: String,
) -> Result<serde_json::Value, String> {
    let expanded = expand_path(&workdir);
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("执行失败: {e}"))?;

    Ok(serde_json::json!({
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        "exit_code": output.status.code().unwrap_or(-1),
    }))
}

/// 获取 git diff 原始文本
#[tauri::command]
async fn harness_git_diff(workdir: String, staged: bool) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    let args = if staged {
        vec!["diff", "--cached"]
    } else {
        vec!["diff"]
    };
    let output = Command::new("git")
        .args(&args)
        .current_dir(&expanded)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 弹出系统确认对话框
#[tauri::command]
async fn harness_confirm(title: String, message: String) -> Result<bool, String> {
    // 使用 osascript 弹出 macOS 原生对话框
    let script = format!(
        r#"display dialog "{message}" with title "{title}" buttons {{"取消", "确认"}} default button "确认""#
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

// ── 工具函数 ─────────────────────────────────────────────────

fn parse_claude_line(line: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
        if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
            return content.to_string();
        }
        if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
        return line.to_string();
    }
    line.to_string()
}

fn get_git_diff_raw(workdir: &str) -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("git")
        .current_dir(workdir)
        .args(["diff", "--numstat", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = vec![];

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let additions = parts[0].parse::<u32>().unwrap_or(0);
        let deletions = parts[1].parse::<u32>().unwrap_or(0);
        let path = parts[2].to_string();
        let hunks = get_file_hunks(workdir, &path);
        let file_type = if additions > 0 && deletions == 0 {
            "added"
        } else if additions == 0 && deletions > 0 {
            "deleted"
        } else {
            "modified"
        };
        files.push(serde_json::json!({
            "path": path,
            "type": file_type,
            "additions": additions,
            "deletions": deletions,
            "hunks": hunks,
        }));
    }

    Ok(files)
}

fn get_file_hunks(workdir: &str, path: &str) -> Vec<serde_json::Value> {
    let output = Command::new("git")
        .current_dir(workdir)
        .args(["diff", "HEAD", "--", path])
        .output();
    let Ok(out) = output else { return vec![] };
    parse_diff_hunks(&String::from_utf8_lossy(&out.stdout))
}

fn parse_diff_hunks(diff: &str) -> Vec<serde_json::Value> {
    let mut hunks = vec![];
    let mut current_hunk: Option<(String, Vec<serde_json::Value>)> = None;
    let mut old_line = 0u32;
    let mut new_line = 0u32;

    for line in diff.lines() {
        if line.starts_with("@@") {
            if let Some((header, lines)) = current_hunk.take() {
                hunks.push(serde_json::json!({ "header": header, "lines": lines }));
            }
            let parts: Vec<&str> = line.split(' ').collect();
            if parts.len() >= 3 {
                let old_part = parts[1].trim_start_matches('-');
                let new_part = parts[2].trim_start_matches('+');
                old_line = old_part
                    .split(',')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1);
                new_line = new_part
                    .split(',')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1);
            }
            current_hunk = Some((line.to_string(), vec![]));
        } else if let Some((_, ref mut lines)) = current_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                lines.push(serde_json::json!({
                    "type": "added",
                    "content": &line[1..],
                    "newLineNo": new_line,
                }));
                new_line += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                lines.push(serde_json::json!({
                    "type": "deleted",
                    "content": &line[1..],
                    "oldLineNo": old_line,
                }));
                old_line += 1;
            } else if !line.starts_with('\\') {
                lines.push(serde_json::json!({
                    "type": "context",
                    "content": if line.is_empty() { "" } else { &line[1..] },
                    "oldLineNo": old_line,
                    "newLineNo": new_line,
                }));
                old_line += 1;
                new_line += 1;
            }
        }
    }
    if let Some((header, lines)) = current_hunk {
        hunks.push(serde_json::json!({ "header": header, "lines": lines }));
    }
    hunks
}

// ── 入口 ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessMap::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Coding Island")
                .build(app)?;

            let app_handle = app.handle().clone();
            tray.on_tray_icon_event(move |_tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_popup(&app_handle);
                }
            });

            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.hide();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 窗口
            close_popup,
            resize_popup,
            // API Key
            save_api_key,
            load_api_key,
            // 统一 Runner
            start_runner,
            stop_runner,
            // 兼容旧接口
            start_claude_session,
            stop_claude_session,
            get_git_diff,
            // NativeHarness 工具
            harness_read_file,
            harness_write_file,
            harness_list_dir,
            harness_run_command,
            harness_git_diff,
            harness_confirm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
