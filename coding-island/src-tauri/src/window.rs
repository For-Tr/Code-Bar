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
        //   1   = CanJoinAllSpaces（在所有 Space 可见）
        //   16  = FullScreenAuxiliary（全屏时也可见）
        //   128 = IgnoresCycle（不出现在 Cmd+Tab）
        // 注意：不加 Stationary(64)，加了会阻止用户拖动窗口
        let behavior: u64 = 1 | 16 | 128;
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

/// 根据窗口在屏幕中的位置，计算展开/收起时的锚点坐标（右上角绝对坐标）。
///
/// 策略——检测小窗口「靠近哪条边」，就把那条边作为展开锚边，向内散射：
///   - 靠右（右边距 < 阈值）→ 锚右边：anchor_x = orig_x + orig_w（不变），向左展开
///   - 靠左（左边距 < 阈值）→ 锚左边：anchor_x = orig_x（不变），向右展开
///   - 两侧都不靠边（或都靠边）→ 默认锚右边（同「靠右」）
///
/// 垂直方向同理：
///   - 靠下（下边距 < 阈值）→ 锚底边：anchor_y = orig_y + orig_h，向上展开
///   - 否则            → 锚顶边：anchor_y = orig_y，向下展开
///
/// 返回 (anchor_x, anchor_y, snap_right, snap_bottom)：
///   snap_right  = true 表示展开时以右边为基准（new_x = anchor_x - new_w）
///   snap_bottom = true 表示展开时以底边为基准（new_y = anchor_y - new_h）
fn calc_expand_anchor(
    orig_x: f64, orig_y: f64, orig_w: f64, orig_h: f64,
    screen_x: f64, screen_y: f64, screen_w: f64, screen_h: f64,
) -> (f64, f64, bool, bool) {
    const EDGE_THRESHOLD: f64 = 120.0; // 逻辑像素，距边缘多近算「靠边」

    let dist_left   = orig_x - screen_x;
    let dist_right  = (screen_x + screen_w) - (orig_x + orig_w);
    let dist_top    = orig_y - (screen_y + 28.0); // macOS menubar
    let dist_bottom = (screen_y + screen_h) - (orig_y + orig_h);

    // 水平：靠右优先（默认行为），靠左次之
    let snap_right = dist_right < EDGE_THRESHOLD || dist_left >= EDGE_THRESHOLD;
    let anchor_x = if snap_right { orig_x + orig_w } else { orig_x };

    // 垂直：靠下时向上展开，否则向下展开
    let snap_bottom = dist_bottom < EDGE_THRESHOLD && dist_top >= 0.0;
    let anchor_y = if snap_bottom { orig_y + orig_h } else { orig_y };

    eprintln!(
        "[popup] anchor dist(L={dist_left:.0} R={dist_right:.0} T={dist_top:.0} B={dist_bottom:.0}) \
         snap_right={snap_right} snap_bottom={snap_bottom} anchor=({anchor_x:.0},{anchor_y:.0})"
    );

    (anchor_x, anchor_y, snap_right, snap_bottom)
}

/// 展开终端面板：根据靠近的屏幕边缘自动选择展开方向（向内散射）。
/// - 靠右 → 以右边为锚，向左展开；靠左 → 以左边为锚，向右展开
/// - 靠下 → 以底边为锚，向上展开；否则以顶边为锚，向下展开
/// - 收起时使用 restore_popup_bounds 镜像还原，右上角/锚点完全一致
/// 不写盘——展开是临时状态，收起后恢复磁盘记忆的基础尺寸。
#[tauri::command]
pub fn resize_popup_full(window: tauri::WebviewWindow, width: f64, height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);

    // 当前窗口位置和尺寸（逻辑像素）
    let (orig_x, orig_y) = match window.outer_position() {
        Ok(p) => (p.x as f64 / scale, p.y as f64 / scale),
        Err(_) => {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            return;
        }
    };
    let orig_size = window.outer_size().map(|s| (
        s.width as f64 / scale,
        s.height as f64 / scale,
    )).unwrap_or((376.0, 600.0));
    let (orig_w, orig_h) = orig_size;

    // 获取显示器信息
    let monitor_opt = window.current_monitor().ok().flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let (screen_x, screen_y, screen_w, screen_h) = match monitor_opt {
        Some(m) => {
            let s = m.scale_factor();
            let sz = m.size();
            let mp = m.position();
            (mp.x as f64 / s, mp.y as f64 / s,
             sz.width as f64 / s, sz.height as f64 / s)
        }
        None => {
            // 无显示器信息，降级：以右上角为锚向左下展开
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: orig_x + orig_w - width,
                y: orig_y,
            }));
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            return;
        }
    };

    let (anchor_x, anchor_y, snap_right, snap_bottom) =
        calc_expand_anchor(orig_x, orig_y, orig_w, orig_h, screen_x, screen_y, screen_w, screen_h);

    let new_x = if snap_right  { anchor_x - width  } else { anchor_x };
    let new_y = if snap_bottom { anchor_y - height } else { anchor_y };

    eprintln!("[popup] resize_popup_full new_pos=({new_x:.0},{new_y:.0}) size({width}x{height})");

    // 先移位（窗口还是小尺寸），再扩大 → 无闪烁
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: new_x, y: new_y }));
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
}

