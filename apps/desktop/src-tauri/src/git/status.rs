use serde::Serialize;
use tauri::Emitter;

use crate::util::{background_command, expand_path};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatusEntry {
    path: String,
    kind: String,
    staged: bool,
    unstaged: bool,
    conflicted: bool,
    old_path: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatusGroups {
    conflicts: Vec<ScmStatusEntry>,
    staged: Vec<ScmStatusEntry>,
    unstaged: Vec<ScmStatusEntry>,
    untracked: Vec<ScmStatusEntry>,
}

fn is_conflicted(x: char, y: char) -> bool {
    matches!((x, y),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    ) || x == 'U' || y == 'U'
}

fn kind_from_status(x: char, y: char) -> &'static str {
    if is_conflicted(x, y) {
        return "conflicted";
    }
    if x == '?' && y == '?' {
        return "untracked";
    }
    if x == 'R' || y == 'R' {
        return "renamed";
    }
    if x == 'A' || y == 'A' {
        return "added";
    }
    if x == 'D' || y == 'D' {
        return "deleted";
    }
    "modified"
}

fn split_paths(raw: &str) -> (Option<String>, String) {
    if let Some((old_path, new_path)) = raw.split_once(" -> ") {
        return (Some(old_path.to_string()), new_path.to_string());
    }
    (None, raw.to_string())
}

pub fn get_git_status_raw(workdir: &str) -> Result<ScmStatusGroups, String> {
    let output = background_command("git")
        .current_dir(workdir)
        .args(["status", "--porcelain=v1"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut groups = ScmStatusGroups::default();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let chars = line.chars().collect::<Vec<_>>();
        let x = chars[0];
        let y = chars[1];
        let raw_path = line[3..].trim();
        if raw_path.is_empty() {
            continue;
        }

        let (old_path, path) = split_paths(raw_path);
        let conflicted = is_conflicted(x, y);
        let untracked = x == '?' && y == '?';
        let staged = !conflicted && !untracked && x != ' ';
        let unstaged = !conflicted && !untracked && y != ' ';
        let entry = ScmStatusEntry {
            path,
            kind: kind_from_status(x, y).to_string(),
            staged,
            unstaged,
            conflicted,
            old_path,
        };

        if conflicted {
            groups.conflicts.push(entry);
            continue;
        }
        if untracked {
            groups.untracked.push(entry);
            continue;
        }
        if staged {
            groups.staged.push(entry.clone());
        }
        if unstaged {
            groups.unstaged.push(entry);
        }
    }

    Ok(groups)
}

#[tauri::command]
pub async fn get_git_status(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    let groups = get_git_status_raw(&expanded)?;
    let _ = app.emit(
        "scm-status-update",
        serde_json::json!({"session_id": session_id, "groups": groups}),
    );
    Ok(())
}
