use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::session_lifecycle::{resolve_session_ids, HookSource, SessionRoutingHint};

fn extract_non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn extract_string_by_paths<'a>(json: &'a Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut node = json;
        let mut ok = true;
        for key in *path {
            let Some(next) = node.get(*key) else {
                ok = false;
                break;
            };
            node = next;
        }
        if ok {
            if let Some(value) = extract_non_empty_string(Some(node)) {
                return Some(value);
            }
        }
    }
    None
}

fn extract_claude_session_id(json: &Value) -> Option<String> {
    let direct = extract_string_by_paths(
        json,
        &[
            &["session_id"],
            &["sessionId"],
            &["session", "id"],
            &["payload", "session_id"],
            &["payload", "sessionId"],
            &["payload", "session", "id"],
        ],
    );
    if direct.is_some() {
        return direct;
    }

    let transcript_path = extract_string_by_paths(
        json,
        &[
            &["transcript_path"],
            &["transcriptPath"],
            &["payload", "transcript_path"],
            &["payload", "transcriptPath"],
        ],
    )?;
    Path::new(&transcript_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn extract_codex_session_id(json: &Value) -> Option<String> {
    // Codex 的 cwd 只能定位到“目录”，不能唯一定位到“当前新建的 session”。
    // 新建多个会话或重复进入同目录时，按 cwd 回扫历史记录会把旧 session 误绑到新会话上。
    extract_string_by_paths(
        json,
        &[
            &["session_id"],
            &["session-id"],
            &["sessionId"],
            &["session", "id"],
            &["payload", "session-id"],
            &["payload", "session_id"],
            &["payload", "sessionId"],
            &["payload", "session", "id"],
            &["data", "session-id"],
            &["data", "session_id"],
            &["data", "sessionId"],
            &["data", "session", "id"],
        ],
    )
}

fn resolve_provider_session_id(routing: &SessionRoutingHint, json: &Value) -> Option<String> {
    match routing.source {
        HookSource::ClaudeCode => extract_claude_session_id(json),
        HookSource::Codex => extract_codex_session_id(json),
    }
}

pub fn emit_provider_session_bound(app: &AppHandle, routing: &SessionRoutingHint, json: &Value) {
    let session_ids = resolve_session_ids(app, routing);
    if session_ids.is_empty() {
        return;
    }

    let Some(provider_session_id) = resolve_provider_session_id(routing, json) else {
        return;
    };
    let runner_type = routing.source.runner_type();
    for session_id in session_ids {
        eprintln!(
            "[resume-bind:{runner_type}] code_bar_session={} provider_session={}",
            session_id, provider_session_id
        );
        let _ = app.emit(
            "provider-session-bound",
            serde_json::json!({
                "session_id": session_id,
                "runner_type": runner_type,
                "provider_session_id": provider_session_id,
            }),
        );
    }
}
