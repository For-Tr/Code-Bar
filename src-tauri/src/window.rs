use std::path::PathBuf;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::{PendingPopupFocus, PopupFocusRequest, PopupVisible};
use crate::util::background_command;

macro_rules! popup_log {
    ($($arg:tt)*) => {{
        if std::env::var_os("CODE_BAR_POPUP_LOG").is_some() {
            eprintln!($($arg)*);
        }
    }};
}

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
/// 收起动画保护期（600ms）内调用时静默忽略，防止动画触发的 onResized 误写盘。
#[tauri::command]
pub fn save_popup_bounds(app: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) {
    // 收起保护期内拒绝写盘
    if app.state::<crate::state::RestoringLock>().is_locked() {
        popup_log!("[popup] save_popup_bounds ignored (restoring lock active)");
        return;
    }
    let bounds = PopupBounds {
        x,
        y,
        width,
        height,
    };
    save_bounds_to_file(&app, &bounds);
    popup_log!("[popup] bounds saved => x={x} y={y} w={width} h={height}");
}

/// 读取已保存的浮窗位置与大小（没有则返回 null）
#[tauri::command]
pub fn load_popup_bounds(app: tauri::AppHandle) -> Option<PopupBounds> {
    let b = load_bounds(&app);
    popup_log!("[popup] bounds loaded => {:?}", b);
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
        popup_log!("[popup] restored bounds => {:?}", bounds);
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
        popup_log!("[popup] default position => x={x} y={y} screen_w={screen_w} scale={scale}");
        let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    } else {
        popup_log!("[popup] WARNING: no monitor found, using fallback position");
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

// ── macOS 原生窗口动画 ────────────────────────────────────────────
//
// 使用 NSAnimationContext + [[window animator] setFrame:display:]
// 实现系统级弹性窗口动画（与 Spotlight、Raycast 同款）。
//
// 坐标系说明：
//   macOS NSWindow/NSScreen 使用「左下角为原点、Y 轴向上」的坐标系。
//   Tauri logical 坐标使用「左上角为原点、Y 轴向下」。
//   转换公式：ns_y = screen_h - tauri_y - window_height
//
// 线程安全：
//   NSAnimationContext 必须在主线程调用。
//   我们将 NSWindow 指针以 usize 形式传入 run_on_main_thread 闭包（'static + Send）。
//   因为 run_on_main_thread 保证在主线程执行，此时访问 NSWindow 是安全的。

#[cfg(target_os = "macos")]
unsafe fn do_animated_set_frame(
    ns_window_ptr: usize,
    target_x: f64,
    target_y: f64,
    target_w: f64,
    target_h: f64,
    screen_h: f64,
    duration: f64,
) {
    use objc::{class, msg_send, sel, sel_impl};

    let ns_window = ns_window_ptr as cocoa::base::id;

    // NSRect 结构体（与 CoreGraphics CGRect 内存布局相同）
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSRect {
        origin: NSPoint,
        size: NSSize,
    }

    // Tauri(左上角, Y↓) → macOS NSRect(左下角, Y↑)
    let ns_x = target_x;
    let ns_y = screen_h - target_y - target_h;

    // ── 步骤 1：读取当前窗口 frame ──────────────────────────────────
    // 获取当前窗口的宽高（macOS 坐标系）
    let cur_frame: NSRect = msg_send![ns_window, frame];
    let cur_w = cur_frame.size.width;
    let cur_h = cur_frame.size.height;

    // ── 步骤 2：瞬时把位置对齐到目标 origin（保持当前 size，display:NO 不重绘）──
    //
    // 关键思路：NSAnimationContext setFrame: 对 origin 和 size 同时做线性插值。
    // 若动画的起始 origin == 终止 origin，则动画全程 origin 不变，只有 size 变化，
    // 视觉效果是"窗口原地扩展/收缩"，无任何平移感。
    //
    // 做法：
    //   1. 瞬时 setFrame 到 (target_origin, cur_size)，display:NO 不触发重绘
    //      → 窗口内存位置已到目标 origin，但屏幕上还显示原来的像素
    //   2. 动画 setFrame 到 (target_origin, target_size)
    //      → origin 起止相同，动画中 origin = 常数，只有 size 在插值
    //      → 用户看到的是"从当前 size 平滑扩展到目标 size，位置不动"
    let pre_frame = NSRect {
        origin: NSPoint { x: ns_x, y: ns_y }, // ← 与动画终点相同的 origin
        size: NSSize {
            width: cur_w,
            height: cur_h,
        },
    };
    // display:NO → 仅更新内部 frame，不重绘屏幕，用户看不到这次跳变
    let _: () = msg_send![ns_window, setFrame: pre_frame display: cocoa::base::NO];

    // ── 步骤 3：动画 frame 到目标（origin 不变，只有 size 变化）────
    let target_frame = NSRect {
        origin: NSPoint { x: ns_x, y: ns_y },
        size: NSSize {
            width: target_w,
            height: target_h,
        },
    };

    let ctx_class = class!(NSAnimationContext);
    let _: () = msg_send![ctx_class, beginGrouping];
    let ctx: cocoa::base::id = msg_send![ctx_class, currentContext];
    let _: () = msg_send![ctx, setDuration: duration];

    let animator: cocoa::base::id = msg_send![ns_window, animator];
    let _: () = msg_send![animator, setFrame: target_frame display: cocoa::base::YES];

    let _: () = msg_send![ctx_class, endGrouping];

    popup_log!(
        "[popup] center-expand → tauri({target_x:.0},{target_y:.0}) \
         ns_origin=({ns_x:.0},{ns_y:.0}) size={target_w:.0}×{target_h:.0} \
         cur={cur_w:.0}×{cur_h:.0} dur={duration}"
    );
}

// ── 显示 / 隐藏 / 切换弹窗 ────────────────────────────────────────

#[cfg(target_os = "macos")]
fn activate_popup_window(win: &tauri::WebviewWindow) {
    use cocoa::base::{nil, YES};
    use objc::{class, msg_send, sel, sel_impl};

    let ns_window_ptr = match win.ns_window() {
        Ok(ptr) => ptr as usize,
        Err(_) => return,
    };

    let _ = win.run_on_main_thread(move || unsafe {
        let ns_window = ns_window_ptr as cocoa::base::id;
        let ns_app: cocoa::base::id = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: YES];
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    });
}

