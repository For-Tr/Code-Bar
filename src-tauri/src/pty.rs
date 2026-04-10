use std::io::{Read, Write};

use tauri::{Emitter, Manager};

use crate::{
    cli_detect::resolve_command_path,
    state::{PtyKillerMap, PtyMasterMap, PtySessionMeta, PtySessionMetaMap, PtyWriterMap},
    util::{expand_path, home_dir, resolve_windows_pty_command},
};

// ── 辅助：从 AppHandle 获取 PTY 状态 ─────────────────────────────

fn pty_writer_map(app: &tauri::AppHandle) -> PtyWriterMap {
    app.state::<PtyWriterMap>().inner().clone()
}

fn pty_killer_map(app: &tauri::AppHandle) -> PtyKillerMap {
    app.state::<PtyKillerMap>().inner().clone()
}

fn pty_master_map(app: &tauri::AppHandle) -> PtyMasterMap {
    app.state::<PtyMasterMap>().inner().clone()
}

fn pty_session_meta_map(app: &tauri::AppHandle) -> PtySessionMetaMap {
    app.state::<PtySessionMetaMap>().inner().clone()
}

// ── PTY 输出状态机 ────────────────────────────────────────────────

/// PTY 输出的可见文字状态，用于检测 CLI 等待/运行状态
struct AnsiStripper {
    state: u8, // 0=normal, 1=ESC, 2=CSI
    window: Vec<u8>,
}

impl AnsiStripper {
    fn new() -> Self {
        Self {
            state: 0,
            window: Vec::with_capacity(256),
        }
    }

    fn feed(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            match self.state {
                0 => {
                    if byte == 0x1b {
                        self.state = 1;
                    } else if byte >= 0x20 || byte == b'\r' || byte == b'\n' {
                        self.window.push(byte);
                        if self.window.len() > 256 {
                            self.window.drain(..128);
                        }
                    }
                }
                1 => {
                    self.state = if byte == b'[' { 2 } else { 0 };
                }
                2 => {
                    if byte >= 0x40 && byte <= 0x7e {
                        self.state = 0;
                    }
                }
                _ => {
                    self.state = 0;
                }
            }
        }
    }

    fn visible(&self) -> &[u8] {
        &self.window
    }

    fn clear(&mut self) {
        self.window.clear();
    }
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 启动 PTY 会话
#[tauri::command]
pub async fn start_pty_session(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    env: Option<Vec<(String, String)>>,
) -> Result<(), String> {
    use base64::Engine;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let expanded = expand_path(&workdir);
    let runner_type = env
        .as_ref()
        .and_then(|pairs| {
            pairs
                .iter()
                .find(|(k, _)| k == "CODE_BAR_RUNNER_TYPE")
                .map(|(_, v)| v.clone())
        })
        .unwrap_or_else(|| {
            std::path::Path::new(&command)
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| match name {
                    "claude" => "claude-code",
                    "codex" => "codex",
                    other => other,
                })
                .unwrap_or_default()
                .to_string()
        });

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
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    let resolved_command = resolve_command_path(&command);
    let (launch_command, launch_args) = resolve_windows_pty_command(&resolved_command, &args);

    let mut cmd = if cfg!(windows)
        && std::path::Path::new(&launch_command)
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "cmd" | "bat"))
            .unwrap_or(false)
    {
        let mut builder = CommandBuilder::new("cmd.exe");
        builder.arg("/d");
        builder.arg("/c");
        builder.arg(&launch_command);
        for arg in &launch_args {
            builder.arg(arg);
        }
        builder
    } else {
        let mut builder = CommandBuilder::new(&launch_command);
        for arg in &launch_args {
            builder.arg(arg);
        }
        builder
    };
    cmd.cwd(&expanded);

    // 继承基础环境变量
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(home) = home_dir() {
        cmd.env("HOME", home.to_string_lossy().to_string());
        #[cfg(windows)]
        cmd.env("USERPROFILE", home.to_string_lossy().to_string());
    }

    // 构建子进程 PATH（补充 node 所在目录，供 claude/codex 等 Node.js 脚本使用）
    {
        let base_path = std::env::var("PATH").unwrap_or_default();
        let node_path = resolve_command_path("node");
        let node_dir = if std::path::Path::new(&node_path).parent().is_some() {
            std::path::Path::new(&node_path)
                .parent()
                .map(|d| d.to_string_lossy().to_string())
        } else {
            None
        };
        let sep = if cfg!(windows) { ';' } else { ':' };
        let enriched_path = match node_dir {
            Some(dir) if !base_path.split(sep).any(|s| s == dir) => {
                format!("{dir}{sep}{base_path}")
            }
            _ => base_path,
        };
        cmd.env("PATH", enriched_path);
    }

    // 注入调用方传入的额外环境变量
    if let Some(extra_env) = env {
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn 失败: {e}"))?;

    let mut master_reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader 失败: {e}"))?;

    let master_writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer 失败: {e}"))?;

    // 保存 writer / child / master
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
    {
        let meta_map = pty_session_meta_map(&app);
        let mut meta_map = meta_map.lock().unwrap();
        meta_map.insert(
            session_id.clone(),
            PtySessionMeta {
                runner_type,
                workdir: expanded.clone(),
            },
        );
    }

    // 读取线程：转发 PTY 输出并检测状态特征
    let app_r = app.clone();
    let sid_r = session_id.clone();
    let killer_map_r = pty_killer_map(&app);
    let session_meta_map_r = pty_session_meta_map(&app);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut stripper = AnsiStripper::new();
        // 0 = unknown, 1 = running, 2 = waiting
        let mut last_status: u8 = 0;

        loop {
            match master_reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // 转发原始数据（base64 编码）
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_r.emit(
                        "pty-data",
                        serde_json::json!({ "session_id": sid_r, "data": b64 }),
                    );

                    // 检测 CLI 状态特征
                    stripper.feed(&buf[..n]);
                    let win_str = String::from_utf8_lossy(stripper.visible());
                    let new_status = if win_str.contains("? for shortcuts") {
                        2u8 // waiting
                    } else if win_str.contains("esc to interrupt") {
                        1u8 // running
                    } else {
                        0u8
                    };

                    if new_status != 0 && new_status != last_status {
                        last_status = new_status;
                        stripper.clear();
                        let event = if new_status == 2 {
                            "pty-waiting"
                        } else {
                            "pty-running"
                        };
                        let _ = app_r.emit(event, serde_json::json!({ "session_id": sid_r }));
                    }
                }
            }
        }

        // 回收子进程，防止僵尸进程
        {
            let mut km = killer_map_r.lock().unwrap();
            if let Some(mut child) = km.remove(&sid_r) {
                let _ = child.wait();
            }
        }
        {
            let mut meta_map = session_meta_map_r.lock().unwrap();
            meta_map.remove(&sid_r);
        }

        let _ = app_r.emit("pty-exit", serde_json::json!({ "session_id": sid_r }));
    });

    Ok(())
}

