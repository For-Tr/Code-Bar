use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::Duration,
};

use notify::{
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use tauri::Emitter;

use crate::{
    state::GitWatcherMap,
    util::{background_command, expand_path},
};

const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

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
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn canonical_or_original(path: PathBuf) -> PathBuf {
    fs::canonicalize(&path).unwrap_or(path)
}

fn resolve_git_watch_targets(workdir: &str) -> Result<(PathBuf, PathBuf, Vec<PathBuf>), String> {
    let worktree_root = canonical_or_original(PathBuf::from(expand_path(workdir)));
    let git_dir = git_text(workdir, &["rev-parse", "--git-dir"])?;
    let git_dir_path = PathBuf::from(git_dir);
    let git_dir_abs = if git_dir_path.is_absolute() {
        git_dir_path
    } else {
        worktree_root.join(git_dir_path)
    };
    let git_dir_abs = canonical_or_original(git_dir_abs);

    let mut targets = vec![worktree_root.clone(), git_dir_abs.clone()];
    for name in ["HEAD", "index", "refs", "rebase-merge", "rebase-apply", "MERGE_HEAD"] {
        let candidate = git_dir_abs.join(name);
        if candidate.exists() && !targets.iter().any(|existing| existing == &candidate) {
            targets.push(candidate);
        }
    }

    Ok((worktree_root, git_dir_abs, targets))
}

fn should_emit_for_event(worktree_root: &Path, git_dir: &Path, event: &Event) -> bool {
    let relevant_kind = matches!(
        event.kind,
        EventKind::Create(CreateKind::Any)
            | EventKind::Create(CreateKind::File)
            | EventKind::Create(CreateKind::Folder)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(RenameMode::Any))
            | EventKind::Modify(ModifyKind::Name(RenameMode::Both))
            | EventKind::Modify(ModifyKind::Name(RenameMode::From))
            | EventKind::Modify(ModifyKind::Name(RenameMode::To))
            | EventKind::Remove(RemoveKind::Any)
            | EventKind::Remove(RemoveKind::File)
            | EventKind::Remove(RemoveKind::Folder)
    );
    if !relevant_kind {
        return false;
    }

    event.paths.iter().any(|path| path.starts_with(worktree_root) || path.starts_with(git_dir))
}

fn to_relative_path(worktree_root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(worktree_root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/").trim_matches('/').to_string())
}

fn parent_dir_for_relative_path(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
        .trim_matches('/')
        .to_string()
}

fn classify_event_type(event: &Event, worktree_root: &Path, git_dir: &Path) -> String {
    let touches_worktree = event.paths.iter().any(|path| path.starts_with(worktree_root));
    let touches_git_dir = event.paths.iter().any(|path| path.starts_with(git_dir));
    if touches_git_dir && !touches_worktree {
        return "git".to_string();
    }

    if matches!(event.kind, EventKind::Create(CreateKind::Any) | EventKind::Create(CreateKind::File) | EventKind::Create(CreateKind::Folder)) {
        return "create".to_string();
    }
    if matches!(event.kind, EventKind::Remove(RemoveKind::Any) | EventKind::Remove(RemoveKind::File) | EventKind::Remove(RemoveKind::Folder)) {
        return "delete".to_string();
    }
    if matches!(event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::Any))
            | EventKind::Modify(ModifyKind::Name(RenameMode::Both))
            | EventKind::Modify(ModifyKind::Name(RenameMode::From))
            | EventKind::Modify(ModifyKind::Name(RenameMode::To))
    ) {
        return "rename".to_string();
    }
    "change".to_string()
}

fn collect_worktree_paths(worktree_root: &Path, event: &Event) -> Vec<String> {
    let mut paths = event
        .paths
        .iter()
        .filter(|path| path.starts_with(worktree_root))
        .filter_map(|path| to_relative_path(worktree_root, path))
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

fn infer_path_kind(worktree_root: &Path, path: &str) -> Option<&'static str> {
    let absolute = worktree_root.join(path);
    if absolute.is_dir() {
        return Some("dir");
    }
    if absolute.is_file() {
        return Some("file");
    }
    None
}

fn collect_path_kinds(worktree_root: &Path, worktree_paths: &[String]) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for path in worktree_paths {
        if let Some(kind) = infer_path_kind(worktree_root, path) {
            map.insert(path.clone(), serde_json::Value::String(kind.to_string()));
        }
    }
    map
}

#[derive(Default)]
struct RenameAccumulator {
    pairs: Vec<(String, String)>,
    from_paths: Vec<String>,
    to_paths: Vec<String>,
}

