fn fallback_desktop_notification(
    app: &tauri::AppHandle,
    title: &str,
    body: &str,
    sound: bool,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let mut builder = app.notification().builder().title(title).body(body);
    if sound {
        builder = builder.sound("default");
    }
    builder.show().map_err(|e| format!("通知发送失败: {e}"))
}

#[cfg(target_os = "macos")]
pub mod macos {
    use std::sync::OnceLock;

    use tauri::Emitter;

    static APPLICATION_INIT: OnceLock<Result<(), String>> = OnceLock::new();

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

            let bundle_id = app.config().identifier.clone();
            let init_result = APPLICATION_INIT
                .get_or_init(|| set_application(&bundle_id).map_err(|e| e.to_string()));
            if let Err(err) = init_result {
                eprintln!(
                    "[notification] set_application({bundle_id}) failed, fallback to tauri plugin: {err}"
                );
                if let Err(show_err) =
                    super::fallback_desktop_notification(&app, &title, &body, sound)
                {
                    eprintln!("[notification] fallback send failed: {show_err}");
                }
                return;
            }

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

            eprintln!("[notification] sending macOS notification, waiting for click...");
            match notif.send() {
                Ok(mac_notification_sys::NotificationResponse::Click) => {
                    eprintln!(
                        "[notification] user clicked notification: title={title:?} session_id={session_id:?}"
                    );
                    crate::window::focus_popup(app.clone(), session_id.clone());
                    let _ = app.emit(
                        "notification-clicked",
                        serde_json::json!({
                            "title": title,
                            "body": body,
                            "action": "click",
                            "session_id": session_id,
                        }),
                    );
                }
                Ok(mac_notification_sys::NotificationResponse::ActionButton(ref action)) => {
                    eprintln!(
                        "[notification] action button clicked: action={action:?} session_id={session_id:?}"
                    );
                    crate::window::focus_popup(app.clone(), session_id.clone());
                    let _ = app.emit(
                        "notification-clicked",
                        serde_json::json!({
                            "title": title,
                            "body": body,
                            "action": action,
                            "session_id": session_id,
                        }),
                    );
                }
                Ok(other) => {
                    eprintln!("[notification] notification dismissed/ignored: {other:?}");
                }
                Err(err) => {
                    eprintln!("[notification] send failed: {err:?}");
                }
            }
        });
    }
}

#[cfg(target_os = "windows")]
pub mod windows {
    use std::path::MAIN_SEPARATOR as SEP;

    use tauri::Emitter;
    use tauri_winrt_notification::{Duration, Sound, Toast};

    fn toast_app_id(app: &tauri::AppHandle) -> String {
        let bundle_id = app.config().identifier.clone();
        let use_bundle_id = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()))
            .map(|dir| {
                !(dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
                    || dir.ends_with(format!("{SEP}target{SEP}release").as_str()))
            })
            .unwrap_or(true);

        if use_bundle_id {
            bundle_id
        } else {
            Toast::POWERSHELL_APP_ID.to_string()
        }
    }

    pub fn send_with_click_callback(
        app: tauri::AppHandle,
        title: String,
        body: String,
        subtitle: Option<String>,
        sound: bool,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let click_app = app.clone();
        let click_title = title.clone();
        let click_body = body.clone();
        let click_session_id = session_id.clone();

        let mut toast = Toast::new(&toast_app_id(&app))
            .title(&title)
            .text1(&body)
            .duration(Duration::Short)
            .sound(if sound { Some(Sound::Default) } else { None })
            .on_activated(move |action| {
                let action_label = action
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "click".to_string());

                eprintln!(
                    "[notification] windows toast activated: action={action_label:?} session_id={click_session_id:?}"
                );
                crate::window::focus_popup(click_app.clone(), click_session_id.clone());
                let _ = click_app.emit(
                    "notification-clicked",
                    serde_json::json!({
                        "title": click_title.clone(),
                        "body": click_body.clone(),
                        "action": action_label,
                        "session_id": click_session_id.clone(),
                    }),
                );
                Ok(())
            });

        if let Some(subtitle) = subtitle.as_deref().filter(|value| !value.trim().is_empty()) {
            toast = toast.text2(subtitle);
        }

        match toast.show() {
            Ok(()) => {
                eprintln!(
                    "[notification] windows toast queued: title={title:?} session_id={session_id:?}"
                );
                Ok(())
            }
            Err(err) => {
                eprintln!("[notification] windows toast failed, fallback to tauri plugin: {err}");
                super::fallback_desktop_notification(&app, &title, &body, sound)
            }
        }
    }
}

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

    #[cfg(target_os = "windows")]
    {
        return windows::send_with_click_callback(
            app, title, body, subtitle, play_sound, session_id,
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = subtitle;
        let _ = session_id;
        eprintln!(
            "[notification] desktop send requested: title={title:?} body_len={}",
            body.chars().count()
        );
        fallback_desktop_notification(&app, &title, &body, play_sound)?;
        eprintln!("[notification] desktop send queued");
        Ok(())
    }
}
