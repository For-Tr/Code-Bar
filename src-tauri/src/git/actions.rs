use std::{
    io::Write,
    path::{Component, PathBuf},
    process::Stdio,
};

use crate::util::{background_command, expand_path};

fn validate_relative_git_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("缺少文件路径".into());
    }
    let parsed = PathBuf::from(trimmed);
    if parsed.is_absolute() {
        return Err("只允许相对路径".into());
    }
    if parsed.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("路径不能跳出仓库目录".into());
    }
    Ok(trimmed.to_string())
}

fn git_success(workdir: &str, args: &[&str]) -> Result<(), String> {
    let output = background_command("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        return Err(stderr);
    }
    Ok(())
}

fn git_text(workdir: &str, args: &[&str]) -> Result<String, String> {
    let output = background_command("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_with_input(workdir: &str, args: &[&str], input: &str) -> Result<(), String> {
    let mut child = background_command("git")
        .current_dir(workdir)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        return Err(stderr);
    }
    Ok(())
}

fn diff_text_for_mode(workdir: &str, path: &str, mode: &str) -> Result<String, String> {
    match mode {
        "staged" => git_text(workdir, &["diff", "--cached", "--", path]),
        "unstaged" => git_text(workdir, &["diff", "--", path]),
        _ => Err(format!("不支持的 hunk 模式: {mode}")),
    }
}

fn extract_hunk_patch(diff_text: &str, hunk_index: usize) -> Result<String, String> {
    let mut preamble = Vec::new();
    let mut hunks: Vec<Vec<String>> = Vec::new();
    let mut current: Option<Vec<String>> = None;

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            current = Some(vec![line.to_string()]);
            continue;
        }

        if let Some(ref mut hunk) = current {
            hunk.push(line.to_string());
        } else {
            preamble.push(line.to_string());
        }
    }

    if let Some(hunk) = current.take() {
        hunks.push(hunk);
    }

    let Some(selected_hunk) = hunks.get(hunk_index) else {
        return Err(format!("未找到第 {} 个 hunk", hunk_index + 1));
    };

    if selected_hunk.is_empty() {
        return Err("目标 hunk 为空".into());
    }

    let mut patch = preamble;
    patch.extend(selected_hunk.iter().cloned());
    Ok(format!("{}\n", patch.join("\n")))
}

#[tauri::command]
pub async fn git_stage_file(workdir: String, path: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        git_success(&expanded, &["add", "--", &path])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_file(workdir: String, path: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        git_success(&expanded, &["restore", "--staged", "--", &path])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard_file(workdir: String, path: String, mode: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        match mode.as_str() {
            "untracked" => git_success(&expanded, &["clean", "-fd", "--", &path]),
            "staged" => git_success(
                &expanded,
                &[
                    "restore",
                    "--staged",
                    "--worktree",
                    "--source=HEAD",
                    "--",
                    &path,
                ],
            ),
            _ => git_success(&expanded, &["restore", "--worktree", "--", &path]),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_staged(workdir: String, message: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err("提交信息不能为空".into());
        }
        git_success(&expanded, &["commit", "-m", trimmed])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_all(workdir: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_success(&expanded, &["add", "-A"]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_paths(workdir: String, paths: Vec<String>) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        if paths.is_empty() {
            return Ok(());
        }
        let validated = paths
            .iter()
            .map(|path| validate_relative_git_path(path))
            .collect::<Result<Vec<_>, _>>()?;
        let mut args = vec!["add", "--"];
        let refs = validated.iter().map(String::as_str).collect::<Vec<_>>();
        args.extend(refs);
        git_success(&expanded, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_all(workdir: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_success(&expanded, &["restore", "--staged", "."]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_hunk(
    workdir: String,
    path: String,
    hunk_index: usize,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        let diff_text = diff_text_for_mode(&expanded, &path, "unstaged")?;
        let patch = extract_hunk_patch(&diff_text, hunk_index)?;
        git_with_input(
            &expanded,
            &["apply", "--cached", "--whitespace=nowarn", "-"],
            &patch,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_hunk(
    workdir: String,
    path: String,
    hunk_index: usize,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        let diff_text = diff_text_for_mode(&expanded, &path, "staged")?;
        let patch = extract_hunk_patch(&diff_text, hunk_index)?;
        git_with_input(
            &expanded,
            &["apply", "--cached", "--reverse", "--whitespace=nowarn", "-"],
            &patch,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard_hunk(
    workdir: String,
    path: String,
    hunk_index: usize,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        let diff_text = diff_text_for_mode(&expanded, &path, "unstaged")?;
        let patch = extract_hunk_patch(&diff_text, hunk_index)?;
        git_with_input(
            &expanded,
            &["apply", "--reverse", "--whitespace=nowarn", "-"],
            &patch,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