/// 终端面板收起后恢复菜单态：
/// - 与展开方向完全镜像：用同样的 calc_expand_anchor 计算锚点，
///   再将大窗口「归位」到小窗口所在的锚点位置
/// - 尺寸恢复到磁盘记忆的基础尺寸（或默认 376×600）
/// 先移位（向锚点收拢），再缩小 → 无闪烁
#[tauri::command]
pub fn restore_popup_bounds(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);

    // 目标尺寸：从磁盘读取，否则默认
    let (target_w, target_h) = load_bounds(&app)
        .map(|b| (b.width, b.height))
        .unwrap_or((376.0, 600.0));

    // 当前（展开态）窗口左上角和尺寸（逻辑像素）
    let (cur_x, cur_y) = match window.outer_position() {
        Ok(p) => (p.x as f64 / scale, p.y as f64 / scale),
        Err(_) => {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: target_w, height: target_h,
            }));
            return;
        }
    };
    let (cur_w, cur_h) = window
        .outer_size()
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((target_w, target_h));

    // 获取显示器信息（用于 calc_expand_anchor）
    let monitor_opt = window.current_monitor().ok().flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let (screen_x, screen_y, screen_w, screen_h) = match monitor_opt {
        Some(m) => {
            let s = m.scale_factor();
            let sz = m.size();
            let mp = m.position();
            (mp.x as f64 / s, mp.y as f64 / s,
             sz.width as f64 / s, sz.height as f64 / s)
        }
        None => {
            // 无显示器信息，降级：保持右上角
            let new_x = cur_x + cur_w - target_w;
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: new_x, y: cur_y }));
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: target_w, height: target_h }));
            save_bounds_to_file(&app, &PopupBounds { x: new_x, y: cur_y, width: target_w, height: target_h });
            return;
        }
    };

    // 用「收起后的小窗口」反推 calc_expand_anchor 里的 snap 方向。
    // 展开时用的是小窗口的位置来判断靠边——现在大窗口的锚点就是小窗口锚点的映射。
    // 大窗口展开后：anchor_x、anchor_y 是固定的，所以：
    //   snap_right  → anchor_x = cur_x + cur_w（大窗口右边）→ 小窗口 new_x = anchor_x - target_w
    //   !snap_right → anchor_x = cur_x（大窗口左边）        → 小窗口 new_x = anchor_x
    //   snap_bottom → anchor_y = cur_y + cur_h              → 小窗口 new_y = anchor_y - target_h
    //   !snap_bottom→ anchor_y = cur_y                      → 小窗口 new_y = anchor_y
    //
    // 但我们不知道展开时的 snap 方向，需要从大窗口当前位置重新判断。
    // 关键：展开后大窗口的「小窗口对应的锚边」与大窗口本身的边重合，
    // 所以用大窗口当前位置对屏幕的相对关系，同样能推断出正确 snap 方向。
    let (anchor_x, anchor_y, snap_right, snap_bottom) =
        calc_expand_anchor(cur_x, cur_y, cur_w, cur_h, screen_x, screen_y, screen_w, screen_h);

    let new_x = if snap_right  { anchor_x - target_w  } else { anchor_x };
    let new_y = if snap_bottom { anchor_y - target_h  } else { anchor_y };

    eprintln!("[popup] restore_popup_bounds new_pos=({new_x:.0},{new_y:.0}) size→{target_w}x{target_h}");

    // 先移位（窗口还是大的，但新位置已是收起后的左上角），再缩小
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: new_x, y: new_y }));
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: target_w, height: target_h,
    }));

    // 更新磁盘记录
    save_bounds_to_file(&app, &PopupBounds {
        x: new_x, y: new_y, width: target_w, height: target_h,
    });
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
