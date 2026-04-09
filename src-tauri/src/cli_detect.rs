use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
};

// ── 路径解析缓存 ──────────────────────────────────────────────────
/// 进程级缓存：命令名 → 完整路径（None 表示找不到，避免重复触发耗时 shell_which）
static CMD_PATH_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn cmd_path_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    CMD_PATH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 解析命令的完整路径，兼容各种版本管理器（nvm/mise/fnm/volta/asdf/pyenv 等）。
///
/// 策略（按优先级）：
///   0. 命中缓存 → 立即返回（O(1)）
///   1. 已是完整路径 → 直接返回
///   2. 扫进程 PATH（最快，适用于系统工具和 Homebrew）
///   3. 让 shell source 配置文件后执行 which（覆盖 nvm/mise 等，3s 超时）
///   4. 静态扫描常见版本管理器目录（shell 失败时的无进程兜底）
pub fn resolve_command_path(command: &str) -> String {
    // 已是完整路径，跳过缓存直接返回
    if is_direct_command_path(command) {
        return command.to_string();
    }

    // 命中缓存
    {
        let cache = cmd_path_cache().lock().unwrap();
        if let Some(cached) = cache.get(command) {
            return cached.clone().unwrap_or_else(|| command.to_string());
        }
    }

    let result = scan_path_env(command)
        .or_else(|| {
            let p = shell_which(command)?;
            eprintln!("[resolve] shell-which: {command} -> {p}");
            Some(p)
        })
        .or_else(|| {
            let p = static_venv_scan(command)?;
            eprintln!("[resolve] static-scan: {command} -> {p}");
            Some(p)
        });

    // 写入缓存（包括 None，避免下次再走慢路径）
    {
        let mut cache = cmd_path_cache().lock().unwrap();
        cache.insert(command.to_string(), result.clone());
    }

    normalize_windows_command_path(result.unwrap_or_else(|| command.to_string()))
}

fn is_direct_command_path(command: &str) -> bool {
    #[cfg(windows)]
    {
        Path::new(command).is_absolute() || command.contains('\\') || command.contains('/')
    }

    #[cfg(not(windows))]
    {
        command.contains('/')
    }
}

fn normalize_windows_command_path(command: String) -> String {
    #[cfg(windows)]
    {
        let path = PathBuf::from(&command);
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            if ext.eq_ignore_ascii_case("ps1") {
                for sibling_ext in ["cmd", "bat", "exe", "com"] {
                    let sibling = path.with_extension(sibling_ext);
                    if sibling.exists() {
                        return sibling.to_string_lossy().to_string();
                    }
                }
            }
            return command;
        }

        for ext in ["cmd", "bat", "exe", "com"] {
            let candidate = PathBuf::from(format!("{command}.{ext}"));
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }

        command
    }

    #[cfg(not(windows))]
    {
        command
    }
}

#[cfg(windows)]
fn windows_candidates(command: &str) -> Vec<String> {
    if Path::new(command).extension().is_some() {
        return vec![command.to_string()];
    }

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut candidates = Vec::new();
    for ext in pathext.split(';').filter(|s| !s.is_empty()) {
        candidates.push(format!("{command}{ext}"));
        candidates.push(format!("{command}{}", ext.to_ascii_lowercase()));
    }
    candidates.push(command.to_string());
    candidates.dedup();
    candidates
}