#[tauri::command]
pub fn has_active_pty_session(app: tauri::AppHandle, session_id: String) -> bool {
    let km = pty_killer_map(&app);
    let has_session = km.lock().unwrap().contains_key(&session_id);
    has_session
}

/// 向 PTY 写入数据（键盘输入，base64 编码）
#[tauri::command]
pub fn write_pty(app: tauri::AppHandle, session_id: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let wm = pty_writer_map(&app);
    let mut wm = wm.lock().unwrap();
    if let Some(writer) = wm.get_mut(&session_id) {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&data)
            .map_err(|e| format!("base64 decode 失败: {e}"))?;
        writer
            .write_all(&bytes)
            .map_err(|e| format!("write 失败: {e}"))?;
    }
    Ok(())
}

/// 向 PTY 写入一行文本（附加换行触发执行）
#[tauri::command]
pub fn send_pty_query(
    app: tauri::AppHandle,
    session_id: String,
    query: String,
) -> Result<(), String> {
    let wm = pty_writer_map(&app);
    let mut wm = wm.lock().unwrap();
    if let Some(writer) = wm.get_mut(&session_id) {
        let mut data = query.into_bytes();
        data.push(if cfg!(windows) { b'\r' } else { b'\n' });
        writer
            .write_all(&data)
            .map_err(|e| format!("send_pty_query write 失败: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("send_pty_query flush 失败: {e}"))?;
        Ok(())
    } else {
        Err(format!("PTY session '{session_id}' 不存在或尚未就绪"))
    }
}

/// 调整 PTY 大小（cols/rows 至少为 20/5，防止 SIGWINCH 异常）
#[tauri::command]
pub fn resize_pty(
    app: tauri::AppHandle,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use portable_pty::PtySize;
    let cols = cols.max(20);
    let rows = rows.max(5);
    let mm = pty_master_map(&app);
    let mm = mm.lock().unwrap();
    if let Some(master) = mm.get(&session_id) {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize_pty 失败: {e}"))?;
    }
    Ok(())
}

/// 停止 PTY 会话
#[tauri::command]
pub fn stop_pty_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let mut had_session = false;
    {
        let km = pty_killer_map(&app);
        let mut km = km.lock().unwrap();
        if let Some(mut child) = km.remove(&session_id) {
            had_session = true;
            let _ = child.kill();
        }
    }
    {
        let wm = pty_writer_map(&app);
        let mut wm = wm.lock().unwrap();
        if wm.remove(&session_id).is_some() {
            had_session = true;
        }
    }
    {
        let mm = pty_master_map(&app);
        let mut mm = mm.lock().unwrap();
        if mm.remove(&session_id).is_some() {
            had_session = true;
        }
    }
    {
        let meta_map = pty_session_meta_map(&app);
        let mut meta_map = meta_map.lock().unwrap();
        if meta_map.remove(&session_id).is_some() {
            had_session = true;
        }
    }
    if had_session {
        let _ = app.emit("pty-exit", serde_json::json!({ "session_id": session_id }));
    }
    Ok(())
}
