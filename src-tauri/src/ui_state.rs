use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::runtime_scope::{session_worktree_root_dir, ui_state_namespace_dir};
use crate::util::{background_command, home_dir, normalize_expanded_path};

const UI_STATE_DIR: &str = "ui-state";
const DELETED_UI_STATE_KEY: &str = "code-bar-deleted-items";
const RECOVERY_BINDINGS_KEY: &str = "code-bar-recovery-bindings";
const SESSION_ID_STATE_KEY: &str = "code-bar-session-id-state";
static SESSION_ID_STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveredRunnerConfig {
    r#type: String,
    cli_path: String,
    cli_args: String,
    api_base_url: String,
    api_key_override: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredSession {
    id: String,
    name: String,
    workspace_id: String,
    workdir: String,
    status: String,
    current_task: String,
    created_at: u64,
    diff_files: Vec<serde_json::Value>,
    output: Vec<String>,
    runner: RecoveredRunnerConfig,
    branch_name: Option<String>,
    base_branch: Option<String>,
    worktree_path: Option<String>,
    provider_session_id: Option<String>,
}

#[derive(Debug, Clone)]
struct RecoveryHint {
    runner_type: String,
    provider_session_id: String,
    current_task: String,
    modified_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DeletedSessionRef {
    session_id: String,
    #[serde(default)]
    workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DeletedWorkspaceRef {
    workspace_id: String,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedUiState {
    #[serde(default)]
    session_ids: Vec<String>,
    #[serde(default)]
    workspace_ids: Vec<String>,
    #[serde(default)]
    sessions: Vec<DeletedSessionRef>,
    #[serde(default)]
    workspaces: Vec<DeletedWorkspaceRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionInput {
    session_id: String,
    #[serde(default)]
    workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkspaceInput {
    workspace_id: String,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryBinding {
    session_id: String,
    runner_type: String,
    provider_session_id: String,
    #[serde(default)]
    worktree_path: Option<String>,
    #[serde(default)]
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIdState {
    #[serde(default = "default_next_session_id")]
    next_session_id: u64,
}

fn default_next_session_id() -> u64 {
    1
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_path(value: Option<String>) -> Option<String> {
    normalize_optional_string(value).map(|path| normalize_expanded_path(&path))
}

impl RecoveryBinding {
    fn normalized(self) -> Option<Self> {
        let session_id = self.session_id.trim().to_string();
        let runner_type = self.runner_type.trim().to_string();
        let provider_session_id = self.provider_session_id.trim().to_string();
        if session_id.is_empty() || runner_type.is_empty() || provider_session_id.is_empty() {
            return None;
        }

        Some(Self {
            session_id,
            runner_type,
            provider_session_id,
            worktree_path: normalize_path(self.worktree_path),
            updated_at_ms: if self.updated_at_ms == 0 {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0)
            } else {
                self.updated_at_ms
            },
        })
    }
}

impl DeletedSessionRef {
    fn normalized(self) -> Option<Self> {
        let session_id = self.session_id.trim().to_string();
        if session_id.is_empty() {
            return None;
        }

        Some(Self {
            session_id,
            workspace_id: normalize_optional_string(self.workspace_id),
        })
    }

    fn matches(&self, session_id: &str, workspace_id: Option<&str>) -> bool {
        if self.session_id != session_id.trim() {
            return false;
        }

        match self.workspace_id.as_deref() {
            Some(expected) => workspace_id.map(str::trim) == Some(expected),
            None => true,
        }
    }
}

impl DeletedWorkspaceRef {
    fn normalized(self) -> Option<Self> {
        let workspace_id = self.workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return None;
        }

        Some(Self {
            workspace_id,
            path: normalize_path(self.path),
        })
    }

    fn matches(&self, workspace_id: &str, path: Option<&str>) -> bool {
        if self.workspace_id != workspace_id.trim() {
            return false;
        }

        match self.path.as_deref() {
            Some(expected) => path.map(|value| value.trim_end_matches('/')) == Some(expected),
            None => true,
        }
    }
}

fn unique_session_refs(values: Vec<DeletedSessionRef>) -> Vec<DeletedSessionRef> {
    let mut seen = HashSet::new();
    let mut next = Vec::new();

    for value in values.into_iter().filter_map(DeletedSessionRef::normalized) {
        let key = (
            value.session_id.clone(),
            value.workspace_id.clone().unwrap_or_default(),
        );
        if seen.insert(key) {
            next.push(value);
        }
    }

    next.sort_by(|a, b| {
        a.session_id
            .cmp(&b.session_id)
            .then_with(|| a.workspace_id.cmp(&b.workspace_id))
    });
    next
}

fn unique_workspace_refs(values: Vec<DeletedWorkspaceRef>) -> Vec<DeletedWorkspaceRef> {
    let mut seen = HashSet::new();
    let mut next = Vec::new();

    for value in values.into_iter().filter_map(DeletedWorkspaceRef::normalized) {
        let key = (
            value.workspace_id.clone(),
            value.path.clone().unwrap_or_default(),
        );
        if seen.insert(key) {
            next.push(value);
        }
    }

    next.sort_by(|a, b| {
        a.workspace_id
            .cmp(&b.workspace_id)
            .then_with(|| a.path.cmp(&b.path))
    });
    next
}

fn normalize_deleted_ui_state(mut state: DeletedUiState) -> DeletedUiState {
    state.session_ids = state
        .session_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    state.workspace_ids = state
        .workspace_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    state.session_ids
        .sort_by_key(|id| id.parse::<u64>().unwrap_or(u64::MAX));
    state.workspace_ids.sort();
    state.sessions = unique_session_refs(state.sessions);
    state.workspaces = unique_workspace_refs(state.workspaces);
    state
}

fn ui_state_file(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let sanitized = key
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    app.path()
        .app_data_dir()
        .map(|dir| {
            let mut state_dir = dir.join(UI_STATE_DIR);
            if let Some(namespace) = ui_state_namespace_dir() {
                state_dir = state_dir.join(namespace);
            }
            state_dir.join(format!("{sanitized}.json"))
        })
        .map_err(|e| format!("无法解析 UI 状态目录: {e}"))
}

fn read_ui_state(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let path = ui_state_file(app, key)?;
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取 {} 失败: {e}", path.display())),
    }
}

fn write_ui_state(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    let path = ui_state_file(app, key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建 UI 状态目录 {} 失败: {e}", parent.display()))?;
    }

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, value).map_err(|e| format!("写入 {} 失败: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("替换 {} 失败: {e}", path.display()))
}

fn remove_ui_state_file(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let path = ui_state_file(app, key)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 {} 失败: {e}", path.display())),
    }
}

fn read_deleted_ui_state(app: &tauri::AppHandle) -> Result<DeletedUiState, String> {
    let Some(content) = read_ui_state(app, DELETED_UI_STATE_KEY)? else {
        return Ok(DeletedUiState::default());
    };

    serde_json::from_str::<DeletedUiState>(&content)
        .map(normalize_deleted_ui_state)
        .map_err(|e| format!("解析已删除 UI 状态失败: {e}"))
}

fn write_deleted_ui_state(app: &tauri::AppHandle, state: &DeletedUiState) -> Result<(), String> {
    let payload = serde_json::to_string(&normalize_deleted_ui_state(state.clone()))
        .map_err(|e| format!("序列化已删除 UI 状态失败: {e}"))?;
    write_ui_state(app, DELETED_UI_STATE_KEY, &payload)
}

fn read_recovery_bindings(app: &tauri::AppHandle) -> Result<Vec<RecoveryBinding>, String> {
    let Some(content) = read_ui_state(app, RECOVERY_BINDINGS_KEY)? else {
        return Ok(Vec::new());
    };

    serde_json::from_str::<Vec<RecoveryBinding>>(&content)
        .map(|items| items.into_iter().filter_map(RecoveryBinding::normalized).collect())
        .map_err(|e| format!("解析恢复绑定失败: {e}"))
}

fn read_session_id_state(app: &tauri::AppHandle) -> Result<SessionIdState, String> {
    let Some(content) = read_ui_state(app, SESSION_ID_STATE_KEY)? else {
        return Ok(SessionIdState::default());
    };

    serde_json::from_str::<SessionIdState>(&content)
        .map(|state| SessionIdState {
            next_session_id: state.next_session_id.max(default_next_session_id()),
        })
        .map_err(|e| format!("解析 session ID 状态失败: {e}"))
}

fn write_session_id_state(app: &tauri::AppHandle, state: &SessionIdState) -> Result<(), String> {
    let payload = serde_json::to_string(&SessionIdState {
        next_session_id: state.next_session_id.max(default_next_session_id()),
    })
    .map_err(|e| format!("序列化 session ID 状态失败: {e}"))?;
    write_ui_state(app, SESSION_ID_STATE_KEY, &payload)
}

fn write_recovery_bindings(app: &tauri::AppHandle, bindings: &[RecoveryBinding]) -> Result<(), String> {
    if bindings.is_empty() {
        return remove_ui_state_file(app, RECOVERY_BINDINGS_KEY);
    }

    let payload = serde_json::to_string(bindings)
        .map_err(|e| format!("序列化恢复绑定失败: {e}"))?;
    write_ui_state(app, RECOVERY_BINDINGS_KEY, &payload)
}

fn upsert_recovery_binding(app: &tauri::AppHandle, binding: RecoveryBinding) -> Result<(), String> {
    let Some(binding) = binding.normalized() else {
        return Ok(());
    };

    let mut bindings = read_recovery_bindings(app)?;
    bindings.retain(|entry| entry.session_id != binding.session_id);
    bindings.push(binding);
    bindings.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    write_recovery_bindings(app, &bindings)
}

fn remove_recovery_bindings_by_session_ids(
    app: &tauri::AppHandle,
    session_ids: &HashSet<String>,
) -> Result<(), String> {
    if session_ids.is_empty() {
        return Ok(());
    }

    let mut bindings = read_recovery_bindings(app)?;
    bindings.retain(|entry| !session_ids.contains(&entry.session_id));
    write_recovery_bindings(app, &bindings)
}

fn modified_millis(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn default_base_branch(repo_root: &Path) -> Option<String> {
    for candidate in ["main", "master"] {
        let Ok(output) = background_command("git")
            .current_dir(repo_root)
            .args(["rev-parse", "--verify", candidate])
            .output()
        else {
            continue;
        };

        if output.status.success() {
            return Some(candidate.to_string());
        }
    }

    None
}

fn current_branch(path: &Path) -> Option<String> {
    let Ok(output) = background_command("git")
        .current_dir(path)
        .args(["branch", "--show-current"])
        .output()
    else {
        return None;
    };

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

fn normalize_task_title(task: &str, session_id: &str) -> String {
    let trimmed = task.trim();
    if trimmed.is_empty() {
        return format!("会话 {session_id}");
    }

    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() > 24 {
        format!("{}…", chars[..24].iter().collect::<String>())
    } else {
        trimmed.to_string()
    }
}

fn select_newer_hint(current: &mut Option<RecoveryHint>, candidate: RecoveryHint) {
    if current
        .as_ref()
        .map(|existing| existing.modified_at_ms < candidate.modified_at_ms)
        .unwrap_or(true)
    {
        *current = Some(candidate);
    }
}

fn extract_claude_first_task(json: &serde_json::Value) -> Option<String> {
    let is_user = json.get("type").and_then(|v| v.as_str()) == Some("user");
    let role = json
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(|value| value.as_str());
    if !is_user || role != Some("user") {
        return None;
    }

    let content = json.get("message")?.get("content")?;
    let text = content.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn latest_claude_hint(session_id: &str) -> Option<RecoveryHint> {
    let projects_dir = home_dir()?.join(".claude").join("projects");
    let suffix = format!("session-{session_id}");
    let mut best: Option<RecoveryHint> = None;

    let Ok(project_entries) = fs::read_dir(&projects_dir) else {
        return None;
    };

    for entry in project_entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(&suffix) {
            continue;
        }

        let Ok(files) = fs::read_dir(&path) else {
            continue;
        };

        for file in files.flatten() {
            let file_path = file.path();
            if file_path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }

            let provider_session_id = file_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_string();
            if provider_session_id.is_empty() {
                continue;
            }

            let Ok(handle) = fs::File::open(&file_path) else {
                continue;
            };
            let reader = BufReader::new(handle);
            let mut first_task = String::new();

            for line in reader.lines().map_while(Result::ok) {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                if let Some(task) = extract_claude_first_task(&json) {
                    first_task = task;
                    break;
                }
            }

            // 有些 Claude 会话在未成功发起首条 query 前也会落盘 session 文件。
            // 这种场景下仍然应该可恢复，任务标题退化为通用文案。
            if first_task.is_empty() {
                first_task = "继续会话".to_string();
            }

            select_newer_hint(
                &mut best,
                RecoveryHint {
                    runner_type: "claude-code".to_string(),
                    provider_session_id,
                    current_task: first_task,
                    modified_at_ms: modified_millis(&file_path),
                },
            );
        }
    }

    best
}

fn is_codex_wrapper_text(text: &str) -> bool {
    matches!(
        text.trim(),
        value if value.starts_with("<environment_context>") || value.starts_with("<turn_aborted>")
    )
}

fn extract_codex_first_task(json: &serde_json::Value) -> Option<String> {
    let payload = json.get("payload")?;
    if json.get("type").and_then(|value| value.as_str()) == Some("event_msg")
        && payload.get("type").and_then(|value| value.as_str()) == Some("user_message")
    {
        return payload
            .get("message")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty() && !is_codex_wrapper_text(text))
            .map(ToString::to_string);
    }

    if json.get("type").and_then(|value| value.as_str()) == Some("response_item") {
        let message = payload.get("type").and_then(|value| value.as_str()) == Some("message");
        let role = payload.get("role").and_then(|value| value.as_str()) == Some("user");
        if !message || !role {
            return None;
        }
        let text = payload
            .get("content")
            .and_then(|value| value.as_array())
            .and_then(|items| {
                items.iter().find_map(|item| {
                    if item.get("type").and_then(|value| value.as_str()) != Some("input_text") {
                        return None;
                    }
                    let text = item.get("text").and_then(|value| value.as_str())?.trim();
                    if text.is_empty() || is_codex_wrapper_text(text) {
                        return None;
                    }
                    Some(text.to_string())
                })
            });
        if text.is_some() {
            return text;
        }
    }

    None
}

fn load_codex_history_index() -> HashMap<String, RecoveryHint> {
    let Some(sessions_dir) = home_dir().map(|home| home.join(".codex").join("sessions")) else {
        return HashMap::new();
    };
    let mut hints = HashMap::new();
    let mut stack = vec![sessions_dir];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }

            let Ok(handle) = fs::File::open(&path) else {
                continue;
            };
            let reader = BufReader::new(handle);
            let mut provider_session_id = String::new();
            let mut cwd = String::new();
            let mut first_task = String::new();

            for line in reader.lines().map_while(Result::ok) {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };

                if provider_session_id.is_empty() {
                    provider_session_id = json
                        .get("payload")
                        .and_then(|payload| payload.get("id"))
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                }

                if cwd.is_empty() {
                    cwd = json
                        .get("payload")
                        .and_then(|payload| payload.get("cwd"))
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                }

                if first_task.is_empty() {
                    if let Some(task) = extract_codex_first_task(&json) {
                        first_task = task;
                    }
                }

                if !provider_session_id.is_empty() && !cwd.is_empty() && !first_task.is_empty() {
                    break;
                }
            }

            if provider_session_id.is_empty() || cwd.is_empty() || first_task.is_empty() {
                continue;
            }

            let normalized_cwd = normalize_expanded_path(&cwd);
            let candidate = RecoveryHint {
                runner_type: "codex".to_string(),
                provider_session_id,
                current_task: first_task,
                modified_at_ms: modified_millis(&path),
            };
            let slot = hints.entry(normalized_cwd).or_insert_with(|| candidate.clone());
            if slot.modified_at_ms < candidate.modified_at_ms {
                *slot = candidate;
            }
        }
    }

    hints
}

fn resolve_recovery_hint(
    session_id: &str,
    worktree_path: &Path,
    recovery_bindings: &HashMap<String, RecoveryBinding>,
    codex_history: &HashMap<String, RecoveryHint>,
) -> Option<RecoveryHint> {
    let worktree_key = normalize_expanded_path(&worktree_path.to_string_lossy());
    if let Some(binding) = recovery_bindings.get(session_id) {
        if binding.runner_type == "claude-code" {
            let mut hint = latest_claude_hint(session_id)?;
            hint.provider_session_id = binding.provider_session_id.clone();
            hint.modified_at_ms = hint.modified_at_ms.max(binding.updated_at_ms);
            return Some(hint);
        }

        if binding.runner_type == "codex" {
            let mut hint = codex_history.get(&worktree_key).cloned()?;
            if hint.provider_session_id != binding.provider_session_id {
                return None;
            }
            hint.modified_at_ms = hint.modified_at_ms.max(binding.updated_at_ms);
            return Some(hint);
        }
    }

    latest_claude_hint(session_id)
}

fn numeric_session_id(name: &str) -> Option<String> {
    let trimmed = name.strip_prefix("session-")?;
    if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn parse_numeric_session_id(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()
}

fn collect_known_session_id_floor(
    deleted_state: &DeletedUiState,
    recovery_bindings: &[RecoveryBinding],
    workspaces: &[RecoverWorkspaceInput],
    existing_session_ids: &[String],
) -> u64 {
    let mut max_seen = 0_u64;

    for id in existing_session_ids {
        if let Some(value) = parse_numeric_session_id(id) {
            max_seen = max_seen.max(value);
        }
    }

    for id in &deleted_state.session_ids {
        if let Some(value) = parse_numeric_session_id(id) {
            max_seen = max_seen.max(value);
        }
    }

    for entry in &deleted_state.sessions {
        if let Some(value) = parse_numeric_session_id(&entry.session_id) {
            max_seen = max_seen.max(value);
        }
    }

    for binding in recovery_bindings {
        if let Some(value) = parse_numeric_session_id(&binding.session_id) {
            max_seen = max_seen.max(value);
        }
    }

    for workspace in workspaces {
        let normalized_workspace_path = normalize_path(Some(workspace.workspace_path.clone())).unwrap_or_default();
        if normalized_workspace_path.is_empty() {
            continue;
        }

        let repo_root = PathBuf::from(&normalized_workspace_path);
        let Some(parent) = repo_root.parent() else {
            continue;
        };

        let worktree_root = parent.join(session_worktree_root_dir());
        let Ok(entries) = fs::read_dir(&worktree_root) else {
            continue;
        };

        for entry in entries.flatten() {
            let worktree_path = entry.path();
            if !worktree_path.is_dir() {
                continue;
            }

            let Some(dir_name) = worktree_path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(session_id) = numeric_session_id(dir_name) else {
                continue;
            };
            let Some(value) = parse_numeric_session_id(&session_id) else {
                continue;
            };

            max_seen = max_seen.max(value);
        }
    }

    max_seen
}

#[tauri::command]
pub fn reserve_session_id(
    app: tauri::AppHandle,
    workspaces: Vec<RecoverWorkspaceInput>,
    existing_session_ids: Vec<String>,
) -> Result<String, String> {
    let _lock = SESSION_ID_STATE_LOCK
        .lock()
        .map_err(|e| format!("锁定 session ID 状态失败: {e}"))?;
    let deleted_state = read_deleted_ui_state(&app)?;
    let recovery_bindings = read_recovery_bindings(&app)?;
    let mut state = read_session_id_state(&app)?;
    let floor = collect_known_session_id_floor(
        &deleted_state,
        &recovery_bindings,
        &workspaces,
        &existing_session_ids,
    );

    let candidate = state.next_session_id.max(floor.saturating_add(1));
    state.next_session_id = candidate.saturating_add(1).max(default_next_session_id());
    write_session_id_state(&app, &state)?;
    Ok(candidate.to_string())
}

#[tauri::command]
pub fn load_ui_states(
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    let mut states = HashMap::new();
    for key in keys {
        states.insert(key.clone(), read_ui_state(&app, &key)?);
    }
    Ok(states)
}

#[tauri::command]
pub fn save_ui_state(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    write_ui_state(&app, &key, &value)
}

#[tauri::command]
pub fn remove_ui_state(app: tauri::AppHandle, key: String) -> Result<(), String> {
    remove_ui_state_file(&app, &key)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecoveryBindingInput {
    session_id: String,
    runner_type: String,
    provider_session_id: String,
    #[serde(default)]
    worktree_path: Option<String>,
}

#[tauri::command]
pub fn load_deleted_ui_state(app: tauri::AppHandle) -> Result<DeletedUiState, String> {
    read_deleted_ui_state(&app)
}

#[tauri::command]
pub fn save_recovery_binding(
    app: tauri::AppHandle,
    input: SaveRecoveryBindingInput,
) -> Result<(), String> {
    upsert_recovery_binding(
        &app,
        RecoveryBinding {
            session_id: input.session_id,
            runner_type: input.runner_type,
            provider_session_id: input.provider_session_id,
            worktree_path: input.worktree_path,
            updated_at_ms: 0,
        },
    )
}

#[tauri::command]
pub fn mark_deleted_items(
    app: tauri::AppHandle,
    session_ids: Vec<String>,
    workspace_ids: Vec<String>,
    session_refs: Vec<DeleteSessionInput>,
    workspace_refs: Vec<DeleteWorkspaceInput>,
) -> Result<(), String> {
    let mut state = read_deleted_ui_state(&app)?;
    let mut next_session_ids = state.session_ids.into_iter().collect::<HashSet<_>>();
    let mut next_workspace_ids = state.workspace_ids.into_iter().collect::<HashSet<_>>();
    let mut next_session_refs = state.sessions;
    let mut next_workspace_refs = state.workspaces;

    session_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .for_each(|id| {
            next_session_ids.insert(id);
        });
    workspace_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .for_each(|id| {
            next_workspace_ids.insert(id);
        });

    next_session_refs.extend(session_refs.into_iter().filter_map(|item| {
        DeletedSessionRef {
            session_id: item.session_id,
            workspace_id: item.workspace_id,
        }
        .normalized()
    }));
    next_workspace_refs.extend(workspace_refs.into_iter().filter_map(|item| {
        DeletedWorkspaceRef {
            workspace_id: item.workspace_id,
            path: item.path,
        }
        .normalized()
    }));

    state.session_ids = next_session_ids.into_iter().collect();
    state.workspace_ids = next_workspace_ids.into_iter().collect();
    state.sessions = unique_session_refs(next_session_refs);
    state.workspaces = unique_workspace_refs(next_workspace_refs);
    write_deleted_ui_state(&app, &state)
}

#[tauri::command]
pub fn clear_deleted_items(
    app: tauri::AppHandle,
    session_ids: Vec<String>,
    workspace_ids: Vec<String>,
    session_refs: Vec<DeleteSessionInput>,
    workspace_refs: Vec<DeleteWorkspaceInput>,
) -> Result<(), String> {
    let mut state = read_deleted_ui_state(&app)?;
    let removed_session_ids = session_ids.into_iter().collect::<HashSet<_>>();
    let removed_workspace_ids = workspace_ids.into_iter().collect::<HashSet<_>>();
    let removed_session_refs = session_refs
        .into_iter()
        .filter_map(|item| {
            DeletedSessionRef {
                session_id: item.session_id,
                workspace_id: item.workspace_id,
            }
            .normalized()
        })
        .collect::<Vec<_>>();
    let removed_workspace_refs = workspace_refs
        .into_iter()
        .filter_map(|item| {
            DeletedWorkspaceRef {
                workspace_id: item.workspace_id,
                path: item.path,
            }
            .normalized()
        })
        .collect::<Vec<_>>();

    state.session_ids
        .retain(|id| !removed_session_ids.contains(id));
    state.workspace_ids
        .retain(|id| !removed_workspace_ids.contains(id));
    remove_recovery_bindings_by_session_ids(&app, &removed_session_ids)?;
    state.sessions.retain(|entry| {
        !removed_session_refs
            .iter()
            .any(|removed| removed.matches(&entry.session_id, entry.workspace_id.as_deref()))
    });
    state.workspaces.retain(|entry| {
        !removed_workspace_refs
            .iter()
            .any(|removed| removed.matches(&entry.workspace_id, entry.path.as_deref()))
    });

    if state.session_ids.is_empty()
        && state.workspace_ids.is_empty()
        && state.sessions.is_empty()
        && state.workspaces.is_empty()
    {
        remove_ui_state_file(&app, DELETED_UI_STATE_KEY)
    } else {
        write_deleted_ui_state(&app, &state)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverWorkspaceInput {
    workspace_id: String,
    workspace_path: String,
}

#[tauri::command]
pub fn recover_workspace_sessions(
    app: tauri::AppHandle,
    workspaces: Vec<RecoverWorkspaceInput>,
    existing_session_ids: Vec<String>,
) -> Result<Vec<RecoveredSession>, String> {
    if workspaces.is_empty() {
        return Ok(vec![]);
    }

    let deleted_state = read_deleted_ui_state(&app)?;
    let recovery_bindings = read_recovery_bindings(&app)?
        .into_iter()
        .map(|binding| (binding.session_id.clone(), binding))
        .collect::<HashMap<_, _>>();
    let codex_history = load_codex_history_index();
    let existing = existing_session_ids.into_iter().collect::<HashSet<_>>();
    let mut recovered = Vec::new();

    for workspace in workspaces {
        let normalized_workspace_path = normalize_path(Some(workspace.workspace_path)).unwrap_or_default();
        let repo_root = PathBuf::from(&normalized_workspace_path);
        let Some(parent) = repo_root.parent() else {
            continue;
        };

        let worktree_root = parent.join(session_worktree_root_dir());
        if !worktree_root.exists() {
            continue;
        }

        let base_branch = default_base_branch(&repo_root);

        for entry in fs::read_dir(&worktree_root)
            .map_err(|e| format!("读取 {} 失败: {e}", worktree_root.display()))?
            .flatten()
        {
            let worktree_path = entry.path();
            if !worktree_path.is_dir() {
                continue;
            }

            let Some(dir_name) = worktree_path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(session_id) = numeric_session_id(dir_name) else {
                continue;
            };
            if existing.contains(&session_id) || deleted_state.session_ids.contains(&session_id) {
                continue;
            }
            if deleted_state
                .sessions
                .iter()
                .any(|entry| entry.matches(&session_id, Some(&workspace.workspace_id)))
            {
                continue;
            }
            if deleted_state.workspace_ids.contains(&workspace.workspace_id)
                || deleted_state
                    .workspaces
                    .iter()
                    .any(|entry| entry.matches(&workspace.workspace_id, Some(&normalized_workspace_path)))
            {
                continue;
            }

            let Some(hint) = resolve_recovery_hint(
                &session_id,
                &worktree_path,
                &recovery_bindings,
                &codex_history,
            ) else {
                continue;
            };

            let branch_name = current_branch(&worktree_path);
            let workdir = worktree_path.to_string_lossy().to_string();
            let current_task = hint.current_task.clone();

            recovered.push(RecoveredSession {
                id: session_id.clone(),
                name: normalize_task_title(&current_task, &session_id),
                workspace_id: workspace.workspace_id.clone(),
                workdir: workdir.clone(),
                status: "idle".to_string(),
                current_task,
                created_at: modified_millis(&worktree_path),
                diff_files: vec![],
                output: vec![],
                runner: RecoveredRunnerConfig {
                    r#type: hint.runner_type,
                    cli_path: String::new(),
                    cli_args: String::new(),
                    api_base_url: String::new(),
                    api_key_override: String::new(),
                },
                branch_name,
                base_branch: base_branch.clone(),
                worktree_path: Some(workdir),
                provider_session_id: Some(hint.provider_session_id),
            });
        }
    }

    recovered.sort_by_key(|session| session.id.parse::<u64>().unwrap_or(u64::MAX));
    Ok(recovered)
}