/// 扫进程 PATH，找到可执行文件返回完整路径
fn scan_path_env(command: &str) -> Option<String> {
    let path_var = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(sep).filter(|s| !s.is_empty()) {
        #[cfg(windows)]
        let candidates = windows_candidates(command);
        #[cfg(not(windows))]
        let candidates = vec![command.to_string()];

        for candidate in candidates {
            let full = std::path::PathBuf::from(dir).join(&candidate);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&full) {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return Some(full.to_string_lossy().to_string());
                    }
                }
            }
            #[cfg(not(unix))]
            if full.exists() {
                return Some(full.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[cfg(windows)]
fn shell_which(command: &str) -> Option<String> {
    let script = format!(
        "(Get-Command {command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)"
    );
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let resolved = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if resolved.is_empty() || !Path::new(&resolved).exists() {
        None
    } else {
        Some(resolved)
    }
}

/// 通过用户 shell source 完整配置文件后执行 which（3s 超时）
#[cfg(not(windows))]
fn shell_which(command: &str) -> Option<String> {
    use std::time::Duration;

    let script = format!(
        r#"export TERM=dumb
[ -f "$HOME/.zshenv" ] && source "$HOME/.zshenv" 2>/dev/null
[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
which {command} 2>/dev/null | head -1"#
    );

    let candidates = {
        let mut v = vec![];
        if let Ok(s) = std::env::var("SHELL") {
            v.push(s);
        }
        v.push("/bin/zsh".to_string());
        v.push("/bin/bash".to_string());
        v
    };

    for shell in &candidates {
        if !std::path::Path::new(shell.as_str()).exists() {
            continue;
        }
        let mut child = match std::process::Command::new(shell)
            .args(["-c", &script])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => continue,
        };

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut timed_out = false;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        eprintln!("[resolve] shell-which timeout for {command} via {shell}");
                        timed_out = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }

        if !timed_out {
            if let Ok(out) = child.wait_with_output() {
                let line = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .find(|l| !l.trim().is_empty() && l.contains('/'))
                    .map(|l| l.trim().to_string());
                if let Some(p) = line {
                    if std::path::Path::new(&p).exists() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

/// 静态扫描常见版本管理器安装目录（nvm/fnm/volta/mise/asdf/pyenv/rbenv/cargo/go）
fn static_venv_scan(command: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let home = crate::util::home_dir()?;
        let dirs = [
            home.join("AppData\\Roaming\\npm"),
            home.join("scoop\\shims"),
            home.join(".cargo\\bin"),
        ];
        for dir in dirs {
            for candidate in windows_candidates(command) {
                let full = dir.join(&candidate);
                if full.exists() {
                    return Some(full.to_string_lossy().to_string());
                }
            }
        }
        return None;
    }

    #[cfg(not(windows))]
    {
        let home = std::path::PathBuf::from(std::env::var("HOME").ok()?);

        let mut dirs: Vec<std::path::PathBuf> = vec![
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
            "/opt/homebrew/sbin".into(),
        ];

        // nvm: ~/.nvm/versions/node/vX.Y.Z/bin/
        let nvm_root = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            versions.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
            for entry in &versions {
                dirs.push(entry.path().join("bin"));
            }
        }

        // fnm: ~/.local/share/fnm/node-versions/vX/installation/bin/
        let fnm_root = home.join(".local/share/fnm/node-versions");
        if let Ok(entries) = std::fs::read_dir(&fnm_root) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            versions.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
            for entry in &versions {
                dirs.push(entry.path().join("installation/bin"));
            }
        }

        dirs.extend([
            home.join(".volta/bin"),
            home.join(".local/share/mise/shims"),
            home.join(".asdf/shims"),
            home.join(".pyenv/shims"),
            home.join(".pyenv/bin"),
            home.join(".rbenv/shims"),
            home.join(".rbenv/bin"),
            home.join(".cargo/bin"),
            home.join("go/bin"),
        ]);

        for dir in &dirs {
            let full = dir.join(command);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&full) {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return Some(full.to_string_lossy().to_string());
                    }
                }
            }
            #[cfg(not(unix))]
            if full.exists() {
                return Some(full.to_string_lossy().to_string());
            }
        }

        None
    }
}