impl RenameAccumulator {
    fn push_event(&mut self, event: &Event, worktree_root: &Path) {
        let relative_paths = event.paths.iter()
            .filter(|path| path.starts_with(worktree_root))
            .filter_map(|path| to_relative_path(worktree_root, path))
            .collect::<Vec<_>>();

        match event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if relative_paths.len() >= 2 => {
                self.pairs.push((relative_paths[0].clone(), relative_paths[1].clone()));
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                self.from_paths.extend(relative_paths);
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                self.to_paths.extend(relative_paths);
            }
            _ => {}
        }
    }

    fn into_json_pairs(mut self) -> Vec<serde_json::Value> {
        let count = self.from_paths.len().min(self.to_paths.len());
        for index in 0..count {
            self.pairs.push((self.from_paths[index].clone(), self.to_paths[index].clone()));
        }
        self.pairs
            .into_iter()
            .map(|(old_path, new_path)| serde_json::json!({
                "oldPath": old_path,
                "newPath": new_path,
            }))
            .collect()
    }
}

fn collect_reload_dirs(event_type: &str, worktree_paths: &[String]) -> Vec<String> {
    if event_type != "create" && event_type != "delete" && event_type != "rename" {
        return Vec::new();
    }

    let mut dirs = worktree_paths
        .iter()
        .map(|path| parent_dir_for_relative_path(path))
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.dedup();
    dirs
}

fn emit_refresh(
    app: &tauri::AppHandle,
    session_id: &str,
    reason: &str,
    event_type: &str,
    paths: &[String],
    reload_dirs: &[String],
    path_kinds: serde_json::Map<String, serde_json::Value>,
    rename_pairs: Vec<serde_json::Value>,
) {
    let _ = app.emit(
        "scm-refresh-requested",
        serde_json::json!({
            "session_id": session_id,
            "reason": reason,
            "event_type": event_type,
            "paths": paths,
            "reload_dirs": reload_dirs,
            "path_kinds": path_kinds,
            "rename_pairs": rename_pairs,
        }),
    );
}

#[tauri::command]
pub async fn start_git_watch(
    app: tauri::AppHandle,
    watchers: tauri::State<'_, GitWatcherMap>,
    session_id: String,
    workdir: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    let (worktree_root, git_dir, watch_targets) = resolve_git_watch_targets(&expanded)?;
    if watch_targets.is_empty() {
        return Ok(());
    }
    let session_key = session_id.trim().to_string();
    if session_key.is_empty() {
        return Err("缺少 session id".into());
    }

    let mut map = watchers
        .lock()
        .map_err(|_| "无法获取 Git watcher 状态".to_string())?;
    map.remove(&session_key);

    let app_handle = app.clone();
    let debounce_session = session_key.clone();
    let (event_tx, event_rx) = mpsc::channel::<Event>();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            if let Ok(event) = result {
                let _ = event_tx.send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    for target in &watch_targets {
        let mode = if target.is_dir() {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        watcher.watch(target, mode).map_err(|e| e.to_string())?;
    }

    thread::spawn(move || {
        loop {
            let first = match event_rx.recv() {
                Ok(event) => event,
                Err(_) => break,
            };

            if !should_emit_for_event(&worktree_root, &git_dir, &first) {
                continue;
            }

            let mut reason = format!("{:?}", first.kind);
            let mut event_type = classify_event_type(&first, &worktree_root, &git_dir);
            let mut paths = collect_worktree_paths(&worktree_root, &first);
            let mut reload_dirs = collect_reload_dirs(&event_type, &paths);
            let mut rename_accumulator = RenameAccumulator::default();
            if event_type == "rename" {
                rename_accumulator.push_event(&first, &worktree_root);
            }
            loop {
                match event_rx.recv_timeout(WATCH_DEBOUNCE) {
                    Ok(next) => {
                        if should_emit_for_event(&worktree_root, &git_dir, &next) {
                            reason = format!("{:?}", next.kind);
                            let next_event_type = classify_event_type(&next, &worktree_root, &git_dir);
                            if event_type != next_event_type {
                                event_type = "batch".to_string();
                            }
                            let next_paths = collect_worktree_paths(&worktree_root, &next);
                            paths.extend(next_paths.iter().cloned());
                            reload_dirs.extend(collect_reload_dirs(&next_event_type, &next_paths));
                            if next_event_type == "rename" {
                                rename_accumulator.push_event(&next, &worktree_root);
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            paths.sort();
            paths.dedup();
            reload_dirs.sort();
            reload_dirs.dedup();
            let path_kinds = collect_path_kinds(&worktree_root, &paths);
            let rename_pairs = rename_accumulator.into_json_pairs();
            emit_refresh(&app_handle, &debounce_session, &reason, &event_type, &paths, &reload_dirs, path_kinds, rename_pairs);
        }
    });

    map.insert(session_key.clone(), watcher);
    drop(map);
    emit_refresh(&app, &session_key, "watch-started", "git", &[], &[], serde_json::Map::new(), Vec::new());
    Ok(())
}

#[tauri::command]
pub async fn stop_git_watch(
    watchers: tauri::State<'_, GitWatcherMap>,
    session_id: String,
) -> Result<(), String> {
    let session_key = session_id.trim().to_string();
    if session_key.is_empty() {
        return Ok(());
    }

    let mut map = watchers
        .lock()
        .map_err(|_| "无法获取 Git watcher 状态".to_string())?;
    map.remove(&session_key);
    Ok(())
}
