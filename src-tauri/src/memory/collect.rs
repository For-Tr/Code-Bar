use super::store::{field, Binding, Result, Store};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
};

pub fn redact(text: &str) -> String {
    static SECRET: OnceLock<regex::Regex> = OnceLock::new();
    static PEM: OnceLock<regex::Regex> = OnceLock::new();
    let pem = PEM.get_or_init(|| {
        regex::Regex::new(
            r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        )
        .unwrap()
    });
    let re=SECRET.get_or_init(||regex::Regex::new(r#"(?im)(?:\b(?:[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)|authorization)\b["']?\s*[:=]\s*["']?(?:Bearer\s+)?[^\s,"']+|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,})"#).unwrap());
    re.replace_all(
        &pem.replace_all(text, "[REDACTED PRIVATE KEY]"),
        "[REDACTED]",
    )
    .into_owned()
}
fn content_text(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.into();
    }
    v.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| match field(item, "type") {
                    "text" | "input_text" | "output_text" => Some(field(item, "text").to_string()),
                    "tool_result" => {
                        Some(format!("Tool result: {}", content_text(&item["content"])))
                    }
                    "tool_use" => Some(format!(
                        "Tool call {}: {}",
                        field(item, "name"),
                        item["input"]
                    )),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
pub fn message_text(runner: &str, v: &Value) -> Option<String> {
    let text = if runner == "claude-code" {
        if !matches!(field(v, "type"), "user" | "assistant") {
            return None;
        }
        format!(
            "{}: {}",
            field(&v["message"], "role"),
            content_text(&v["message"]["content"])
        )
    } else if runner == "codex" {
        let p = &v["payload"];
        match (field(v, "type"), field(p, "type")) {
            ("response_item", "message") if matches!(field(p, "role"), "user" | "assistant") => {
                format!("{}: {}", field(p, "role"), content_text(&p["content"]))
            }
            ("response_item", "function_call") => {
                format!("Tool call {}: {}", field(p, "name"), field(p, "arguments"))
            }
            ("response_item", "function_call_output") => {
                format!("Tool result: {}", content_text(&p["output"]))
            }
            // Event copies are skipped to avoid duplicating response_item messages.
            _ => return None,
        }
    } else {
        return None;
    };
    if text.trim_end().ends_with(':')
        || text.contains("<environment_context>")
        || text.contains("<permissions instructions>")
    {
        return None;
    }
    Some(redact(&text))
}
fn git_read(path: &str, args: &[&str], limit: usize) -> Result<String> {
    let mut child = crate::util::background_command("git")
        .current_dir(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or("Missing git output")?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes);
    if read.is_err() || bytes.len() > limit {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    read.map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        bytes.truncate(limit);
        return Ok(format!(
            "{}\n[Evidence truncated at {limit} bytes]",
            String::from_utf8_lossy(&bytes)
        ));
    }
    if !status.success() {
        return Err("Cannot read Git history for this worktree".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into())
}
pub fn collect_git(store: &Store, b: &Binding) -> Result<usize> {
    if !Path::new(&b.worktree_path).is_dir() {
        return Ok(0);
    }
    let head = match git_read(&b.worktree_path, &["rev-parse", "HEAD"], 100) {
        Ok(s) => s.trim().to_string(),
        Err(_) => return Ok(0),
    };
    let page_key = format!("git-page:{}:{}", b.repo_id, b.task_id);
    let saved: Value = serde_json::from_str(&store.cursor(&page_key)?).unwrap_or(Value::Null);
    let offset = if saved["head"] == head {
        saved["offset"].as_u64().unwrap_or(0)
    } else {
        0
    };
    let shas = match git_read(
        &b.worktree_path,
        &[
            "log",
            "-20",
            &format!("--skip={offset}"),
            "--format=%H",
            &head,
            "--",
        ],
        2000,
    ) {
        Ok(s) => s,
        Err(_) => return Ok(0),
    };
    let mut queued = 0;
    for sha in shas.lines().filter(|s| s.len() == 40 || s.len() == 64) {
        if !sha.bytes().all(|x| x.is_ascii_hexdigit()) {
            continue;
        }
        let cursor = format!("git:{}:{}:{sha}", b.repo_id, b.task_id);
        if !store.cursor(&cursor)?.is_empty() {
            continue;
        }
        let text = git_read(
            &b.worktree_path,
            &[
                "show",
                "--no-ext-diff",
                "--no-textconv",
                "--format=fuller",
                "--stat",
                "--patch",
                sha,
                "--",
            ],
            96 * 1024,
        )?;
        store.enqueue(b,"git",sha,&redact(&text),"task",json!({"commit_sha":sha,"worktree":b.worktree_path,"evidence":"commit patch; rationale is unverified unless stated"}))?;
        store.save_cursor(&cursor, "1")?;
        queued += 1;
        if queued >= 20 {
            break;
        }
    }
    store.save_cursor(
        &page_key,
        &json!({"head":head,"offset":offset + shas.lines().count() as u64}).to_string(),
    )?;
    Ok(queued)
}
fn transcript_matches(path: &Path, b: &Binding) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    for line in BufReader::new(file.take(256 * 1024))
        .lines()
        .take(30)
        .map_while(std::result::Result::ok)
    {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let (id, cwd) = if b.runner_type == "codex" {
            if field(&v, "type") != "session_meta" {
                continue;
            }
            (field(&v["payload"], "id"), field(&v["payload"], "cwd"))
        } else {
            (field(&v, "sessionId"), field(&v, "cwd"))
        };
        if id == b.provider_session_id && !cwd.is_empty() {
            let normalize = |s: &str| std::fs::canonicalize(s).unwrap_or_else(|_| PathBuf::from(s));
            return normalize(cwd) == normalize(&b.worktree_path);
        }
    }
    false
}
fn find_transcript(store: &Store, b: &Binding) -> Result<Option<PathBuf>> {
    if b.provider_session_id.is_empty()
        || !b
            .provider_session_id
            .bytes()
            .all(|x| x.is_ascii_alphanumeric() || x == b'-')
    {
        return Ok(None);
    }
    let key = format!("transcript:{}:{}", b.token, b.provider_session_id);
    let cached = PathBuf::from(store.cursor(&key)?);
    if cached.is_file() && transcript_matches(&cached, b) {
        return Ok(Some(cached));
    }
    let root = if !b.provider_root.is_empty() {
        PathBuf::from(&b.provider_root)
    } else {
        match crate::util::resolve_provider_dir(&b.runner_type, "") {
            Some(p) => p,
            None => return Ok(None),
        }
    };
    let mut stack = if b.runner_type == "codex" {
        vec![root.join("sessions"), root.join("archived_sessions")]
    } else {
        vec![root.join("projects")]
    };
    let mut examined = 0;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            examined += 1;
            if examined > 30000 {
                return Err("Transcript scan limit reached; bind a recent native session".into());
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            if !entry
                .file_name()
                .to_string_lossy()
                .contains(&b.provider_session_id)
            {
                continue;
            }
            if transcript_matches(&path, b) {
                store.save_cursor(&key, &path.to_string_lossy())?;
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}
pub fn collect_transcript(store: &Store, b: &Binding) -> Result<usize> {
    let Some(path) = find_transcript(store, b)? else {
        return Ok(0);
    };
    collect_transcript_file(store, b, &path)
}
pub fn collect_transcript_file(store: &Store, b: &Binding, path: &Path) -> Result<usize> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let key = format!("offset:{}:{}", b.token, path.to_string_lossy());
    let mut offset = store.cursor(&key)?.parse::<u64>().unwrap_or(0);
    let skip_key = format!("skip:{key}");
    let mut skipping = store.cursor(&skip_key)? == "1";
    if file.metadata().map_err(|e| e.to_string())?.len() < offset {
        offset = 0;
        skipping = false;
        store.save_cursor(&skip_key, "0")?;
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut queued = 0;
    for _ in 0..256 {
        let mut line = Vec::new();
        let n = reader
            .by_ref()
            .take(1024 * 1024 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        let complete = line.ends_with(b"\n");
        if skipping || n > 1024 * 1024 {
            if !skipping {
                let locator = format!("{}:byte:{offset}:omitted", b.provider_session_id);
                store.enqueue(b, "session", &locator, "[Oversized transcript record omitted: exceeds 1 MiB. Consult the original transcript at the recorded byte offset. Subsequent records continue to be collected.]", "task", json!({"transcript_path":path.to_string_lossy(),"byte_offset":offset.to_string(),"omitted":"oversized record"}))?;
                queued += 1;
            }
            skipping = !complete;
            store.save_cursor(&skip_key, if skipping { "1" } else { "0" })?;
            offset += n as u64;
            store.save_cursor(&key, &offset.to_string())?;
            continue;
        }
        if !complete {
            break;
        } // The writer may still be appending this record.
        let start = offset;
        offset += n as u64;
        if let Ok(v) = serde_json::from_slice::<Value>(&line) {
            if let Some(text) = message_text(&b.runner_type, &v) {
                let locator = format!("{}:byte:{start}", b.provider_session_id);
                // Split on UTF-8 boundaries so very large tool results remain bounded documents.
                for (i, part) in split_text(&text, 64 * 1024).iter().enumerate() {
                    store.enqueue(b,"session",&format!("{locator}:part:{i}"),part,"task",json!({"transcript_path":path.to_string_lossy(),"byte_offset":start.to_string(),"timestamp":field(&v,"timestamp"),"evidence":"conversation; do not assume task success"}))?;
                    queued += 1;
                }
            }
        }
        store.save_cursor(&key, &offset.to_string())?;
    }
    Ok(queued)
}
fn split_text(text: &str, limit: usize) -> Vec<&str> {
    let mut rest = text;
    let mut parts = Vec::new();
    while !rest.is_empty() {
        let mut end = rest.len().min(limit);
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        parts.push(&rest[..end]);
        rest = &rest[end..];
    }
    parts
}
pub fn collect(store: &Store, b: &Binding) -> Result<usize> {
    if !store.config()?.enabled {
        return Err("Workspace memory is disabled".into());
    }
    let git = collect_git(store, b)?;
    Ok(git + collect_transcript(store, b)?)
}