#[cfg(target_os = "macos")]
fn restore_popup_interaction(win: &tauri::WebviewWindow) {
    use cocoa::base::NO;
    use objc::{msg_send, sel, sel_impl};

    let ns_window_ptr = match win.ns_window() {
        Ok(ptr) => ptr as usize,
        Err(_) => {
            let _ = win.set_focus();
            return;
        }
    };

    let _ = win.run_on_main_thread(move || unsafe {
        let ns_window = ns_window_ptr as cocoa::base::id;
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: NO];
        let _: () = msg_send![ns_window, makeMainWindow];
        let content_view: cocoa::base::id = msg_send![ns_window, contentView];
        let _: () = msg_send![ns_window, makeFirstResponder: content_view];
    });

    let _ = win.set_focus();
}

pub fn show_popup(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    // 注意：不在这里调用 position_popup。
    // 窗口隐藏时位置不会改变，下次 show 时原地显示即可，无需重新定位。
    // position_popup 只在 create_popup（首次创建）时调用一次。
    let _ = win.show();

    #[cfg(target_os = "macos")]
    activate_popup_window(win);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win.set_focus();
    }

    app.state::<PopupVisible>().set(true);
    let _ = win.emit("popup-shown", ());
    popup_log!("[popup] shown");
}

pub fn toggle_popup(app: &tauri::AppHandle) {
    popup_log!("[popup] toggle_popup called");

    if let Some(win) = app.get_webview_window("popup") {
        let really_visible = win.is_visible().unwrap_or(false);
        let state_visible = app.state::<PopupVisible>().get();
        let is_visible = really_visible || state_visible;
        popup_log!(
            "[popup] window exists, really_visible={really_visible} state_visible={state_visible}"
        );

        if is_visible {
            popup_log!("[popup] hiding");
            app.state::<PopupVisible>().set(false);
            let _ = win.hide();
        } else {
            popup_log!("[popup] showing");
            show_popup(app, &win);
        }
    } else {
        popup_log!("[popup] window not found, creating");
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

    position_popup(app, &win);
    show_popup(app, &win);
}

#[tauri::command]
pub fn take_pending_popup_focus(app: tauri::AppHandle) -> Option<PopupFocusRequest> {
    app.state::<PendingPopupFocus>().take()
}

fn focus_popup_on_main_thread(app: &tauri::AppHandle, session_id: Option<String>) {
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.show();

        #[cfg(target_os = "macos")]
        {
            activate_popup_window(&win);
            restore_popup_interaction(&win);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.set_focus();
        }

        app.state::<PopupVisible>().set(true);
        let _ = win.emit(
            "popup-focused",
            serde_json::json!({ "session_id": session_id }),
        );
        popup_log!("[popup] focused via notification click");
    } else {
        create_popup(app);
        if let Some(win) = app.get_webview_window("popup") {
            #[cfg(target_os = "macos")]
            restore_popup_interaction(&win);
            let _ = win.emit(
                "popup-focused",
                serde_json::json!({ "session_id": session_id }),
            );
        }
    }
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 隐藏弹窗
#[tauri::command]
pub fn close_popup(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    app.state::<PopupVisible>().set(false);
    let _ = window.hide();
}

/// 从通知点击回调中激活并显示弹窗。
///
/// 与 toggle_popup / show_popup 不同：
/// - 不发射 "popup-shown"（那个事件会让前端 setExpandedSession(null) 收起 terminal）
/// - 发射 "popup-focused"，携带可选 session_id，让前端可精确展开目标 session
/// - 无论当前窗口是否可见，都强制置于前台
#[tauri::command]
pub fn focus_popup(app: tauri::AppHandle, session_id: Option<String>) {
    app.state::<PendingPopupFocus>().set(session_id.clone());
    let app_handle = app.clone();
    let session_id_for_ui = session_id.clone();
    let _ = app.run_on_main_thread(move || {
        focus_popup_on_main_thread(&app_handle, session_id_for_ui);
    });
}

// ── 展开位置计算 ──────────────────────────────────────────────────
//
// 策略：以当前小窗口「中心」为基准，向四周等量扩展（原地放大）。
// 空间不足时，以最小位移将展开后的大窗口推回屏幕内。
//
// 这样在绝大多数情况下小窗口完全不移位，展开像"从内部长出来"。
// 只有真正贴近屏幕边缘且空间不够时，才会发生整体平移。
//
// 收起时用同样的中心点逆推：以大窗口中心收缩回小窗口。
// 大窗口中心 = 展开时的中心（若展开期间未拖动），故收起后位置天然还原。

/// 根据小窗口当前位置和目标展开尺寸，计算展开后大窗口的左上角坐标。
///
/// 参数：
///   (orig_x, orig_y, orig_w, orig_h)  — 当前小窗口（逻辑像素）
///   (exp_w,  exp_h)                   — 展开后目标尺寸
///   (screen_x, screen_y, screen_w, screen_h) — 显示器可用区域（逻辑像素）
///
/// 返回 (new_x, new_y)：展开后大窗口的左上角坐标
fn calc_expand_pos(
    orig_x: f64,
    orig_y: f64,
    orig_w: f64,
    orig_h: f64,
    exp_w: f64,
    exp_h: f64,
    screen_x: f64,
    screen_y: f64,
    screen_w: f64,
    screen_h: f64,
) -> (f64, f64) {
    // 小窗口中心
    let cx = orig_x + orig_w * 0.5;
    let cy = orig_y + orig_h * 0.5;

    // 理想展开：以中心为基准，大窗口居中
    let ideal_x = cx - exp_w * 0.5;
    let ideal_y = cy - exp_h * 0.5;

    // 屏幕有效区域（macOS 顶部 28px 为菜单栏）
    let safe_top = screen_y + 28.0;
    let safe_left = screen_x;
    let safe_right = screen_x + screen_w;
    let safe_bottom = screen_y + screen_h;

    // 边界修正：超出哪边就往反方向推，取最小位移
    let mut x = ideal_x;
    let mut y = ideal_y;

    // 右边溢出 → 向左推
    if x + exp_w > safe_right {
        x = safe_right - exp_w;
    }
    // 左边溢出 → 向右推
    if x < safe_left {
        x = safe_left;
    }
    // 下边溢出 → 向上推
    if y + exp_h > safe_bottom {
        y = safe_bottom - exp_h;
    }
    // 上边溢出（含菜单栏）→ 向下推
    if y < safe_top {
        y = safe_top;
    }

    popup_log!(
        "[popup] expand center=({cx:.0},{cy:.0}) ideal=({ideal_x:.0},{ideal_y:.0}) \
         clamped=({x:.0},{y:.0}) size={exp_w:.0}×{exp_h:.0}"
    );

    (x, y)
}

/// 封装动画/瞬时调整的公共逻辑，避免重复代码
fn apply_window_frame(
    window: &tauri::WebviewWindow,
    new_x: f64,
    new_y: f64,
    new_w: f64,
    new_h: f64,
    _screen_h: f64,
    _duration: f64,
) {
    // ── macOS：NSAnimationContext 原生动画 ──────────────────────────
    #[cfg(target_os = "macos")]
    {
        let ns_window_ptr: usize = match window.ns_window() {
            Ok(ptr) => ptr as usize,
            Err(_) => {
                // ns_window 获取失败，降级为瞬时调整
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                    x: new_x,
                    y: new_y,
                }));
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: new_w,
                    height: new_h,
                }));
                return;
            }
        };
        let _ = window.run_on_main_thread(move || {
            unsafe {
                do_animated_set_frame(
                    ns_window_ptr,
                    new_x,
                    new_y,
                    new_w,
                    new_h,
                    _screen_h,
                    _duration,
                )
            };
        });
    }

    // ── 非 macOS：瞬时调整 ─────────────────────────────────────────
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: new_x,
            y: new_y,
        }));
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: new_w,
            height: new_h,
        }));
    }
}

