use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::session_lifecycle::{resolve_session_ids, HookSource, SessionRoutingHint};
use crate::util::resolve_provider_dir;

fn normalize_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    if normalized == "/" {
        return "/".to_string();
    }

    while normalized.len() > 1 && normalized.ends_with('/') {
        #[cfg(windows)]
        if normalized.len() == 3 && normalized.as_bytes()[1] == b':' {
            break;
        }
        normalized.pop();
    }

    #[cfg(windows)]
    normalized.make_ascii_lowercase();

    normalized
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

fn collect_jsonl_files(dir: &Path, files: &mut Vec<(PathBuf, SystemTime)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_jsonl_files(&path, files);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((path, modified));
    }
}

fn read_codex_session_meta(path: &Path) -> Option<(String, String)> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(12).flatten() {
        let json: Value = serde_json::from_str(&line).ok()?;
        if json.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
            continue;
        }
        let id = extract_string_by_paths(&json, &[&["payload", "id"]])?;
        let cwd = extract_string_by_paths(&json, &[&["payload", "cwd"]])?;
        return Some((id, cwd));
    }
    None
}

fn codex_session_looks_meaningful(path: &Path) -> bool {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let reader = BufReader::new(file);
    let mut lines = 0usize;
    for line in reader.lines().flatten() {
        lines += 1;
        if line.contains("\"event_msg\"") || line.contains("\"response_item\"") {
            return true;
        }
        if lines >= 7 {
            return true;
        }
    }
    false
}

fn find_codex_session_by_cwd(cwd: &str) -> Option<String> {
    let base_dir = resolve_provider_dir("codex", "")?;
    let sessions_dir = base_dir.join("sessions");
    if !sessions_dir.exists() {
        return None;
    }

    let mut files = Vec::new();
    collect_jsonl_files(&sessions_dir, &mut files);
    files.sort_by(|a, b| b.1.cmp(&a.1));

    let target = normalize_path(cwd);
    let mut fallback_any: Option<String> = None;
    for (path, _) in files.into_iter().take(200) {
        let Some((id, meta_cwd)) = read_codex_session_meta(&path) else {
            continue;
        };
        if normalize_path(&meta_cwd) != target {
            continue;
        }
        if fallback_any.is_none() {
            fallback_any = Some(id.clone());
        }
        if codex_session_looks_meaningful(&path) {
            return Some(id);
        }
    }
    fallback_any
}

fn extract_codex_session_id(routing: &SessionRoutingHint, json: &Value) -> Option<String> {
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
    let cwd = routing.cwd.as_deref()?.trim();
    if cwd.is_empty() {
        return None;
    }
    find_codex_session_by_cwd(cwd)
}

fn resolve_provider_session_id(routing: &SessionRoutingHint, json: &Value) -> Option<String> {
    match routing.source {
        HookSource::ClaudeCode => extract_claude_session_id(json),
        HookSource::Codex => extract_codex_session_id(routing, json),
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
