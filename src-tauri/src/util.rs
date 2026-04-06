/// 展开路径中的 `~` 前缀为用户 HOME 目录
pub fn expand_path(path: &str) -> String {
    if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        path.replacen('~', &home, 1)
    } else {
        path.to_string()
    }
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
