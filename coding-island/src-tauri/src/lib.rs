use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
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

// ── PTY 注册表：session_id → PTY master writer ───────────────
type PtyWriterMap = Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>;
// PTY child killer：session_id → kill handle
type PtyKillerMap = Arc<Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>>;
// PTY master：session_id → MasterPty（用于 resize）
type PtyMasterMap = Arc<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>>;

// ── Popup 可见状态 ───
struct PopupVisible(Mutex<bool>);
impl PopupVisible {
    fn new(v: bool) -> Self { Self(Mutex::new(v)) }
    fn get(&self) -> bool { *self.0.lock().unwrap() }
    fn set(&self, v: bool) { *self.0.lock().unwrap() = v; }
}

fn process_map(app: &tauri::AppHandle) -> ProcessMap {
    app.state::<ProcessMap>().inner().clone()
}

// ── 窗口管理 ─────────────────────────────────────────────────

fn show_popup(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    position_popup(win);
    let _ = win.show();

    // macOS: 使用 makeKeyAndOrderFront 让弹窗成为 key window
    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::nil;
        let ns_window = win.ns_window().expect("ns_window") as cocoa::base::id;
        let _: () = objc::msg_send![ns_window, makeKeyAndOrderFront: nil];
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = win.set_focus(); }

    app.state::<PopupVisible>().set(true);
    eprintln!("[popup] shown");
}

fn toggle_popup(app: &tauri::AppHandle) {
    eprintln!("[popup] toggle_popup called");

    if let Some(win) = app.get_webview_window("popup") {
        // 以窗口真实可见性为准，PopupVisible 仅辅助记录；两者不一致时以真实值兜底
        let really_visible = win.is_visible().unwrap_or(false);
        let state_visible  = app.state::<PopupVisible>().get();
        let is_visible = really_visible || state_visible;
        eprintln!("[popup] window exists, really_visible={really_visible} state_visible={state_visible}");

        if is_visible {
            eprintln!("[popup] hiding");
            app.state::<PopupVisible>().set(false);
            let _ = win.hide();
        } else {
            eprintln!("[popup] showing");
            show_popup(app, &win);
        }
    } else {
        eprintln!("[popup] window not found, creating");
        create_popup(app);
    }
}

fn create_popup(app: &tauri::AppHandle) {
    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(376.0, 600.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .expect("Failed to create popup window");

    #[cfg(target_os = "macos")]
    setup_popup_window(&win);

    show_popup(app, &win);
}

fn position_popup(win: &tauri::WebviewWindow) {
    // current_monitor() 在窗口隐藏时可能返回 None，改用 primary_monitor()
    let monitor_opt = win.primary_monitor().ok().flatten()
        .or_else(|| win.available_monitors().ok()?.into_iter().next());

    if let Some(monitor) = monitor_opt {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        let win_w = 376.0_f64;
        let x = screen_w - win_w;
        let y = 28.0;
        eprintln!("[popup] position => x={x} y={y} screen_w={screen_w} scale={scale}");
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    } else {
        eprintln!("[popup] WARNING: no monitor found, using fallback position");
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: 800.0, y: 28.0 }));
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

        // NSWindowCollectionBehavior:
        //   1   = CanJoinAllSpaces
        //   16  = FullScreenAuxiliary
        //   64  = Stationary
        //   128 = IgnoresCycle (不出现在 Cmd+Tab)
        let behavior: u64 = 1 | 16 | 64 | 128;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

        // NSFloatingWindowLevel = 3：浮动窗口级别
        // 输入法候选窗口（kCGAssistiveTechHighWindowLevel ≈ 1500）远高于此，
        // 因此候选框会自然地显示在我们弹窗上方而不被遮挡。
        // 同时仍然高于普通应用窗口（0），确保弹窗不被其他应用遮住。
        let _: () = msg_send![ns_window, setLevel: 3_i64];

        // hidesOnDeactivate = false 防止切换应用时弹窗消失
        let _: () = msg_send![ns_window, setHidesOnDeactivate: NO];
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
fn close_popup(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    app.state::<PopupVisible>().set(false);
    let _ = window.hide();
}

