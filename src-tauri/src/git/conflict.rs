use std::{
    fs,
    path::{Component, PathBuf},
};

use serde::Serialize;

use crate::util::{background_command, expand_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileVersion {
    label: String,
    content: String,
    is_binary: bool,
    missing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFilePayload {
    path: String,
    versions: Vec<ConflictFileVersion>,
}

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

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(2048).any(|byte| *byte == 0)
}

fn read_stage_file(
    workdir: &str,
    stage: &str,
    path: &str,
    label: &str,
) -> Result<ConflictFileVersion, String> {
    let output = background_command("git")
        .current_dir(workdir)
        .args(["show", &format!(":{stage}:{path}")])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let missing = stderr.contains("exists on disk")
            || stderr.contains("Path '")
            || stderr.contains("does not exist");
        return Ok(ConflictFileVersion {
            label: label.into(),
            content: String::new(),
            is_binary: false,
            missing,
        });
    }

    let bytes = output.stdout;
    let is_binary = is_binary(&bytes);
    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8(bytes).map_err(|e| e.to_string())?
    };

    Ok(ConflictFileVersion {
        label: label.into(),
        content,
        is_binary,
        missing: false,
    })
}

fn read_working_file(workdir: &str, path: &str) -> Result<ConflictFileVersion, String> {
    let full_path = PathBuf::from(workdir).join(path);
    match fs::read(&full_path) {
        Ok(bytes) => {
            let binary = is_binary(&bytes);
            let content = if binary {
                String::new()
            } else {
                String::from_utf8(bytes).map_err(|e| e.to_string())?
            };
            Ok(ConflictFileVersion {
                label: "working".into(),
                content,
                is_binary: binary,
                missing: false,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConflictFileVersion {
            label: "working".into(),
            content: String::new(),
            is_binary: false,
            missing: true,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn git_read_conflict_file(
    workdir: String,
    path: String,
) -> Result<ConflictFilePayload, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        let versions = vec![
            read_stage_file(&expanded, "1", &path, "base")?,
            read_stage_file(&expanded, "2", &path, "ours")?,
            read_stage_file(&expanded, "3", &path, "theirs")?,
            read_working_file(&expanded, &path)?,
        ];
        Ok(ConflictFilePayload { path, versions })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_resolve_conflict(
    workdir: String,
    path: String,
    strategy: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let path = validate_relative_git_path(&path)?;
        let flag = match strategy.as_str() {
            "ours" => "--ours",
            "theirs" => "--theirs",
            _ => return Err(format!("不支持的冲突解决策略: {strategy}")),
        };

        let checkout = background_command("git")
            .current_dir(&expanded)
            .args(["checkout", flag, "--", &path])
            .output()
            .map_err(|e| e.to_string())?;
        if !checkout.status.success() {
            return Err(String::from_utf8_lossy(&checkout.stderr).trim().to_string());
        }

        let add = background_command("git")
            .current_dir(&expanded)
            .args(["add", "--", &path])
            .output()
            .map_err(|e| e.to_string())?;
        if !add.status.success() {
            return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
