use std::{fs, io::Write, path::PathBuf};

use crate::util::{background_command, expand_path};

/// 读取文件（相对于 workdir）
#[tauri::command]
pub async fn harness_read_file(workdir: String, path: String) -> Result<String, String> {
    let full = PathBuf::from(expand_path(&workdir)).join(&path);
    fs::read_to_string(&full).map_err(|e| format!("读取 {path} 失败: {e}"))
}

/// 写入文件（相对于 workdir，自动创建父目录）
#[tauri::command]
pub async fn harness_write_file(
    workdir: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let full = PathBuf::from(expand_path(&workdir)).join(&path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let mut file = fs::File::create(&full).map_err(|e| format!("创建文件失败: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))
}

/// 列出目录内容（目录以 `/` 结尾）
#[tauri::command]
pub async fn harness_list_dir(workdir: String, path: String) -> Result<Vec<String>, String> {
    let target = if path.is_empty() { "." } else { &path };
    let full = PathBuf::from(expand_path(&workdir)).join(target);
    let entries = fs::read_dir(&full).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut result: Vec<String> = entries
        .flatten()
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_dir() {
                format!("{name}/")
            } else {
                name
            }
        })
        .collect();
    result.sort();
    Ok(result)
}

/// 执行 Shell 命令，返回 stdout / stderr / exit_code
#[tauri::command]
pub async fn harness_run_command(
    workdir: String,
    command: String,
) -> Result<serde_json::Value, String> {
    let expanded = expand_path(&workdir);
    let output = background_command("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("执行失败: {e}"))?;

    Ok(serde_json::json!({
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        "exit_code": output.status.code().unwrap_or(-1),
    }))
}

/// 获取 git diff 原始文本（staged 为 true 则读取暂存区）
#[tauri::command]
pub async fn harness_git_diff(workdir: String, staged: bool) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    let args = if staged {
        vec!["diff", "--cached"]
    } else {
        vec!["diff"]
    };
    let output = background_command("git")
        .args(&args)
        .current_dir(&expanded)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 弹出 macOS 原生确认对话框，返回用户是否确认
#[tauri::command]
pub async fn harness_confirm(title: String, message: String) -> Result<bool, String> {
    let script = format!(
        r#"display dialog "{message}" with title "{title}" buttons {{"取消", "确认"}} default button "确认""#
    );
    let output = background_command("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}