/// 在 PATH 和常见路径中查找指定命令
pub fn find_in_path(cmd: &str) -> Option<String> {
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            #[cfg(windows)]
            let candidates = windows_candidates(cmd);
            #[cfg(not(windows))]
            let candidates = vec![cmd.to_string()];

            for candidate in candidates {
                let full = std::path::PathBuf::from(dir).join(&candidate);
                if full.exists() {
                    return Some(full.to_string_lossy().to_string());
                }
            }
        }
    }
    for prefix in &["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"] {
        let full = std::path::PathBuf::from(prefix).join(cmd);
        if full.exists() {
            return Some(full.to_string_lossy().to_string());
        }
    }
    None
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 检测指定 CLI 是否可用（返回 true 表示找到了完整路径）
#[tauri::command]
pub async fn check_cli(command: String) -> bool {
    let resolved = resolve_command_path(&command);
    std::path::Path::new(&resolved).exists()
}

/// 调试用：返回进程环境信息，用于诊断打包后 PATH/SHELL 问题
#[tauri::command]
pub fn debug_env(command: String) -> serde_json::Value {
    let path = std::env::var("PATH").unwrap_or_else(|_| "<unset>".to_string());
    let shell = if cfg!(windows) {
        std::env::var("ComSpec").unwrap_or_else(|_| "<unset>".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "<unset>".to_string())
    };
    let home = crate::util::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "<unset>".to_string());
    let resolved = resolve_command_path(&command);

    #[cfg(windows)]
    let shell_which = match Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-Command {command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)"
            ),
        ])
        .output()
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(e) => format!("error: {e}"),
    };

    #[cfg(not(windows))]
    let shell_which = if shell != "<unset>" {
        match std::process::Command::new(&shell)
            .args([
                "-l",
                "-c",
                &format!("which {command} 2>/dev/null; echo SHELL_PATH=$PATH"),
            ])
            .output()
        {
            Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
            Err(e) => format!("error: {e}"),
        }
    } else {
        "SHELL not set".to_string()
    };

    serde_json::json!({
        "PATH": path,
        "SHELL": shell,
        "HOME": home,
        "resolved": resolved,
        "shell_which_output": shell_which,
    })
}

