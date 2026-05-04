use serde::Serialize;

use crate::util::{background_command, expand_path};

fn git_run(workdir: &str, args: &[&str]) -> Result<String, String> {
    let out = background_command("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn ref_exists(workdir: &str, reference: &str) -> bool {
    background_command("git")
        .current_dir(workdir)
        .args(["rev-parse", "--verify", "--quiet", reference])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_base_branch(workdir: &str, requested: Option<&str>) -> Option<String> {
    if let Some(branch) = requested.filter(|value| !value.trim().is_empty()) {
        if ref_exists(workdir, branch) {
            return Some(branch.to_string());
        }
    }

    for candidate in ["main", "master"] {
        if ref_exists(workdir, candidate) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn rev_list_counts(workdir: &str, base_branch: &str) -> Result<(u32, u32), String> {
    let range = format!("{base_branch}...HEAD");
    let output = git_run(workdir, &["rev-list", "--left-right", "--count", &range])?;
    let parts = output.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(format!("unexpected rev-list output: {output}"));
    }

    let behind_count = parts[0].parse::<u32>().map_err(|e| e.to_string())?;
    let ahead_count = parts[1].parse::<u32>().map_err(|e| e.to_string())?;
    Ok((ahead_count, behind_count))
}

fn read_porcelain_status(workdir: &str) -> Result<String, String> {
    git_run(workdir, &["status", "--porcelain=v1"])
}

fn is_conflicted_status(x: char, y: char) -> bool {
    matches!((x, y), ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U'))
        || x == 'U'
        || y == 'U'
}

fn analyze_porcelain_status(output: &str) -> (bool, bool) {
    let mut dirty = false;
    let mut conflicted = false;

    for line in output.lines() {
        if line.len() < 2 {
            continue;
        }
        dirty = true;
        let chars = line.chars().collect::<Vec<_>>();
        if is_conflicted_status(chars[0], chars[1]) {
            conflicted = true;
        }
    }

    (dirty, conflicted)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchHealth {
    current_branch: Option<String>,
    base_branch: Option<String>,
    ahead_count: u32,
    behind_count: u32,
    dirty: bool,
    conflicted: bool,
}

fn git_branch_health_sync(
    workdir: &str,
    requested_base_branch: Option<&str>,
) -> Result<GitBranchHealth, String> {
    let current_branch = git_run(workdir, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let base_branch = resolve_base_branch(workdir, requested_base_branch);
    let (ahead_count, behind_count) = if let Some(base_branch) = base_branch.as_deref() {
        rev_list_counts(workdir, base_branch)?
    } else {
        (0, 0)
    };
    let status = read_porcelain_status(workdir)?;
    let (dirty, conflicted) = analyze_porcelain_status(&status);

    Ok(GitBranchHealth {
        current_branch,
        base_branch,
        ahead_count,
        behind_count,
        dirty,
        conflicted,
    })
}

#[tauri::command]
pub async fn git_current_branch(workdir: String) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["rev-parse", "--abbrev-ref", "HEAD"]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_create(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["checkout", "-b", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_switch(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["checkout", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_delete(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["branch", "-D", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_merge(
    workdir: String,
    target_branch: String,
    session_branch: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        git_run(&expanded, &["checkout", &target_branch])
            .map_err(|e| format!("切换到 {target_branch} 失败: {e}"))?;
        git_run(&expanded, &["merge", "--no-ff", &session_branch])
            .map_err(|e| format!("merge 失败: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_repo_info(workdir: String) -> Result<Option<String>, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = background_command("git")
            .current_dir(&expanded)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_health(
    workdir: String,
    base_branch: Option<String>,
) -> Result<GitBranchHealth, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_branch_health_sync(&expanded, base_branch.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::git_branch_health_sync;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("code-bar-branch-health-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.email", "codebar@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.name", "CodeBar"])
            .output()
            .unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["add", "README.md"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        root
    }

    #[test]
    fn git_branch_health_reports_ahead_counts_against_main() {
        let repo = temp_repo("ahead");
        Command::new("git")
            .current_dir(&repo)
            .args(["checkout", "-b", "feature/workflow"])
            .output()
            .unwrap();
        fs::write(repo.join("workflow.txt"), "next\n").unwrap();
        Command::new("git")
            .current_dir(&repo)
            .args(["add", "workflow.txt"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&repo)
            .args(["commit", "-m", "feature"])
            .output()
            .unwrap();

        let health = git_branch_health_sync(repo.to_string_lossy().as_ref(), Some("main")).unwrap();
        assert_eq!(health.current_branch.as_deref(), Some("feature/workflow"));
        assert_eq!(health.base_branch.as_deref(), Some("main"));
        assert_eq!(health.ahead_count, 1);
        assert_eq!(health.behind_count, 0);
        assert!(!health.dirty);
        assert!(!health.conflicted);
    }

    #[test]
    fn git_branch_health_marks_dirty_worktrees() {
        let repo = temp_repo("dirty");
        fs::write(repo.join("README.md"), "hello\ndirty\n").unwrap();

        let health = git_branch_health_sync(repo.to_string_lossy().as_ref(), Some("main")).unwrap();
        assert_eq!(health.base_branch.as_deref(), Some("main"));
        assert!(health.dirty);
    }
}
