use std::path::PathBuf;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::PopupVisible;

// ── Popup 位置 / 尺寸持久化 ──────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PopupBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn bounds_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("popup_bounds.json"))
}

pub fn load_bounds(app: &tauri::AppHandle) -> Option<PopupBounds> {
    let path = bounds_file(app)?;
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_bounds_to_file(app: &tauri::AppHandle, bounds: &PopupBounds) {
    if let Some(path) = bounds_file(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(bounds) {
            let _ = std::fs::write(&path, json);
        }
    }
}

// ── Tauri 命令：bounds 持久化 ─────────────────────────────────

/// 保存浮窗位置与大小（仅在基础状态/非展开时由前端调用）
#[tauri::command]
pub fn save_popup_bounds(app: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) {
    let bounds = PopupBounds { x, y, width, height };
    save_bounds_to_file(&app, &bounds);
    eprintln!("[popup] bounds saved => x={x} y={y} w={width} h={height}");
}

/// 读取已保存的浮窗位置与大小（没有则返回 null）
#[tauri::command]
pub fn load_popup_bounds(app: tauri::AppHandle) -> Option<PopupBounds> {
    let b = load_bounds(&app);
    eprintln!("[popup] bounds loaded => {:?}", b);
    b
}

// ── 内部辅助：定位弹窗（优先使用记忆的位置，否则默认右上角）─────

pub fn position_popup(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    if let Some(bounds) = load_bounds(app) {
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: bounds.x,
            y: bounds.y,
        }));
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: bounds.width,
            height: bounds.height,
        }));
        eprintln!("[popup] restored bounds => {:?}", bounds);
        return;
    }

    // 没有记忆：默认右上角
    let monitor_opt = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.available_monitors().ok()?.into_iter().next());

    if let Some(monitor) = monitor_opt {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        let win_w = 376.0_f64;
        let x = screen_w - win_w;
        let y = 28.0;
        eprintln!("[popup] default position => x={x} y={y} screen_w={screen_w} scale={scale}");
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    } else {
        eprintln!("[popup] WARNING: no monitor found, using fallback position");
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: 800.0,
            y: 28.0,
        }));
    }
}

// ── macOS 专属：设置 NSWindow 属性 ───────────────────────────────

#[cfg(target_os = "macos")]
pub fn setup_popup_window(win: &tauri::WebviewWindow) {
    use cocoa::base::NO;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let ns_window = win.ns_window().expect("ns_window") as cocoa::base::id;
        let _: () = msg_send![ns_window, setOpaque: NO];
        let clear: cocoa::base::id = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];

        // NSWindowCollectionBehavior：
        //   1   = CanJoinAllSpaces
        //   16  = FullScreenAuxiliary
        //   64  = Stationary
        //   128 = IgnoresCycle（不出现在 Cmd+Tab）
        let behavior: u64 = 1 | 16 | 64 | 128;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

        // NSFloatingWindowLevel = 3
        let _: () = msg_send![ns_window, setLevel: 3_i64];

        // hidesOnDeactivate = false：切换应用时弹窗不消失
        let _: () = msg_send![ns_window, setHidesOnDeactivate: NO];
    }
}

// ── 显示 / 隐藏 / 切换弹窗 ────────────────────────────────────────

pub fn show_popup(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    position_popup(app, win);
    let _ = win.show();

    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::nil;
        use objc::{msg_send, sel, sel_impl};
        let ns_window = win.ns_window().expect("ns_window") as cocoa::base::id;
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win.set_focus();
    }

    app.state::<PopupVisible>().set(true);
    let _ = win.emit("popup-shown", ());
    eprintln!("[popup] shown");
}

pub fn toggle_popup(app: &tauri::AppHandle) {
    eprintln!("[popup] toggle_popup called");

    if let Some(win) = app.get_webview_window("popup") {
        let really_visible = win.is_visible().unwrap_or(false);
        let state_visible = app.state::<PopupVisible>().get();
        let is_visible = really_visible || state_visible;
        eprintln!(
            "[popup] window exists, really_visible={really_visible} state_visible={state_visible}"
        );

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
    let (default_w, default_h) = load_bounds(app)
        .map(|b| (b.width, b.height))
        .unwrap_or((376.0, 600.0));

    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(default_w, default_h)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .shadow(false)
        .resizable(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .expect("Failed to create popup window");

    #[cfg(target_os = "macos")]
    setup_popup_window(&win);

    show_popup(app, &win);
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 隐藏弹窗
#[tauri::command]
pub fn close_popup(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    app.state::<PopupVisible>().set(false);
    let _ = window.hide();
}

/// 展开/收起终端面板时调整宽高。
/// 不写盘——展开是临时状态，关闭后应恢复用户记忆的基础尺寸。
#[tauri::command]
pub fn resize_popup_full(window: tauri::WebviewWindow, width: f64, height: f64) {
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
}

/// 终端面板收起后，将窗口恢复到用户记忆的基础大小和位置。
/// 若没有记忆则恢复到默认 376×600。
#[tauri::command]
pub fn restore_popup_bounds(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    if let Some(bounds) = load_bounds(&app) {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: bounds.width,
            height: bounds.height,
        }));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: bounds.x,
            y: bounds.y,
        }));
        eprintln!("[popup] restore_popup_bounds => {:?}", bounds);
    } else {
        // 没有记忆：恢复默认
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 376.0,
            height: 600.0,
        }));
    }
}

/// （兼容旧调用）调整弹窗高度，保持当前宽度和位置，同时写盘持久化。
#[tauri::command]
pub fn resize_popup(app: tauri::AppHandle, window: tauri::WebviewWindow, height: f64) {
    let h = height.clamp(200.0, 1600.0);
    let scale = window.scale_factor().unwrap_or(1.0);
    let cur_size = window
        .inner_size()
        .map(|s| s.to_logical::<f64>(scale))
        .unwrap_or(tauri::LogicalSize { width: 376.0, height: h });
    let w = cur_size.width.max(300.0);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: w,
        height: h,
    }));
    if let Ok(pos) = window.outer_position() {
        save_bounds_to_file(
            &app,
            &PopupBounds {
                x: pos.x as f64 / scale,
                y: pos.y as f64 / scale,
                width: w,
                height: h,
            },
        );
    }
}

/// 调用 macOS 原生文件夹选择对话框
#[tauri::command]
pub fn pick_folder() -> String {
    let script = r#"
        set folderPath to POSIX path of (choose folder with prompt "选择工作目录")
        return folderPath
    "#;
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .trim_end_matches('/')
            .to_string(),
        _ => String::new(),
    }
}
