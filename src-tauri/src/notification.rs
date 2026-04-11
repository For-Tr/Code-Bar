// ── 自定义通知模块（macOS 点击回调支持）──────────────────────────
//
// 标准的 tauri-plugin-notification 基于 notify-rust，而 notify-rust
// 在 macOS 上虽然依赖 mac-notification-sys（支持点击回调），
// 但自身未处理回调事件。
//
// 本模块直接调用 mac-notification-sys，实现：
//   1. 通知常驻等待用户交互（send_notification 会阻塞直到用户响应）
//   2. 用户点击通知后，统一走 focus_popup(session_id) 链路
//   3. 在独立线程中执行，不阻塞主线程

#[cfg(target_os = "macos")]
pub mod macos {
    use std::sync::OnceLock;
    use tauri_plugin_notification::NotificationExt;

    static MAC_NOTIFICATION_APP_INIT: OnceLock<Result<(), String>> = OnceLock::new();

    /// 发送一条支持点击回调的原生 macOS 通知。
    ///
    /// - 在独立线程中调用 `mac_notification_sys::send_notification`，
    ///   该调用会**阻塞**直到用户对通知做出响应（点击 / 关闭 / 忽略）。
    /// - 用户点击通知正文后，统一走 `focus_popup(session_id)`。
    ///
    /// `subtitle` 可传 `None`；`sound` 传 `true` 时播放默认提示音。
    pub fn send_with_click_callback(
        app: tauri::AppHandle,
        title: String,
        body: String,
        subtitle: Option<String>,
        sound: bool,
        session_id: Option<String>,
    ) {
        std::thread::spawn(move || {
            use mac_notification_sys::{set_application, Notification, Sound};

            // set_application 只允许成功设置一次；后续重复调用会报错。
            // 用 OnceLock 保证进程内只初始化一次，避免“有时成功有时失败”。
            let bundle_id = app.config().identifier.clone();
            let init_result = MAC_NOTIFICATION_APP_INIT.get_or_init(|| {
                set_application(&bundle_id).map_err(|e| e.to_string())
            });
            if let Err(e) = init_result {
                eprintln!(
                    "[notification] set_application({bundle_id}) 失败，降级到 tauri plugin: {e}"
                );
                let mut builder = app.notification().builder().title(&title).body(&body);
                if sound {
                    builder = builder.sound("default");
                }
                if let Err(show_err) = builder.show() {
                    eprintln!("[notification] fallback send 失败: {show_err}");
                }
                return;
            }

            // 使用 Notification builder API：
            //   .wait_for_click(true) —— 阻塞等待用户点击，返回 Click 而非 None
            //   .asynchronous(false)  —— 同步模式，配合 wait_for_click 使用
            let mut notif = Notification::new();
            notif.title(&title);
            notif.message(&body);
            notif.wait_for_click(true);
            notif.asynchronous(false);
            if sound {
                notif.sound(Sound::Default);
            }
            if let Some(ref sub) = subtitle {
                notif.subtitle(sub.as_str());
            }

            eprintln!("[notification] sending notification, waiting for click...");
            let response = notif.send();

            match response {
                Ok(mac_notification_sys::NotificationResponse::Click) => {
                    eprintln!("[notification] user clicked notification: {title}");
                    let sid = session_id.clone();
                    let app_for_focus = app.clone();
                    if let Err(err) = app.run_on_main_thread(move || {
                        crate::window::focus_popup(app_for_focus, sid);
                    }) {
                        eprintln!("[notification] run_on_main_thread(focus_popup) 失败: {err}");
                    }
                }
                Ok(mac_notification_sys::NotificationResponse::ActionButton(ref action)) => {
                    eprintln!("[notification] action button clicked: {action}");
                    let sid = session_id.clone();
                    let app_for_focus = app.clone();
                    if let Err(err) = app.run_on_main_thread(move || {
                        crate::window::focus_popup(app_for_focus, sid);
                    }) {
                        eprintln!("[notification] run_on_main_thread(focus_popup) 失败: {err}");
                    }
                }
                Ok(other) => {
                    eprintln!("[notification] notification dismissed/ignored: {other:?}");
                }
                Err(e) => {
                    eprintln!("[notification] send 失败: {e:?}");
                }
            }
        });
    }
}

// ── Tauri 命令：统一入口 ─────────────────────────────────────────

/// 发送系统通知（macOS：使用原生回调；其他平台：降级到 tauri-plugin-notification）
///
/// 用户点击通知后，后端会统一调度 `focus_popup(session_id)`。
#[tauri::command]
pub fn send_notification_with_callback(
    app: tauri::AppHandle,
    title: String,
    body: String,
    subtitle: Option<String>,
    sound: Option<bool>,
    session_id: Option<String>,
) -> Result<(), String> {
    let play_sound = sound.unwrap_or(true);

    #[cfg(target_os = "macos")]
    {
        macos::send_with_click_callback(app, title, body, subtitle, play_sound, session_id);
        return Ok(());
    }

    // 非 macOS 平台降级到 tauri-plugin-notification
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = subtitle; // 避免 unused warning
        let _ = play_sound;
        eprintln!(
            "[notification] desktop send requested: title={title:?} body_len={}",
            body.chars().count()
        );
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| format!("通知发送失败: {e}"))?;
        eprintln!("[notification] desktop send queued");
        Ok(())
    }
}
