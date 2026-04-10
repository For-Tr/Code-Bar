use tauri::{AppHandle, Emitter, Manager};

use crate::state::{PtyKillerMap, PtySessionMetaMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookSource {
    ClaudeCode,
    Codex,
}

impl HookSource {
    pub fn runner_type(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
        }
    }

    #[cfg(unix)]
    pub fn socket_path(self) -> &'static str {
        match self {
            Self::ClaudeCode => "/tmp/code-bar-hook-claude.sock",
            Self::Codex => "/tmp/code-bar-hook-codex.sock",
        }
    }

    #[cfg(not(unix))]
    pub fn tcp_port(self) -> u16 {
        match self {
            Self::ClaudeCode => 46331,
            Self::Codex => 46332,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionRoutingHint {
    pub source: HookSource,
    pub code_bar_session_id: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SessionLifecycleSignal {
    Running,
    Waiting,
    Error {
        message: String,
    },
    Attention {
        title: String,
        message: String,
        notification_type: String,
    },
}

fn normalize_workdir(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    if normalized == "/" {
        return "/".to_string();
    }

    loop {
        if !normalized.ends_with('/') {
            break;
        }

        #[cfg(windows)]
        if normalized.len() == 3 && normalized.as_bytes()[1] == b':' {
            break;
        }

        if normalized.len() <= 1 {
            break;
        }

        normalized.pop();
    }

    #[cfg(windows)]
    normalized.make_ascii_lowercase();

    normalized
}

fn active_session_ids(app: &AppHandle) -> Vec<String> {
    let km_arc = app.state::<PtyKillerMap>().inner().clone();
    let km = km_arc.lock().unwrap();
    km.keys().cloned().collect()
}

pub(crate) fn resolve_session_ids(app: &AppHandle, routing: &SessionRoutingHint) -> Vec<String> {
    let active_ids = active_session_ids(app);
    if active_ids.is_empty() {
        return Vec::new();
    }

    let cwd = routing
        .cwd
        .as_deref()
        .map(normalize_workdir)
        .filter(|cwd| !cwd.is_empty());

    let meta_arc = app.state::<PtySessionMetaMap>().inner().clone();
    let meta = meta_arc.lock().unwrap();

    if let Some(session_id) = routing
        .code_bar_session_id
        .as_ref()
        .filter(|sid| !sid.trim().is_empty())
    {
        if !active_ids.iter().any(|sid| sid == session_id) {
            return Vec::new();
        }
        let Some(info) = meta.get(session_id) else {
            return Vec::new();
        };
        if info.runner_type != routing.source.runner_type() {
            return Vec::new();
        }
        if let Some(cwd) = &cwd {
            if normalize_workdir(&info.workdir) != *cwd {
                return Vec::new();
            }
        }
        return vec![session_id.clone()];
    }

    let mut cwd_matches: Vec<String> = active_ids
        .into_iter()
        .filter(|sid| {
            let Some(info) = meta.get(sid) else {
                return false;
            };
            if info.runner_type != routing.source.runner_type() {
                return false;
            }
            if let Some(cwd) = &cwd {
                return normalize_workdir(&info.workdir) == *cwd;
            }
            false
        })
        .collect();

    // 仅允许 cwd 唯一命中；多命中或未命中均丢弃，避免误路由污染状态。
    if cwd_matches.len() == 1 {
        return cwd_matches;
    }

    cwd_matches.clear();
    Vec::new()
}

pub fn emit_session_lifecycle(
    app: &AppHandle,
    routing: SessionRoutingHint,
    signal: SessionLifecycleSignal,
) {
    let session_ids = resolve_session_ids(app, &routing);
    if session_ids.is_empty() {
        eprintln!(
            "[hooks:{}] 未找到匹配的 Code Bar session: session_id={:?} cwd={:?}",
            routing.source.label(),
            routing.code_bar_session_id,
            routing.cwd
        );
        return;
    }

    match signal {
        SessionLifecycleSignal::Running => {
            for sid in session_ids {
                let _ = app.emit("pty-running", serde_json::json!({ "session_id": sid }));
            }
        }
        SessionLifecycleSignal::Waiting => {
            for sid in session_ids {
                let _ = app.emit("pty-waiting", serde_json::json!({ "session_id": sid }));
            }
        }
        SessionLifecycleSignal::Error { message } => {
            for sid in session_ids {
                let _ = app.emit(
                    "pty-error",
                    serde_json::json!({ "session_id": sid, "error": message.clone() }),
                );
            }
        }
        SessionLifecycleSignal::Attention {
            title,
            message,
            notification_type,
        } => {
            for sid in session_ids {
                let _ = crate::notification::send_notification_with_callback(
                    app.clone(),
                    title.clone(),
                    message.clone(),
                    None,
                    Some(true),
                    Some(sid.clone()),
                );

                let _ = app.emit(
                    "pty-notification",
                    serde_json::json!({
                        "session_id": sid,
                        "title": title.clone(),
                        "message": message.clone(),
                        "notification_type": notification_type.clone(),
                    }),
                );
            }
        }
    }
}
