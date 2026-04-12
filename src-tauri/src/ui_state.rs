use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::util::{background_command, expand_path, home_dir};

const UI_STATE_DIR: &str = "ui-state";
const DELETED_UI_STATE_KEY: &str = "code-bar-deleted-items";

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
struct ClaudeSessionHint {
    provider_session_id: String,
    current_task: String,
    modified_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedUiState {
    session_ids: Vec<String>,
    workspace_ids: Vec<String>,
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
        .map(|dir| dir.join(UI_STATE_DIR).join(format!("{sanitized}.json")))
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
        .map_err(|e| format!("解析已删除 UI 状态失败: {e}"))
}

fn write_deleted_ui_state(app: &tauri::AppHandle, state: &DeletedUiState) -> Result<(), String> {
    let payload =
        serde_json::to_string(state).map_err(|e| format!("序列化已删除 UI 状态失败: {e}"))?;
    write_ui_state(app, DELETED_UI_STATE_KEY, &payload)
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

fn latest_claude_hint(session_id: &str) -> Option<ClaudeSessionHint> {
    let projects_dir = home_dir()?.join(".claude").join("projects");
    let suffix = format!("session-{session_id}");
    let mut best: Option<ClaudeSessionHint> = None;

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

                let is_user = json.get("type").and_then(|v| v.as_str()) == Some("user");
                let role = json
                    .get("message")
                    .and_then(|message| message.get("role"))
                    .and_then(|value| value.as_str());
                if !is_user || role != Some("user") {
                    continue;
                }

                let Some(content) = json
                    .get("message")
                    .and_then(|message| message.get("content"))
                else {
                    continue;
                };

                if let Some(text) = content.as_str() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && first_task.is_empty() {
                        first_task = trimmed.to_string();
                    }
                }
            }

            if first_task.is_empty() {
                continue;
            }

            let modified_at_ms = modified_millis(&file_path);
            let candidate = ClaudeSessionHint {
                provider_session_id,
                current_task: first_task,
                modified_at_ms,
            };

            if best
                .as_ref()
                .map(|current| current.modified_at_ms < candidate.modified_at_ms)
                .unwrap_or(true)
            {
                best = Some(candidate);
            }
        }
    }

    best
}

fn numeric_session_id(name: &str) -> Option<String> {
    let trimmed = name.strip_prefix("session-")?;
    if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        Some(trimmed.to_string())
    } else {
        None
    }
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

#[tauri::command]
pub fn load_deleted_ui_state(app: tauri::AppHandle) -> Result<DeletedUiState, String> {
    read_deleted_ui_state(&app)
}

#[tauri::command]
pub fn mark_deleted_items(
    app: tauri::AppHandle,
    session_ids: Vec<String>,
    workspace_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = read_deleted_ui_state(&app)?;
    let mut next_session_ids = state.session_ids.into_iter().collect::<HashSet<_>>();
    let mut next_workspace_ids = state.workspace_ids.into_iter().collect::<HashSet<_>>();

    session_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .for_each(|id| {
            next_session_ids.insert(id);
        });
    workspace_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .for_each(|id| {
            next_workspace_ids.insert(id);
        });

    state.session_ids = next_session_ids.into_iter().collect();
    state.workspace_ids = next_workspace_ids.into_iter().collect();
    state.session_ids.sort_by_key(|id| id.parse::<u64>().unwrap_or(u64::MAX));
    state.workspace_ids.sort();

    write_deleted_ui_state(&app, &state)
}

#[tauri::command]
pub fn clear_deleted_items(
    app: tauri::AppHandle,
    session_ids: Vec<String>,
    workspace_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = read_deleted_ui_state(&app)?;
    let removed_session_ids = session_ids.into_iter().collect::<HashSet<_>>();
    let removed_workspace_ids = workspace_ids.into_iter().collect::<HashSet<_>>();

    state.session_ids.retain(|id| !removed_session_ids.contains(id));
    state.workspace_ids.retain(|id| !removed_workspace_ids.contains(id));

    if state.session_ids.is_empty() && state.workspace_ids.is_empty() {
        remove_ui_state_file(&app, DELETED_UI_STATE_KEY)
    } else {
        write_deleted_ui_state(&app, &state)
    }
}

#[tauri::command]
pub fn recover_workspace_sessions(
    app: tauri::AppHandle,
    workspace_id: String,
    workspace_path: String,
    existing_session_ids: Vec<String>,
) -> Result<Vec<RecoveredSession>, String> {
    let repo_root = PathBuf::from(expand_path(&workspace_path));
    let Some(parent) = repo_root.parent() else {
        return Ok(vec![]);
    };

    let worktree_root = parent.join(".code-bar-worktrees");
    if !worktree_root.exists() {
        return Ok(vec![]);
    }

    let existing = existing_session_ids.into_iter().collect::<HashSet<_>>();
    let deleted = read_deleted_ui_state(&app)?
        .session_ids
        .into_iter()
        .collect::<HashSet<_>>();
    let base_branch = default_base_branch(&repo_root);
    let mut recovered = Vec::new();

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
        if existing.contains(&session_id) || deleted.contains(&session_id) {
            continue;
        }

        let Some(claude_hint) = latest_claude_hint(&session_id) else {
            continue;
        };

        let branch_name =
            current_branch(&worktree_path).or_else(|| Some(format!("ci/session-{session_id}")));
        let workdir = worktree_path.to_string_lossy().to_string();
        let current_task = claude_hint.current_task.clone();

        recovered.push(RecoveredSession {
            id: session_id.clone(),
            name: normalize_task_title(&current_task, &session_id),
            workspace_id: workspace_id.clone(),
            workdir: workdir.clone(),
            status: "idle".to_string(),
            current_task,
            created_at: modified_millis(&worktree_path),
            diff_files: vec![],
            output: vec![],
            runner: RecoveredRunnerConfig {
                r#type: "claude-code".to_string(),
                cli_path: String::new(),
                cli_args: String::new(),
                api_base_url: String::new(),
                api_key_override: String::new(),
            },
            branch_name,
            base_branch: base_branch.clone(),
            worktree_path: Some(workdir),
            provider_session_id: Some(claude_hint.provider_session_id),
        });
    }

    recovered.sort_by_key(|session| session.id.parse::<u64>().unwrap_or(u64::MAX));
    Ok(recovered)
}
