// ── 自定义通知模块（macOS 点击回调支持）──────────────────────────
//
// 标准的 tauri-plugin-notification 基于 notify-rust，而 notify-rust
// 在 macOS 上虽然依赖 mac-notification-sys（支持点击回调），
// 但自身未处理回调事件。
//
// 本模块直接调用 mac-notification-sys，实现：
//   1. 通知常驻等待用户交互（send_notification 会阻塞直到用户响应）
//   2. 用户点击通知后，向前端发射 "notification-clicked" 事件
//   3. 在独立线程中执行，不阻塞主线程
//
// 事件格式：
//   "notification-clicked" -> { "title": "...", "body": "..." }

#[cfg(target_os = "macos")]
pub mod macos {
    use tauri::Emitter;
    use tauri_plugin_notification::NotificationExt;

    /// 发送一条支持点击回调的原生 macOS 通知。
    ///
    /// - 在独立线程中调用 `mac_notification_sys::send_notification`，
    ///   该调用会**阻塞**直到用户对通知做出响应（点击 / 关闭 / 忽略）。
    /// - 用户点击通知正文后，向前端发射 `"notification-clicked"` 事件。
    ///
    /// `subtitle` 可传 `None`；`sound` 传 `true` 时播放默认提示音。
    pub fn send_with_click_callback(
        app: tauri::AppHandle,
        title: String,
        body: String,
        subtitle: Option<String>,
        sound: bool,
    ) {
        if tauri::is_dev() {
            let mut builder = app.notification().builder().title(&title).body(&body);
            if sound {
                builder = builder.sound("default");
            }
            if let Err(e) = builder.show() {
                eprintln!("[notification] dev fallback send 失败: {e}");
            }
            return;
        }

        std::thread::spawn(move || {
            use mac_notification_sys::{set_application, Notification, Sound};

            // 必须在第一次调用时设置正确的 bundle id；错误值会导致 mac-notification-sys
            // 后续无法纠正，开发态则改走上面的 tauri plugin fallback。
            let bundle_id = app.config().identifier.clone();
            if let Err(e) = set_application(&bundle_id) {
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
                    let _ = app.emit(
                        "notification-clicked",
                        serde_json::json!({
                            "title": title,
                            "body": body,
                            "action": "click",
                        }),
                    );
                }
                Ok(mac_notification_sys::NotificationResponse::ActionButton(ref action)) => {
                    eprintln!("[notification] action button clicked: {action}");
                    let _ = app.emit(
                        "notification-clicked",
                        serde_json::json!({
                            "title": title,
                            "body": body,
                            "action": action,
                        }),
                    );
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
/// 用户点击通知后，前端可监听 `"notification-clicked"` 事件：
/// ```ts
/// listen("notification-clicked", ({ payload }) => {
///   console.log("用户点击了通知:", payload.title, payload.body);
/// });
/// ```
#[tauri::command]
pub fn send_notification_with_callback(
    app: tauri::AppHandle,
    title: String,
    body: String,
    subtitle: Option<String>,
    sound: Option<bool>,
) -> Result<(), String> {
    let play_sound = sound.unwrap_or(true);

    #[cfg(target_os = "macos")]
    {
        macos::send_with_click_callback(app, title, body, subtitle, play_sound);
        return Ok(());
    }

    // 非 macOS 平台降级到 tauri-plugin-notification
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = subtitle; // 避免 unused warning
        let _ = play_sound;
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| format!("通知发送失败: {e}"))?;
        Ok(())
    }
}
