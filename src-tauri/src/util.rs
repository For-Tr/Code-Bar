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

pub fn trim_trailing_path_separators(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).to_string()
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
        return custom_path.to_string();
    }
    let bin_name = match runner_type {
        "claude-code" => "claude",
        "codex" => "codex",
        _ => return custom_path.to_string(),
    };
    let candidates = [
        format!("/usr/local/bin/{bin_name}"),
        format!("/opt/homebrew/bin/{bin_name}"),
        format!("/usr/bin/{bin_name}"),
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.clone();
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg(bin_name).output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return p;
        }
    }
    bin_name.to_string()
}