#[tauri::command]
fn resize_popup(window: tauri::WebviewWindow, height: f64) {
    let h = height.clamp(240.0, 720.0);
    // 使用 Tauri 原生 API：先 set_size，再 set_position
    // 不使用 cocoa setFrame_display_ 以避免触发 NSWindow focus-loss
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: 376.0,
        height: h,
    }));
    // 重新定位：保持右上角贴屏幕顶
    let monitor_opt = window.primary_monitor().ok().flatten()
        .or_else(|| window.available_monitors().ok()?.into_iter().next());
    if let Some(monitor) = monitor_opt {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        let x = screen_w - 376.0;
        let y = 28.0;
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
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
            // --print 启用非交互模式（新版替代 --no-pager）
            // --output-format stream-json 仅在 --print 模式下有效
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

/// 调用系统文件夹选择对话框，返回用户选中的路径（取消返回空字符串）
#[tauri::command]
fn pick_folder() -> String {
    // 用 osascript 弹出 macOS 原生文件夹选择器（无需额外权限，不需要在主线程）
    let script = r#"
        set folderPath to POSIX path of (choose folder with prompt "选择工作目录")
        return folderPath
    "#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).trim().trim_end_matches('/').to_string()
        }
        _ => String::new(),
    }
}

/// 展开模式：同时调整宽度和高度（用于显示终端面板）
/// 注意：使用 Tauri 原生 API 避免 setFrame_display_ 触发 macOS focus-loss
#[tauri::command]
fn resize_popup_full(window: tauri::WebviewWindow, width: f64, height: f64) {
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));

    // 重新定位：保持右上角贴屏幕顶
    let monitor_opt = window.primary_monitor().ok().flatten()
        .or_else(|| window.available_monitors().ok()?.into_iter().next());
    if let Some(monitor) = monitor_opt {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        let x = screen_w - width - 8.0;
        let y = 28.0;
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
}

// ── PTY Commands ─────────────────────────────────────────────

fn pty_writer_map(app: &tauri::AppHandle) -> PtyWriterMap {
    app.state::<PtyWriterMap>().inner().clone()
}

fn pty_killer_map(app: &tauri::AppHandle) -> PtyKillerMap {
    app.state::<PtyKillerMap>().inner().clone()
}

fn pty_master_map(app: &tauri::AppHandle) -> PtyMasterMap {
    app.state::<PtyMasterMap>().inner().clone()
}

/// 启动 PTY 会话（用于 Claude Code / 任意 CLI），原始字节流推送给前端
#[tauri::command]
async fn start_pty_session(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use base64::Engine;

    let expanded = expand_path(&workdir);

    // 先停掉同 session 的旧 PTY
    {
        let km = pty_killer_map(&app);
        let mut km = km.lock().unwrap();
        if let Some(mut old) = km.remove(&session_id) {
            let _ = old.kill();
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    let mut cmd = CommandBuilder::new(&command);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.cwd(&expanded);

    // 继承常用环境变量（确保 CLI 工具可用）
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }

    let child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("spawn 失败: {e}"))?;

    // 先把 reader clone 出来（在 take_writer 之前）
    let mut master_reader = pair.master.try_clone_reader()
        .map_err(|e| format!("clone_reader 失败: {e}"))?;

    // 保存 writer、child 和 master（用于 resize）
    let master_writer = pair.master.take_writer()
        .map_err(|e| format!("take_writer 失败: {e}"))?;
    {
        let wm = pty_writer_map(&app);
        let mut wm = wm.lock().unwrap();
        wm.insert(session_id.clone(), master_writer);
    }
    {
        let km = pty_killer_map(&app);
        let mut km = km.lock().unwrap();
        km.insert(session_id.clone(), child);
    }
    {
        let mm = pty_master_map(&app);
        let mut mm = mm.lock().unwrap();
        mm.insert(session_id.clone(), pair.master);
    }
    let app_r = app.clone();
    let sid_r = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match master_reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_r.emit(
                        "pty-data",
                        serde_json::json!({ "session_id": sid_r, "data": b64 }),
                    );
                }
            }
        }
        let _ = app_r.emit(
            "pty-exit",
            serde_json::json!({ "session_id": sid_r }),
        );
    });

    Ok(())
}

