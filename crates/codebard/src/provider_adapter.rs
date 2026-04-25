use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, Session};
use daemon_core::ports::ProviderAdapter;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Default)]
pub struct RealProviderAdapter;

#[derive(Debug, Clone)]
pub struct NormalizedProviderEvent {
    pub event_type: String,
    pub session_id: Option<String>,
    pub payload: serde_json::Map<String, Value>,
}

impl RealProviderAdapter {
    pub fn extract_provider_session_id(provider: &str, json: &Value) -> Option<String> {
        match provider {
            "claude-code" => extract_claude_session_id(json),
            "codex" => extract_codex_session_id(json),
            _ => None,
        }
    }

    pub fn normalize_hook_events(provider: &str, json: &Value) -> Vec<NormalizedProviderEvent> {
        let session_id = extract_non_empty_string(json.get("code_bar_session_id"));
        let event_name = json
            .get("hook_event_name")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let mut events = Vec::new();

        match provider {
            "claude-code" => match event_name {
                "UserPromptSubmit" => {
                    if let Some(provider_session_id) = extract_claude_session_id(json) {
                        events.push(NormalizedProviderEvent {
                            event_type: "provider-session-bound".to_string(),
                            session_id: session_id.clone(),
                            payload: serde_json::Map::from_iter([
                                ("session_id".to_string(), json!(session_id.clone())),
                                ("runner_type".to_string(), json!("claude-code")),
                                ("provider_session_id".to_string(), json!(provider_session_id)),
                            ]),
                        });
                    }
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-running".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([("session_id".to_string(), json!(session_id.clone()))]),
                    });
                }
                "Stop" => {
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-waiting".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([("session_id".to_string(), json!(session_id.clone()))]),
                    });
                }
                "StopFailure" => {
                    let error = json
                        .get("error")
                        .and_then(|value| value.as_str())
                        .unwrap_or("unknown error")
                        .to_string();
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-error".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([
                            ("session_id".to_string(), json!(session_id.clone())),
                            ("error".to_string(), json!(error)),
                        ]),
                    });
                }
                "Notification" => {
                    let title = json.get("title").and_then(|value| value.as_str()).unwrap_or("Claude Code");
                    let message = json.get("message").and_then(|value| value.as_str()).unwrap_or("");
                    let notification_type = json
                        .get("notification_type")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-notification".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([
                            ("session_id".to_string(), json!(session_id.clone())),
                            ("title".to_string(), json!(title)),
                            ("message".to_string(), json!(message)),
                            ("notification_type".to_string(), json!(notification_type)),
                        ]),
                    });
                }
                _ => {}
            },
            "codex" => match event_name {
                "" => {
                    if let Some((title, message, notification_type)) = codex_notify_message(json) {
                        events.push(NormalizedProviderEvent {
                            event_type: "pty-notification".to_string(),
                            session_id: session_id.clone(),
                            payload: serde_json::Map::from_iter([
                                ("session_id".to_string(), json!(session_id.clone())),
                                ("title".to_string(), json!(title)),
                                ("message".to_string(), json!(message)),
                                ("notification_type".to_string(), json!(notification_type)),
                            ]),
                        });
                    }
                }
                "UserPromptSubmit" => {
                    if let Some(provider_session_id) = extract_codex_session_id(json) {
                        events.push(NormalizedProviderEvent {
                            event_type: "provider-session-bound".to_string(),
                            session_id: session_id.clone(),
                            payload: serde_json::Map::from_iter([
                                ("session_id".to_string(), json!(session_id.clone())),
                                ("runner_type".to_string(), json!("codex")),
                                ("provider_session_id".to_string(), json!(provider_session_id)),
                            ]),
                        });
                    }
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-running".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([("session_id".to_string(), json!(session_id.clone()))]),
                    });
                }
                "Stop" => {
                    events.push(NormalizedProviderEvent {
                        event_type: "pty-waiting".to_string(),
                        session_id: session_id.clone(),
                        payload: serde_json::Map::from_iter([("session_id".to_string(), json!(session_id.clone()))]),
                    });
                }
                _ => {}
            },
            _ => {}
        }

        events
    }
}

impl ProviderAdapter for RealProviderAdapter {
    fn bind_provider_session(
        &self,
        session: &Session,
        provider_session_id: &str,
    ) -> DomainResult<Option<String>> {
        let trimmed = provider_session_id.trim();
        if trimmed.is_empty() {
            return Err(ErrorEnvelope::new(
                ErrorCode::ProviderBindingFailed,
                "providerSessionId cannot be empty",
                false,
            ));
        }
        if session.provider_session_id.as_deref() == Some(trimmed) {
            Ok(None)
        } else {
            Ok(Some(trimmed.to_string()))
        }
    }
}

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
    extract_string_by_paths(
        json,
        &[
            &["session_id"],
            &["sessionId"],
            &["session", "id"],
            &["payload", "session_id"],
            &["payload", "sessionId"],
            &["payload", "session", "id"],
        ],
    )
}

fn codex_notify_message(json: &Value) -> Option<(String, String, String)> {
    let notification_type = json
        .get("type")
        .or_else(|| json.get("event"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();

    let title = json
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| "Codex".to_string());

    let message = [
        json.get("message"),
        json.get("last-assistant-message"),
        json.get("last_assistant_message"),
        json.get("summary"),
        json.get("detail"),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| value.as_str())
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(ToString::to_string)
    .unwrap_or_else(|| notification_type.clone());

    Some((title, message, notification_type))
}

#[cfg(test)]
mod tests {
    use super::RealProviderAdapter;
    use serde_json::json;

    #[test]
    fn extracts_claude_session_id_from_direct_field() {
        let payload = json!({ "session_id": "claude-123" });
        assert_eq!(
            RealProviderAdapter::extract_provider_session_id("claude-code", &payload).as_deref(),
            Some("claude-123")
        );
    }

    #[test]
    fn extracts_claude_session_id_from_transcript_path() {
        let payload = json!({ "transcript_path": "/tmp/sessions/claude-abc.jsonl" });
        assert_eq!(
            RealProviderAdapter::extract_provider_session_id("claude-code", &payload).as_deref(),
            Some("claude-abc")
        );
    }

    #[test]
    fn extracts_codex_session_id() {
        let payload = json!({ "payload": { "sessionId": "codex-456" } });
        assert_eq!(
            RealProviderAdapter::extract_provider_session_id("codex", &payload).as_deref(),
            Some("codex-456")
        );
    }
}