/// 自动检测系统中 Claude / OpenAI 相关配置
#[tauri::command]
pub fn detect_cli_config() -> serde_json::Value {
    let mut result = serde_json::json!({
        "anthropic_api_key":      "",
        "anthropic_base_url":     "",
        "openai_api_key":         "",
        "openai_base_url":        "",
        "claude_settings":        {},
        "claude_cli_path":        "",
        "codex_cli_path":         "",
        "claude_oauth_logged_in": false,
        "claude_oauth_email":     "",
    });

    // 1. 进程直接继承的环境变量
    macro_rules! read_env {
        ($key:expr, $field:expr) => {
            if let Ok(v) = std::env::var($key) {
                result[$field] = serde_json::Value::String(v);
            }
        };
    }
    read_env!("ANTHROPIC_API_KEY", "anthropic_api_key");
    read_env!("ANTHROPIC_BASE_URL", "anthropic_base_url");
    read_env!("OPENAI_API_KEY", "openai_api_key");
    read_env!("OPENAI_BASE_URL", "openai_base_url");

    // 2. 通过交互式 shell 读取 .zshrc 中的 export
    let shell_script = r#"
        source ~/.zshenv 2>/dev/null || true
        source ~/.zshrc 2>/dev/null || true
        source ~/.bashrc 2>/dev/null || true
        source ~/.bash_profile 2>/dev/null || true
        echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
        echo "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}"
        echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
        echo "OPENAI_BASE_URL=${OPENAI_BASE_URL}"
    "#;
    for shell in &["/bin/zsh", "/bin/bash"] {
        if !std::path::Path::new(shell).exists() {
            continue;
        }
        if let Ok(out) = std::process::Command::new(shell)
            .args(["-l", "-c", shell_script])
            .output()
        {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                macro_rules! try_set {
                    ($prefix:expr, $field:expr) => {
                        if let Some(val) = line.strip_prefix($prefix) {
                            let val = val.trim();
                            if !val.is_empty() && result[$field].as_str().unwrap_or("").is_empty() {
                                result[$field] = serde_json::Value::String(val.to_string());
                            }
                        }
                    };
                }
                try_set!("ANTHROPIC_API_KEY=", "anthropic_api_key");
                try_set!("ANTHROPIC_BASE_URL=", "anthropic_base_url");
                try_set!("OPENAI_API_KEY=", "openai_api_key");
                try_set!("OPENAI_BASE_URL=", "openai_base_url");
            }
            if out.status.success() {
                break;
            }
        }
    }

    // 3. ~/.claude/settings.json
    if let Some(home) = crate::util::home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                result["claude_settings"] = json.clone();
                if let Some(base_url) = json.get("apiBaseUrl").and_then(|v| v.as_str()) {
                    if !base_url.is_empty()
                        && result["anthropic_base_url"]
                            .as_str()
                            .unwrap_or("")
                            .is_empty()
                    {
                        result["anthropic_base_url"] =
                            serde_json::Value::String(base_url.to_string());
                    }
                }
                if let Some(key) = json.get("apiKey").and_then(|v| v.as_str()) {
                    if !key.is_empty()
                        && result["anthropic_api_key"]
                            .as_str()
                            .unwrap_or("")
                            .is_empty()
                    {
                        result["anthropic_api_key"] = serde_json::Value::String(key.to_string());
                    }
                }
            }
        }

        // 4. Claude Code OAuth 登录状态
        let claude_dir = home.join(".claude");
        if claude_dir.exists() {
            if let Some(bin) = find_in_path("claude") {
                if let Ok(out) = std::process::Command::new(&bin)
                    .args(["config", "get", "userEmail"])
                    .output()
                {
                    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    let not_logged = stderr.to_lowercase().contains("not logged")
                        || stdout.to_lowercase().contains("not logged");
                    if !not_logged && stdout.contains('@') {
                        result["claude_oauth_logged_in"] = serde_json::Value::Bool(true);
                        result["claude_oauth_email"] = serde_json::Value::String(stdout);
                    } else if !not_logged && !stdout.is_empty() && out.status.success() {
                        result["claude_oauth_logged_in"] = serde_json::Value::Bool(true);
                    }
                }
            }
        }
    }

    // 5. CLI 路径检测（通过 shell which）
    #[cfg(not(windows))]
    if let Ok(out) = std::process::Command::new("/bin/zsh")
        .args([
            "-l",
            "-c",
            r#"printf '%s\n%s' "$(which claude 2>/dev/null)" "$(which codex 2>/dev/null)""#,
        ])
        .output()
    {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if let Some(p) = lines.first() {
            let p = p.trim();
            if !p.is_empty() && std::path::Path::new(p).exists() {
                result["claude_cli_path"] = serde_json::Value::String(p.to_string());
            }
        }
        if let Some(p) = lines.get(1) {
            let p = p.trim();
            if !p.is_empty() && std::path::Path::new(p).exists() {
                result["codex_cli_path"] = serde_json::Value::String(p.to_string());
            }
        }
    }

    // PATH 回退检测
    if result["claude_cli_path"].as_str().unwrap_or("").is_empty() {
        if let Ok(path_var) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ';' } else { ':' };
            for dir in path_var.split(sep) {
                #[cfg(windows)]
                let claude_candidates = windows_candidates("claude");
                #[cfg(not(windows))]
                let claude_candidates = vec!["claude".to_string()];
                #[cfg(windows)]
                let codex_candidates = windows_candidates("codex");
                #[cfg(not(windows))]
                let codex_candidates = vec!["codex".to_string()];

                if result["claude_cli_path"].as_str().unwrap_or("").is_empty() {
                    for candidate in &claude_candidates {
                        let full = std::path::PathBuf::from(dir).join(candidate);
                        if full.exists() {
                            result["claude_cli_path"] =
                                serde_json::Value::String(full.to_string_lossy().to_string());
                            break;
                        }
                    }
                }

                if result["codex_cli_path"].as_str().unwrap_or("").is_empty() {
                    for candidate in &codex_candidates {
                        let full = std::path::PathBuf::from(dir).join(candidate);
                        if full.exists() {
                            result["codex_cli_path"] =
                                serde_json::Value::String(full.to_string_lossy().to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    result
}
