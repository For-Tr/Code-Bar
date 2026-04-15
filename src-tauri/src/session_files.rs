use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use crate::util::expand_path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileReadResult {
    path: String,
    content: String,
    version_token: Option<String>,
    is_binary: bool,
    missing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileWriteResult {
    path: String,
    version_token: Option<String>,
}

fn session_root(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let sanitized = session_id.trim();
    if sanitized.is_empty() {
        return Err("缺少 session id".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析 app data 目录: {e}"))?
        .join("ui-state")
        .join(format!("session-workdir-{sanitized}.txt"));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 session workdir 失败 {}: {e}", path.display()))?;
    let root = PathBuf::from(expand_path(content.trim()));
    if !root.exists() {
        return Err(format!("session workdir 不存在: {}", root.display()));
    }
    root.canonicalize()
        .map_err(|e| format!("解析 session workdir 失败 {}: {e}", root.display()))
}

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("缺少相对路径".into());
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err("只允许相对路径".into());
    }
    if path.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("路径不能跳出 session 根目录".into());
    }
    Ok(path)
}

fn resolve_session_file(app: &tauri::AppHandle, session_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = session_root(app, session_id)?;
    let relative = validate_relative_path(relative_path)?;
    let joined = root.join(relative);

    let canonical_parent = joined
        .parent()
        .unwrap_or(root.as_path())
        .canonicalize()
        .map_err(|e| format!("解析父目录失败 {}: {e}", joined.display()))?;
    if !canonical_parent.starts_with(&root) {
        return Err("文件路径超出 session 根目录".into());
    }

    Ok(joined)
}

fn file_version_token(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            Ok(Some(format!("{}:{}", metadata.len(), modified)))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取文件状态失败 {}: {e}", path.display())),
    }
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(2048).any(|byte| *byte == 0)
}

#[tauri::command]
pub fn remember_session_workdir(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
) -> Result<(), String> {
    let sanitized = session_id.trim();
    if sanitized.is_empty() {
        return Err("缺少 session id".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析 app data 目录: {e}"))?
        .join("ui-state")
        .join(format!("session-workdir-{sanitized}.txt"));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    fs::write(&path, expand_path(workdir.trim()))
        .map_err(|e| format!("写入 session workdir 失败 {}: {e}", path.display()))
}

#[tauri::command]
pub fn remove_session_workdir(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let sanitized = session_id.trim();
    if sanitized.is_empty() {
        return Ok(());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析 app data 目录: {e}"))?
        .join("ui-state")
        .join(format!("session-workdir-{sanitized}.txt"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 session workdir 失败 {}: {e}", path.display())),
    }
}

#[tauri::command]
pub fn read_session_file(
    app: tauri::AppHandle,
    session_id: String,
    relative_path: String,
) -> Result<SessionFileReadResult, String> {
    let full_path = resolve_session_file(&app, &session_id, &relative_path)?;
    match fs::read(&full_path) {
        Ok(bytes) => {
            let binary = is_binary(&bytes);
            let content = if binary {
                String::new()
            } else {
                String::from_utf8(bytes)
                    .map_err(|e| format!("文件不是有效 UTF-8 {}: {e}", full_path.display()))?
            };
            Ok(SessionFileReadResult {
                path: relative_path,
                content,
                version_token: file_version_token(&full_path)?,
                is_binary: binary,
                missing: false,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SessionFileReadResult {
            path: relative_path,
            content: String::new(),
            version_token: None,
            is_binary: false,
            missing: true,
        }),
        Err(e) => Err(format!("读取文件失败 {}: {e}", full_path.display())),
    }
}

#[tauri::command]
pub fn write_session_file(
    app: tauri::AppHandle,
    session_id: String,
    relative_path: String,
    content: String,
    expected_version_token: Option<String>,
) -> Result<SessionFileWriteResult, String> {
    let full_path = resolve_session_file(&app, &session_id, &relative_path)?;
    let current_token = file_version_token(&full_path)?;
    if current_token != expected_version_token {
        return Err("文件已被外部修改，请先重新打开。".into());
    }
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }

    let tmp_path = full_path.with_extension("codebar.tmp");
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| format!("创建临时文件失败 {}: {e}", tmp_path.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("写入临时文件失败 {}: {e}", tmp_path.display()))?;
        file.sync_all()
            .map_err(|e| format!("刷新临时文件失败 {}: {e}", tmp_path.display()))?;
    }
    fs::rename(&tmp_path, &full_path)
        .map_err(|e| format!("替换文件失败 {}: {e}", full_path.display()))?;

    Ok(SessionFileWriteResult {
        path: relative_path,
        version_token: file_version_token(&full_path)?,
    })
}
