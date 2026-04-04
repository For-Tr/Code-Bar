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
    // 通知前端弹窗已显示，前端据此重置展开状态（收起任何打开的 Terminal 面板）
    let _ = win.emit("popup-shown", ());
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
        let path = parts[2].to_string();

        // 二进制文件在 --numstat 输出中 additions/deletions 均为 "-"
        let is_binary = parts[0] == "-" && parts[1] == "-";
        let additions = if is_binary { 0 } else { parts[0].parse::<u32>().unwrap_or(0) };
        let deletions = if is_binary { 0 } else { parts[1].parse::<u32>().unwrap_or(0) };

        // 文件类型：二进制文件统一标记为 modified（numstat 无法区分 added/deleted 二进制）
        let file_type = if is_binary {
            "modified"
        } else if additions > 0 && deletions == 0 {
            "added"
        } else if additions == 0 && deletions > 0 {
            "deleted"
        } else {
            "modified"
        };

        let (hunks, note) = if is_binary {
            (vec![], None)
        } else {
            get_file_hunks(workdir, &path)
        };

        let mut entry = serde_json::json!({
            "path": path,
            "type": file_type,
            "additions": additions,
            "deletions": deletions,
            "binary": is_binary,
            "hunks": hunks,
        });
        if let Some(n) = note {
            entry["note"] = serde_json::Value::String(n);
        }
        files.push(entry);
    }

    Ok(files)
}

/// 返回 (hunks, note)：hunks 为解析到的 diff 块，note 为无 hunk 时的说明（如权限变更）
fn get_file_hunks(workdir: &str, path: &str) -> (Vec<serde_json::Value>, Option<String>) {
    let output = Command::new("git")
        .current_dir(workdir)
        .args(["diff", "HEAD", "--", path])
        .output();
    let Ok(out) = output else { return (vec![], None) };
    let diff_text = String::from_utf8_lossy(&out.stdout);
    let hunks = parse_diff_hunks(&diff_text);
    // 若解析出 hunk 则直接返回
    if !hunks.is_empty() {
        return (hunks, None);
    }
    // 无 hunk 时，尝试从 diff header 提取有意义的说明
    let note = parse_diff_note(&diff_text);
    (vec![], note)
}

/// 从无 hunk 的 diff 输出中提取说明性文本（权限变更、submodule、空文件等）
fn parse_diff_note(diff: &str) -> Option<String> {
    let mut old_mode: Option<&str> = None;
    let mut new_mode: Option<&str> = None;
    let mut submodule_lines: Vec<&str> = vec![];

    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("old mode ") {
            old_mode = Some(rest);
        } else if let Some(rest) = line.strip_prefix("new mode ") {
            new_mode = Some(rest);
        } else if line.starts_with("Subproject commit") || line.starts_with("-Subproject commit") {
            submodule_lines.push(line);
        }
    }

    if let (Some(old), Some(new)) = (old_mode, new_mode) {
        return Some(format!("文件权限变更：{old} → {new}"));
    }
    if !submodule_lines.is_empty() {
        return Some("Submodule 提交变更".to_string());
    }
    if diff.contains("diff --git") {
        // diff 头存在但没有任何可解析内容
        return Some("仅元数据变更（无内容差异）".to_string());
    }
    None
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

// ── Tauri Commands — Git 分支管理 ────────────────────────────

/// 获取当前所在分支名
#[tauri::command]
async fn git_current_branch(workdir: String) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }).await.map_err(|e| e.to_string())?
}

