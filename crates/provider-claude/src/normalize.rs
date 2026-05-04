use daemon_core::ports::{CanonicalProviderEvent, NormalizedProviderEvent};
use serde_json::{json, Value};
use std::path::Path;

pub fn extract_provider_session_id(json: &Value) -> Option<String> {
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

pub fn normalize(payload: &Value) -> Vec<NormalizedProviderEvent> {
    let session_id = extract_non_empty_string(payload.get("code_bar_session_id"));
    let event_name = payload
        .get("hook_event_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let mut events = Vec::new();
    match event_name {
        "UserPromptSubmit" => {
            if let Some(provider_session_id) = extract_provider_session_id(payload) {
                events.push(NormalizedProviderEvent {
                    session_id: session_id.clone(),
                    event: CanonicalProviderEvent::ProviderSessionBound {
                        provider_session_id: provider_session_id.clone(),
                    },
                    event_type: "provider.session_bound".to_string(),
                    payload: json!({
                        "session_id": session_id.clone(),
                        "provider_session_id": provider_session_id,
                        "runner_type": "claude-code"
                    }),
                });
            }
            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::OutputChunk {
                    stream: Some("stdout".to_string()),
                    text: None,
                    base64: None,
                },
                event_type: "provider.running".to_string(),
                payload: json!({ "session_id": session_id.clone() }),
            });
        }
        "Stop" => {
            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::WaitingForInput,
                event_type: "provider.waiting_for_input".to_string(),
                payload: json!({ "session_id": session_id.clone() }),
            });
        }
        "StopFailure" => {
            let message = payload
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown error")
                .to_string();
            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::ErrorRaised {
                    message: message.clone(),
                },
                event_type: "provider.error_raised".to_string(),
                payload: json!({ "session_id": session_id.clone(), "error": message }),
            });
        }
        "Notification" => {
            let title = payload
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("Claude Code")
                .to_string();
            let message = payload
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let notification_type = payload
                .get("notification_type")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();

            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::OutputChunk {
                    stream: Some("stdout".to_string()),
                    text: Some(message.clone()),
                    base64: None,
                },
                event_type: "provider.output_chunk".to_string(),
                payload: json!({
                    "session_id": session_id.clone(),
                    "title": title,
                    "message": message,
                    "notification_type": notification_type,
                }),
            });
        }
        "ApprovalRequested" => {
            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::ApprovalRequested {
                    title: payload
                        .get("title")
                        .and_then(|value| value.as_str())
                        .map(ToString::to_string),
                    description: payload
                        .get("description")
                        .and_then(|value| value.as_str())
                        .map(ToString::to_string),
                    payload: payload.get("payload").cloned(),
                },
                event_type: "provider.approval_requested".to_string(),
                payload: json!({
                    "session_id": session_id.clone(),
                    "title": payload.get("title"),
                    "description": payload.get("description"),
                    "payload": payload.get("payload").cloned().unwrap_or(Value::Null),
                }),
            });
        }
        "RunExited" => {
            events.push(NormalizedProviderEvent {
                session_id: session_id.clone(),
                event: CanonicalProviderEvent::RunExited {
                    exit_code: payload
                        .get("exit_code")
                        .and_then(|value| value.as_i64())
                        .map(|value| value as i32),
                    signal: payload
                        .get("signal")
                        .and_then(|value| value.as_str())
                        .map(ToString::to_string),
                },
                event_type: "provider.run_exited".to_string(),
                payload: json!({
                    "session_id": session_id.clone(),
                    "exit_code": payload.get("exit_code"),
                    "signal": payload.get("signal"),
                }),
            });
        }
        _ => {}
    }

    events
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