/// 向 PTY 写入数据（键盘输入）
#[tauri::command]
fn write_pty(
    app: tauri::AppHandle,
    session_id: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
    let wm = pty_writer_map(&app);
    let mut wm = wm.lock().unwrap();
    if let Some(writer) = wm.get_mut(&session_id) {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&data)
            .map_err(|e| format!("base64 decode 失败: {e}"))?;
        writer.write_all(&bytes).map_err(|e| format!("write 失败: {e}"))?;
    }
    Ok(())
}

/// 调整 PTY 大小（窗口 resize）
#[tauri::command]
fn resize_pty(
    app: tauri::AppHandle,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use portable_pty::PtySize;
    // 防御：cols/rows 为 0 时跳过（面板收起时容器尺寸可能变为 0，
    // 传 0 给 TIOCSWINSZ 可能导致进程收到 SIGWINCH 后异常退出）
    let cols = cols.max(20);
    let rows = rows.max(5);
    let mm = pty_master_map(&app);
    let mm = mm.lock().unwrap();
    if let Some(master) = mm.get(&session_id) {
        master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize_pty 失败: {e}"))?;
    }
    Ok(())
}

/// 将目录写入 ~/.claude/settings.json 的 trustedDirectories，
/// 避免 claude 启动时弹出"是否信任此文件夹"对话框。
#[tauri::command]
fn trust_workspace(path: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量")?;
    let settings_path = std::path::PathBuf::from(home)
        .join(".claude")
        .join("settings.json");

    // 读取现有配置（不存在则用空对象）
    let content = if settings_path.exists() {
        std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    let mut json: serde_json::Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    // 确保 trustedDirectories 字段存在且为数组
    let trusted = json
        .as_object_mut()
        .ok_or("settings.json 格式错误")?
        .entry("trustedDirectories")
        .or_insert(serde_json::json!([]));

    if let serde_json::Value::Array(arr) = trusted {
        // 去重：只有不存在时才插入
        let already = arr.iter().any(|v| v.as_str() == Some(&path));
        if !already {
            arr.push(serde_json::Value::String(path));
        }
    }

    // 写回（pretty print 保持可读性）
    let out = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    // 确保目录存在
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&settings_path, out).map_err(|e| e.to_string())?;

    Ok(())
}

/// 停止 PTY 会话
#[tauri::command]
fn stop_pty_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    {
        let km = pty_killer_map(&app);
        let mut km = km.lock().unwrap();
        if let Some(mut child) = km.remove(&session_id) {
            let _ = child.kill();
        }
    }
    {
        let wm = pty_writer_map(&app);
        let mut wm = wm.lock().unwrap();
        wm.remove(&session_id);
    }
    {
        let mm = pty_master_map(&app);
        let mut mm = mm.lock().unwrap();
        mm.remove(&session_id);
    }
    let _ = app.emit("pty-exit", serde_json::json!({ "session_id": session_id }));
    Ok(())
}

// ── 入口 ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessMap::default())
        .manage(PtyWriterMap::default())
        .manage(PtyKillerMap::default())
        .manage(PtyMasterMap::default())
        .manage(PopupVisible::new(false))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 隐藏默认主窗口（tauri.conf.json 里的 main window）
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.hide();
            }

            // ── 预创建 popup（visible=false）：让 WebView 在后台完成加载 ──
            // 这样首次点击菜单栏图标时不需要等待窗口创建 + WebView 初始化，
            // 避免时序问题（show_popup 时窗口尚未就绪 → focus-loss → 立即隐藏）
            let win = WebviewWindowBuilder::new(
                app.handle(),
                "popup",
                WebviewUrl::App("index.html".into()),
            )
            .title("")
            .inner_size(376.0, 600.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .expect("Failed to pre-create popup window");

            #[cfg(target_os = "macos")]
            setup_popup_window(&win);

            // 不在失焦时自动隐藏：macOS 菜单栏应用点击图标后系统会把焦点还给前台应用
            // 改由菜单栏图标点击切换，或前端 Esc/点击外部关闭

            // ── 系统托盘 ──
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 窗口
            close_popup,
            resize_popup,
            resize_popup_full,
            pick_folder,
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
            // PTY 终端
            start_pty_session,
            write_pty,
            resize_pty,
            stop_pty_session,
            // Claude 信任目录
            trust_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