/// 展开终端面板。
///
/// 默认以小窗口中心为基准向四周等量扩展（小窗口原地不动，PTY 从内部长出）。
/// 仅在展开后会超出屏幕边界时，才以最小位移整体平移使其完全可见。
///
/// macOS 使用 NSAnimationContext 原生动画（0.22s ease）；其他平台瞬时调整。
/// 不写盘——展开是临时状态，收起后恢复磁盘记忆的基础尺寸。
#[tauri::command]
pub fn resize_popup_full(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    width: f64,
    height: f64,
) {
    let scale = window.scale_factor().unwrap_or(1.0);

    // 当前窗口位置和尺寸（逻辑像素）
    let (orig_x, orig_y) = match window.outer_position() {
        Ok(p) => (p.x as f64 / scale, p.y as f64 / scale),
        Err(_) => {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            return;
        }
    };
    let (orig_w, orig_h) = window
        .outer_size()
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((376.0, 600.0));

    // ★ 展开前把小窗口位置快照存入内存缓存，收起时精确还原
    app.state::<crate::state::PreExpandPos>()
        .set(crate::state::Bounds4 {
            x: orig_x,
            y: orig_y,
            w: orig_w,
            h: orig_h,
        });

    // 获取显示器信息
    let monitor_opt = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let monitor = match monitor_opt {
        Some(m) => m,
        None => {
            // 无显示器信息，降级：原地展开，不做边界检测
            let cx = orig_x + orig_w * 0.5;
            let cy = orig_y + orig_h * 0.5;
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: cx - width * 0.5,
                y: cy - height * 0.5,
            }));
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            return;
        }
    };
    let ms = monitor.scale_factor();
    let screen_x = monitor.position().x as f64 / ms;
    let screen_y = monitor.position().y as f64 / ms;
    let screen_w = monitor.size().width as f64 / ms;
    let screen_h = monitor.size().height as f64 / ms;

    let (new_x, new_y) = calc_expand_pos(
        orig_x, orig_y, orig_w, orig_h, width, height, screen_x, screen_y, screen_w, screen_h,
    );

    apply_window_frame(&window, new_x, new_y, width, height, screen_h, 0.18);
}

