use std::process::Command;

use crate::util::expand_path;

// ── 辅助：运行 git 命令并检查退出状态 ────────────────────────────

fn git_run(workdir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 获取当前所在分支名
#[tauri::command]
pub async fn git_current_branch(workdir: String) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["rev-parse", "--abbrev-ref", "HEAD"]))
        .await
        .map_err(|e| e.to_string())?
}

/// 创建并切换到新分支（基于当前 HEAD）
#[tauri::command]
pub async fn git_branch_create(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        git_run(&expanded, &["checkout", "-b", &branch]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 切换到指定分支
#[tauri::command]
pub async fn git_branch_switch(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["checkout", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// 强制删除指定分支（-D）
#[tauri::command]
pub async fn git_branch_delete(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["branch", "-D", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// 将 session 分支 merge 回目标分支（--no-ff 保留分支历史）
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

/// 检查目录是否为 git 仓库，返回当前分支名（不是则返回 None）
#[tauri::command]
pub async fn git_repo_info(workdir: String) -> Result<Option<String>, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = Command::new("git")
            .current_dir(&expanded)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(Some(
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            ))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
