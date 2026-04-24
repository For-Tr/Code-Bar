use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn configure_background_command(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    configure_background_command(&mut command);
    command
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if paths.iter().any(|existing| existing == &candidate) {
        return;
    }
    paths.push(candidate);
}

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

pub fn codebar_runtime_dir() -> PathBuf {
    let base = home_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(".codebar").join("run");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn codebar_tmp_dir() -> PathBuf {
    let base = home_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(".codebar").join("tmp");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(unix)]
pub fn hook_socket_path(file_name: &str) -> String {
    let scoped_name = if cfg!(debug_assertions) {
        if let Some(stripped) = file_name.strip_suffix(".sock") {
            format!("{stripped}-dev.sock")
        } else {
            format!("{file_name}-dev")
        }
    } else {
        file_name.to_string()
    };

    codebar_runtime_dir()
        .join(scoped_name)
        .to_string_lossy()
        .to_string()
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

pub fn resolve_windows_pty_command(command: &str, args: &[String]) -> (String, Vec<String>) {
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
                let node = sibling_node.unwrap_or_else(|| {
                    PathBuf::from(crate::cli_detect::resolve_command_path("node"))
                });
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

pub fn resolve_path_from_workdir(workdir: &str, path: &str) -> PathBuf {
    let expanded_path = PathBuf::from(expand_path(path));
    if expanded_path.is_absolute() {
        return expanded_path;
    }
    PathBuf::from(expand_path(workdir)).join(expanded_path)
}

pub fn normalize_expanded_path(path: &str) -> String {
    expand_path(path).trim_end_matches('/').to_string()
}

fn provider_storage_spec(
    runner_type: &str,
) -> Option<(&'static str, &'static str, &'static [&'static str])> {
    match runner_type {
        "claude-code" => Some((".claude", "claude", &["CLAUDE_HOME", "CLAUDE_CONFIG_DIR"])),
        "codex" => Some((".codex", "codex", &["CODEX_HOME"])),
        _ => None,
    }
}

fn provider_runtime_candidates(cli_path: &str, hidden_dir_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if cli_path.trim().is_empty() {
        return candidates;
    }

    let mut sources = vec![PathBuf::from(cli_path)];
    if let Ok(canonical) = std::fs::canonicalize(cli_path) {
        push_unique_path(&mut sources, canonical);
    }

    for source in sources {
        let start = if source.is_dir() {
            source
        } else {
            source
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(cli_path))
        };

        let mut current: Option<&Path> = Some(start.as_path());
        for _ in 0..6 {
            let Some(dir) = current else {
                break;
            };
            push_unique_path(&mut candidates, dir.join(hidden_dir_name));
            current = dir.parent();
        }
    }

    candidates
}

pub fn resolve_provider_dir(runner_type: &str, cli_path_override: &str) -> Option<PathBuf> {
    let (hidden_dir_name, xdg_dir_name, env_vars) = provider_storage_spec(runner_type)?;
    let mut candidates = Vec::new();
    let mut env_candidates = Vec::new();

    for env_var in env_vars {
        let Ok(value) = std::env::var(env_var) else {
            continue;
        };
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(expand_path(trimmed));
        push_unique_path(&mut env_candidates, path.clone());
        push_unique_path(&mut candidates, path);
    }

    let resolved_cli = if !cli_path_override.trim().is_empty() {
        crate::cli_detect::resolve_command_path(cli_path_override)
    } else {
        find_cli_path(runner_type, "")
    };
    for candidate in provider_runtime_candidates(&resolved_cli, hidden_dir_name) {
        push_unique_path(&mut candidates, candidate);
    }

    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let trimmed = xdg_config_home.trim();
        if !trimmed.is_empty() {
            push_unique_path(
                &mut candidates,
                PathBuf::from(expand_path(trimmed)).join(xdg_dir_name),
            );
        }
    }

    if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
        let trimmed = xdg_data_home.trim();
        if !trimmed.is_empty() {
            push_unique_path(
                &mut candidates,
                PathBuf::from(expand_path(trimmed)).join(xdg_dir_name),
            );
        }
    }

    let home_candidate = home_dir().map(|home| home.join(hidden_dir_name));
    if let Some(home) = home_dir() {
        push_unique_path(&mut candidates, home.join(".config").join(xdg_dir_name));
        push_unique_path(&mut candidates, home.join(".local/share").join(xdg_dir_name));
    }
    if let Some(path) = &home_candidate {
        push_unique_path(&mut candidates, path.clone());
    }

    if let Some(existing) = candidates.iter().find(|candidate| candidate.exists()) {
        return Some(existing.clone());
    }

    env_candidates
        .into_iter()
        .next()
        .or(home_candidate)
        .or_else(|| candidates.into_iter().next())
}

pub fn resolve_provider_file_path(
    runner_type: &str,
    cli_path_override: &str,
    relative_path: &str,
) -> Option<PathBuf> {
    resolve_provider_dir(runner_type, cli_path_override).map(|dir| dir.join(relative_path))
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