/// 终端面板收起后，将窗口恢复到展开前的精确位置和尺寸。
///
/// 策略（优先级降序）：
///   1. 内存缓存（PreExpandPos）：展开时快照的小窗口坐标，最精确，与碰撞检测完全兼容。
///   2. 磁盘记忆（popup_bounds.json）：冷启动/异常时的兜底。
///   3. 默认值 376×600。
///
/// 采用上一个 commit 的直接赋值方式（set_position + set_size），
/// 不使用 NSAnimationContext，避免坐标系转换引入偏差。
/// 同时加 RestoringLock 防止收起期间的 onResized 误写盘。
#[tauri::command]
pub fn restore_popup_bounds(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    // ★ 立即加锁：阻止接下来 600ms 内前端 onResized 误写盘
    app.state::<crate::state::RestoringLock>().arm();

    // ── 确定目标位置和尺寸（优先缓存，其次磁盘，最后默认）────────
    let (x, y, w, h) = if let Some(snap) = app.state::<crate::state::PreExpandPos>().take() {
        // ★ 最精确：展开前的精确快照
        popup_log!(
            "[popup] restore: cache hit ({:.0},{:.0}) {:.0}×{:.0}",
            snap.x, snap.y, snap.w, snap.h
        );
        (snap.x, snap.y, snap.w, snap.h)
    } else if let Some(disk) = load_bounds(&app) {
        // 磁盘兜底
        popup_log!(
            "[popup] restore: disk fallback ({:.0},{:.0}) {:.0}×{:.0}",
            disk.x, disk.y, disk.width, disk.height
        );
        (disk.x, disk.y, disk.width, disk.height)
    } else {
        // 默认值（首次运行，无任何记忆）
        popup_log!("[popup] restore: using defaults");
        return; // 没有位置记忆时什么都不做，窗口停在原处
    };

    // ── 直接 set_position + set_size（参照上一个 commit，简单可靠）──
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: w,
        height: h,
    }));
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));

    popup_log!("[popup] restore done => ({x:.0},{y:.0}) {w:.0}×{h:.0}");
}

