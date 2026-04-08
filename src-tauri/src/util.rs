use std::path::PathBuf;

pub fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Some(PathBuf::from(home));
        }
    }

    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.trim().is_empty() {
                return Some(PathBuf::from(profile));
            }
        }

        let drive = std::env::var("HOMEDRIVE").ok();
        let path = std::env::var("HOMEPATH").ok();
        if let (Some(drive), Some(path)) = (drive, path) {
            let combined = format!("{drive}{path}");
            if !combined.trim().is_empty() {
                return Some(PathBuf::from(combined));
            }
        }
    }

    None
}

#[cfg(windows)]
fn extract_node_script_from_cmd_shim(command: &str) -> Option<PathBuf> {
    let shim_path = PathBuf::from(command);
    let shim_dir = shim_path.parent()?;
    let content = std::fs::read_to_string(&shim_path).ok()?;

    for line in content.lines() {
        let marker = "\"%dp0%\\";
        let Some(start) = line.find(marker) else {
            continue;
        };
        let rest = &line[start + marker.len()..];
        let Some(end) = rest.find('"') else {
            continue;
        };
        let rel = &rest[..end];
        if !(rel.ends_with(".js") || rel.ends_with(".cjs") || rel.ends_with(".mjs")) {
            continue;
        }
        return Some(shim_dir.join(rel.replace('\\', "/")));
    }

    None
}

pub fn resolve_windows_pty_command(
    command: &str,
    args: &[String],
) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        let path = PathBuf::from(command);
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());

        if matches!(ext.as_deref(), Some("cmd") | Some("bat")) {
            if let Some(script) = extract_node_script_from_cmd_shim(command) {
                let shim_dir = path.parent().map(PathBuf::from);
                let sibling_node = shim_dir
                    .as_ref()
                    .map(|dir| dir.join("node.exe"))
                    .filter(|node| node.exists());
                let node = sibling_node
                    .unwrap_or_else(|| PathBuf::from(crate::cli_detect::resolve_command_path("node")));
                if node.exists() && script.exists() {
                    let mut launch_args = Vec::with_capacity(args.len() + 1);
                    launch_args.push(script.to_string_lossy().to_string());
                    launch_args.extend(args.iter().cloned());
                    return (node.to_string_lossy().to_string(), launch_args);
                }
            }
        }

        (command.to_string(), args.to_vec())
    }

    #[cfg(not(windows))]
    {
        (command.to_string(), args.to_vec())
    }
}

/// 展开路径中的 `~` 前缀为用户 HOME 目录
pub fn expand_path(path: &str) -> String {
    if path == "~" {
        return home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
    }

    if path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = home_dir() {
            return home.join(&path[2..]).to_string_lossy().to_string();
        }
    }

    path.to_string()
}

/// 根据 runner_type 查找 CLI 可执行文件路径
pub fn find_cli_path(runner_type: &str, custom_path: &str) -> String {
    if !custom_path.is_empty() {
        return crate::cli_detect::resolve_command_path(custom_path);
    }
    let bin_name = match runner_type {
        "claude-code" => "claude",
        "codex" => "codex",
        _ => return custom_path.to_string(),
    };
    crate::cli_detect::resolve_command_path(bin_name)
}