/// 创建并切换到新分支（基于当前 HEAD）
#[tauri::command]
async fn git_branch_create(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["checkout", "-b", &branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 切换到指定分支
#[tauri::command]
async fn git_branch_switch(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["checkout", &branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 删除指定分支（-D 强制删除）
#[tauri::command]
async fn git_branch_delete(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["branch", "-D", &branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 将 session 分支 merge 回目标分支（--no-ff 保留分支历史）
#[tauri::command]
async fn git_branch_merge(workdir: String, target_branch: String, session_branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        // 先切换到目标分支
        let switch = Command::new("git")
            .current_dir(&expanded)
            .args(["checkout", &target_branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !switch.status.success() {
            return Err(format!("切换到 {target_branch} 失败: {}",
                String::from_utf8_lossy(&switch.stderr).trim()));
        }
        // 执行 merge
        let merge = Command::new("git")
            .current_dir(&expanded)
            .args(["merge", "--no-ff", &session_branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !merge.status.success() {
            return Err(format!("merge 失败: {}",
                String::from_utf8_lossy(&merge.stderr).trim()));
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 获取两个分支之间的 diff（base..session），返回结构化文件列表
#[tauri::command]
async fn get_git_diff_branch(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
    base_branch: String,
    session_branch: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    let files = get_git_diff_between(&expanded, &base_branch, &session_branch)?;
    let _ = app.emit(
        "diff-update",
        serde_json::json!({"session_id": session_id, "files": files}),
    );
    Ok(())
}

/// 计算 base_branch...session_branch 之间的变更文件（三点 diff，排除 base 上的变更）
fn get_git_diff_between(workdir: &str, base: &str, session: &str) -> Result<Vec<serde_json::Value>, String> {
    // 用 git diff --numstat base...session（三点：共同祖先到 session 的变更）
    let range = format!("{base}...{session}");
    let numstat = Command::new("git")
        .current_dir(workdir)
        .args(["diff", "--numstat", &range])
        .output()
        .map_err(|e| e.to_string())?;

    if !numstat.status.success() {
        return Err(String::from_utf8_lossy(&numstat.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&numstat.stdout);
    let mut files = vec![];

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 { continue; }

        let path = parts[2].to_string();
        let is_binary = parts[0] == "-" && parts[1] == "-";
        let additions = if is_binary { 0 } else { parts[0].parse::<u32>().unwrap_or(0) };
        let deletions = if is_binary { 0 } else { parts[1].parse::<u32>().unwrap_or(0) };

        let file_type = if is_binary {
            "modified"
        } else if additions > 0 && deletions == 0 {
            "added"
        } else if additions == 0 && deletions > 0 {
            "deleted"
        } else {
            "modified"
        };

        let (hunks, note) = if is_binary {
            (vec![], None)
        } else {
            get_file_hunks_between(workdir, &range, &path)
        };

        let mut entry = serde_json::json!({
            "path": path,
            "type": file_type,
            "additions": additions,
            "deletions": deletions,
            "binary": is_binary,
            "hunks": hunks,
        });
        if let Some(n) = note {
            entry["note"] = serde_json::Value::String(n);
        }
        files.push(entry);
    }

    Ok(files)
}

// ── Tauri Commands — Git Worktree 管理 ───────────────────────

/// 创建 git worktree（基于当前 HEAD 创建新分支并 checkout 到指定路径）
/// 返回 worktree 的绝对路径
#[tauri::command]
async fn git_worktree_create(
    workdir: String,
    branch: String,
    worktree_path: String,
) -> Result<String, String> {
    let expanded_workdir = expand_path(&workdir);
    let expanded_wt_path = expand_path(&worktree_path);

    tokio::task::spawn_blocking(move || {
        // 创建父目录（若不存在）
        if let Some(parent) = std::path::Path::new(&expanded_wt_path).parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }

        // git worktree add -b <branch> <path> HEAD
        let out = Command::new("git")
            .current_dir(&expanded_workdir)
            .args(["worktree", "add", "-b", &branch, &expanded_wt_path, "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }

        Ok(expanded_wt_path)
    }).await.map_err(|e| e.to_string())?
}

/// 删除 git worktree（同时删除对应分支，可选）
#[tauri::command]
async fn git_worktree_remove(
    workdir: String,
    worktree_path: String,
    branch: String,
    delete_branch: bool,
) -> Result<(), String> {
    let expanded_workdir = expand_path(&workdir);
    let expanded_wt_path = expand_path(&worktree_path);

    tokio::task::spawn_blocking(move || {
        // git worktree remove --force <path>
        let out = Command::new("git")
            .current_dir(&expanded_workdir)
            .args(["worktree", "remove", "--force", &expanded_wt_path])
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            // worktree remove 失败时尝试手动清理目录
            let wt_path = std::path::Path::new(&expanded_wt_path);
            if wt_path.exists() {
                fs::remove_dir_all(wt_path)
                    .map_err(|e| format!("清理 worktree 目录失败: {e}"))?;
            }
            // 修剪 worktree 引用
            let _ = Command::new("git")
                .current_dir(&expanded_workdir)
                .args(["worktree", "prune"])
                .output();
        }

        // 可选：删除对应分支
        if delete_branch && !branch.is_empty() {
            let _ = Command::new("git")
                .current_dir(&expanded_workdir)
                .args(["branch", "-D", &branch])
                .output();
        }

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 列出所有 git worktree（返回结构化信息）
#[tauri::command]
async fn git_worktree_list(workdir: String) -> Result<Vec<serde_json::Value>, String> {
    let expanded = expand_path(&workdir);

    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["worktree", "list", "--porcelain"])
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }

        let stdout = String::from_utf8_lossy(&out.stdout);
        let mut worktrees = vec![];
        let mut current: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();

        for line in stdout.lines() {
            if line.is_empty() {
                if !current.is_empty() {
                    worktrees.push(serde_json::Value::Object(current.clone()));
                    current.clear();
                }
            } else if let Some(path) = line.strip_prefix("worktree ") {
                current.insert("path".to_string(), serde_json::Value::String(path.to_string()));
            } else if let Some(hash) = line.strip_prefix("HEAD ") {
                current.insert("head".to_string(), serde_json::Value::String(hash.to_string()));
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                current.insert("branch".to_string(), serde_json::Value::String(branch.to_string()));
            } else if line == "bare" {
                current.insert("bare".to_string(), serde_json::Value::Bool(true));
            } else if line == "detached" {
                current.insert("detached".to_string(), serde_json::Value::Bool(true));
            }
        }
        // 处理最后一个 worktree（文件末尾无空行时）
        if !current.is_empty() {
            worktrees.push(serde_json::Value::Object(current));
        }

        Ok(worktrees)
    }).await.map_err(|e| e.to_string())?
}

/// 将 worktree 分支 merge 回目标分支，然后删除 worktree 和分支
#[tauri::command]
async fn git_worktree_merge(
    workdir: String,
    worktree_path: String,
    branch: String,
    target_branch: String,
) -> Result<(), String> {
    let expanded_workdir = expand_path(&workdir);
    let expanded_wt_path = expand_path(&worktree_path);

    tokio::task::spawn_blocking(move || {
        // 先 checkout 到 target_branch（在主仓库中操作）
        let switch = Command::new("git")
            .current_dir(&expanded_workdir)
            .args(["checkout", &target_branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !switch.status.success() {
            return Err(format!(
                "切换到 {} 失败: {}",
                target_branch,
                String::from_utf8_lossy(&switch.stderr).trim()
            ));
        }

        // merge --no-ff
        let merge = Command::new("git")
            .current_dir(&expanded_workdir)
            .args(["merge", "--no-ff", &branch])
            .output()
            .map_err(|e| e.to_string())?;
        if !merge.status.success() {
            return Err(format!(
                "merge 失败: {}",
                String::from_utf8_lossy(&merge.stderr).trim()
            ));
        }

        // 删除 worktree
        let _ = Command::new("git")
            .current_dir(&expanded_workdir)
            .args(["worktree", "remove", "--force", &expanded_wt_path])
            .output();

        // 若目录还在，手动清理
        let wt = std::path::Path::new(&expanded_wt_path);
        if wt.exists() {
            let _ = fs::remove_dir_all(wt);
            let _ = Command::new("git")
                .current_dir(&expanded_workdir)
                .args(["worktree", "prune"])
                .output();
        }

        // 删除 worktree 分支
        if !branch.is_empty() {
            let _ = Command::new("git")
                .current_dir(&expanded_workdir)
                .args(["branch", "-D", &branch])
                .output();
        }

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 获取指定 diff range 中单个文件的 hunks
fn get_file_hunks_between(workdir: &str, range: &str, path: &str) -> (Vec<serde_json::Value>, Option<String>) {
    let output = Command::new("git")
        .current_dir(workdir)
        .args(["diff", range, "--", path])
        .output();
    let Ok(out) = output else { return (vec![], None) };
    let diff_text = String::from_utf8_lossy(&out.stdout);
    let hunks = parse_diff_hunks(&diff_text);
    if !hunks.is_empty() {
        return (hunks, None);
    }
    let note = parse_diff_note(&diff_text);
    (vec![], note)
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

/// 检测指定 CLI 是否在 PATH 中可用
#[tauri::command]
async fn check_cli(command: String) -> bool {
    // 优先用完整路径直接检测
    if command.contains('/') || command.contains('\\') {
        return std::path::Path::new(&command).exists();
    }
    // 从 PATH 查找
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            let full = std::path::PathBuf::from(dir).join(&command);
            if full.exists() {
                return true;
            }
            // macOS/Linux：也检查带可执行权限
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&full) {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return true;
                    }
                }
            }
        }
    }
    false
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
    // 调用方可注入额外的环境变量（如 CODING_ISLAND_* context 信息）
    env: Option<Vec<(String, String)>>,
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

    // 注入调用方传入的额外环境变量（CODING_ISLAND_* context 信息）
    if let Some(extra_env) = env {
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
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

/// 自动检测系统中 Claude / OpenAI 相关配置
/// 返回结构：{ anthropic_api_key, anthropic_base_url, openai_api_key, openai_base_url,
///             claude_settings, claude_cli_path, codex_cli_path,
///             claude_oauth_logged_in (bool), claude_oauth_email (str) }
#[tauri::command]
fn detect_cli_config() -> serde_json::Value {
    let mut result = serde_json::json!({
        "anthropic_api_key":     "",
        "anthropic_base_url":    "",
        "openai_api_key":        "",
        "openai_base_url":       "",
        "claude_settings":       {},
        "claude_cli_path":       "",
        "codex_cli_path":        "",
        "claude_oauth_logged_in": false,
        "claude_oauth_email":    "",
    });

    // ── 1. Tauri 进程直接继承的环境变量（macOS App Bundle 里通常为空）──
    if let Ok(v) = std::env::var("ANTHROPIC_API_KEY") {
        result["anthropic_api_key"] = serde_json::Value::String(v);
    }
    if let Ok(v) = std::env::var("ANTHROPIC_BASE_URL") {
        result["anthropic_base_url"] = serde_json::Value::String(v);
    }
    if let Ok(v) = std::env::var("OPENAI_API_KEY") {
        result["openai_api_key"] = serde_json::Value::String(v);
    }
    if let Ok(v) = std::env::var("OPENAI_BASE_URL") {
        result["openai_base_url"] = serde_json::Value::String(v);
    }

    // ── 2. 通过交互式 Shell 获取环境变量（这才能读到 .zshrc 里的 export）──
    // 按优先级尝试：zsh → bash
    let shell_candidates = ["/bin/zsh", "/bin/bash"];
    for shell in &shell_candidates {
        if !std::path::Path::new(shell).exists() { continue; }
        let script = r#"
            source ~/.zshenv 2>/dev/null || true
            source ~/.zshrc 2>/dev/null || true
            source ~/.bashrc 2>/dev/null || true
            source ~/.bash_profile 2>/dev/null || true
            echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
            echo "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}"
            echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
            echo "OPENAI_BASE_URL=${OPENAI_BASE_URL}"
        "#;
        let out = Command::new(shell)
            .args(["-l", "-c", script])
            .output();
        if let Ok(out) = out {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                if let Some(val) = line.strip_prefix("ANTHROPIC_API_KEY=") {
                    let val = val.trim();
                    if !val.is_empty() && result["anthropic_api_key"].as_str().unwrap_or("").is_empty() {
                        result["anthropic_api_key"] = serde_json::Value::String(val.to_string());
                    }
                } else if let Some(val) = line.strip_prefix("ANTHROPIC_BASE_URL=") {
                    let val = val.trim();
                    if !val.is_empty() && result["anthropic_base_url"].as_str().unwrap_or("").is_empty() {
                        result["anthropic_base_url"] = serde_json::Value::String(val.to_string());
                    }
                } else if let Some(val) = line.strip_prefix("OPENAI_API_KEY=") {
                    let val = val.trim();
                    if !val.is_empty() && result["openai_api_key"].as_str().unwrap_or("").is_empty() {
                        result["openai_api_key"] = serde_json::Value::String(val.to_string());
                    }
                } else if let Some(val) = line.strip_prefix("OPENAI_BASE_URL=") {
                    let val = val.trim();
                    if !val.is_empty() && result["openai_base_url"].as_str().unwrap_or("").is_empty() {
                        result["openai_base_url"] = serde_json::Value::String(val.to_string());
                    }
                }
            }
            // 成功拿到 shell 输出就不再尝试其他 shell
            if out.status.success() { break; }
        }
    }

    // ── 3. ~/.claude/settings.json（读取 apiKey / apiBaseUrl 字段）──
    if let Ok(home) = std::env::var("HOME") {
        let settings_path = std::path::PathBuf::from(&home)
            .join(".claude")
            .join("settings.json");
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                result["claude_settings"] = json.clone();
                if let Some(base_url) = json.get("apiBaseUrl").and_then(|v| v.as_str()) {
                    if !base_url.is_empty() && result["anthropic_base_url"].as_str().unwrap_or("").is_empty() {
                        result["anthropic_base_url"] = serde_json::Value::String(base_url.to_string());
                    }
                }
                if let Some(key) = json.get("apiKey").and_then(|v| v.as_str()) {
                    if !key.is_empty() && result["anthropic_api_key"].as_str().unwrap_or("").is_empty() {
                        result["anthropic_api_key"] = serde_json::Value::String(key.to_string());
                    }
                }
            }
        }

        // ── 4. Claude Code OAuth 登录状态：通过 ~/.claude/projects 目录判断 ──
        // 若存在 projects 目录且非空，说明曾经成功登录并使用过 Claude Code
        // 更准确：尝试运行 `claude config get userEmail` 来获取登录邮箱
        let claude_dir = std::path::PathBuf::from(&home).join(".claude");
        if claude_dir.exists() {
            // 查找 claude 可执行文件
            let claude_bin = find_in_path("claude");
            if let Some(bin) = claude_bin {
                // 用 claude config get userEmail 检测登录状态（非交互，超时 3s）
                let check = Command::new(&bin)
                    .args(["config", "get", "userEmail"])
                    .output();
                if let Ok(out) = check {
                    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    // 若 stderr 不含 "not logged in" 且 stdout 像邮箱，则已登录
                    let not_logged = stderr.to_lowercase().contains("not logged")
                        || stdout.to_lowercase().contains("not logged");
                    if !not_logged && stdout.contains('@') {
                        result["claude_oauth_logged_in"] = serde_json::Value::Bool(true);
                        result["claude_oauth_email"] = serde_json::Value::String(stdout);
                    } else if !not_logged && !stdout.is_empty() && out.status.success() {
                        // 登录了但格式不是邮箱（如 claude.ai OAuth token）
                        result["claude_oauth_logged_in"] = serde_json::Value::Bool(true);
                    }
                }
            }

            // 备用判断：检查 ~/.claude/projects 里是否有目录（曾经用过）
            let projects_dir = claude_dir.join("projects");
            if projects_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&projects_dir) {
                    let count = entries.filter_map(|e| e.ok()).count();
                    if count > 0 && !result["claude_oauth_logged_in"].as_bool().unwrap_or(false) {
                        // 有使用历史，可能是 OAuth 模式（token 已失效或需要重新登录）
                        result["claude_oauth_logged_in"] = serde_json::Value::Bool(false);
                    }
                }
            }
        }
    }

    // ── 5. CLI 路径检测 ──
    if let Ok(claude_path) = std::env::var("HOME").map(|h| {
        // macOS: claude 可能在 /usr/local/bin 或 nvm/volta 管理的路径
        // 通过 shell 的 which 更可靠
        let out = Command::new("/bin/zsh")
            .args(["-l", "-c", "which claude && which codex"])
            .output();
        out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
            + &h
    }) {
        let _ = claude_path; // 仅用于触发 which 查询
    }

    // 直接 spawn shell 获取 which 结果
    if let Ok(out) = Command::new("/bin/zsh")
        .args(["-l", "-c", "printf '%s\\n%s' \"$(which claude 2>/dev/null)\" \"$(which codex 2>/dev/null)\""])
        .output()
    {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if let Some(p) = lines.first() {
            let p = p.trim();
            if !p.is_empty() && std::path::Path::new(p).exists() {
                result["claude_cli_path"] = serde_json::Value::String(p.to_string());
            }
        }
        if let Some(p) = lines.get(1) {
            let p = p.trim();
            if !p.is_empty() && std::path::Path::new(p).exists() {
                result["codex_cli_path"] = serde_json::Value::String(p.to_string());
            }
        }
    }

    // PATH 回退检测
    if result["claude_cli_path"].as_str().unwrap_or("").is_empty() {
        if let Ok(path_var) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ';' } else { ':' };
            for dir in path_var.split(sep) {
                let claude = std::path::PathBuf::from(dir).join("claude");
                let codex = std::path::PathBuf::from(dir).join("codex");
                if claude.exists() && result["claude_cli_path"].as_str().unwrap_or("").is_empty() {
                    result["claude_cli_path"] = serde_json::Value::String(claude.to_string_lossy().to_string());
                }
                if codex.exists() && result["codex_cli_path"].as_str().unwrap_or("").is_empty() {
                    result["codex_cli_path"] = serde_json::Value::String(codex.to_string_lossy().to_string());
                }
            }
        }
    }

    result
}

/// 在 PATH 中查找指定命令，返回完整路径
fn find_in_path(cmd: &str) -> Option<String> {
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            let full = std::path::PathBuf::from(dir).join(cmd);
            if full.exists() { return Some(full.to_string_lossy().to_string()); }
        }
    }
    // 也尝试常见路径
    for prefix in &["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"] {
        let full = std::path::PathBuf::from(prefix).join(cmd);
        if full.exists() { return Some(full.to_string_lossy().to_string()); }
    }
    None
}

/// 从 shell 配置行中提取环境变量值
/// 支持: export KEY="value", export KEY='value', export KEY=value
fn extract_env_value(line: &str) -> Option<String> {
    let line = line.trim_start_matches("export").trim();
    let parts: Vec<&str> = line.splitn(2, '=').collect();
    if parts.len() != 2 { return None; }
    let mut val = parts[1].trim();
    // 去引号
    if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
        val = &val[1..val.len()-1];
    }
    Some(val.to_string())
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

/// 向 PTY 写入一行文本（预热模式下发送 query：附加换行符触发执行）
#[tauri::command]
fn send_pty_query(
    app: tauri::AppHandle,
    session_id: String,
    query: String,
) -> Result<(), String> {
    let wm = pty_writer_map(&app);
    let mut wm = wm.lock().unwrap();
    if let Some(writer) = wm.get_mut(&session_id) {
        // 写入 query + 换行（触发 CLI 执行）
        let mut data = query.into_bytes();
        data.push(b'\n');
        writer.write_all(&data).map_err(|e| format!("send_pty_query write 失败: {e}"))?;
        writer.flush().map_err(|e| format!("send_pty_query flush 失败: {e}"))?;
        Ok(())
    } else {
        Err(format!("PTY session '{session_id}' 不存在或尚未就绪"))
    }
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
            // CLI 检测
            check_cli,
            // Git 分支管理
            git_current_branch,
            git_branch_create,
            git_branch_switch,
            git_branch_delete,
            git_branch_merge,
            get_git_diff_branch,
            // PTY 终端
            start_pty_session,
            write_pty,
            resize_pty,
            stop_pty_session,
            send_pty_query,
            // Claude 信任目录
            trust_workspace,
            // CLI 配置自动检测
            detect_cli_config,
            // Git Worktree 管理
            git_worktree_create,
            git_worktree_remove,
            git_worktree_list,
            git_worktree_merge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