/// （兼容旧调用）调整弹窗高度，保持当前宽度和位置，同时写盘持久化。
#[tauri::command]
pub fn resize_popup(app: tauri::AppHandle, window: tauri::WebviewWindow, height: f64) {
    let h = height.clamp(200.0, 1600.0);
    let scale = window.scale_factor().unwrap_or(1.0);
    let cur_size = window
        .inner_size()
        .map(|s| s.to_logical::<f64>(scale))
        .unwrap_or(tauri::LogicalSize {
            width: 376.0,
            height: h,
        });
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

/// 调用平台原生文件夹选择对话框
#[tauri::command]
pub fn pick_folder() -> String {
    #[cfg(target_os = "macos")]
    {
        let script = r#"
            set folderPath to POSIX path of (choose folder with prompt "选择工作目录")
            return folderPath
        "#;
        let output = background_command("osascript")
            .arg("-e")
            .arg(script)
            .output();
        return match output {
            Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_end_matches('/')
                .to_string(),
            _ => String::new(),
        };
    }

    #[cfg(windows)]
    {
        let script = r#"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择工作目录"
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write($dialog.SelectedPath)
}
"#;
        let output = background_command("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .output();
        return match output {
            Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_end_matches(['\\', '/'])
                .to_string(),
            _ => String::new(),
        };
    }

    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        String::new()
    }
}
