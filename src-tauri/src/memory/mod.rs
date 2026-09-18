mod client;
mod collect;
mod hindsight;
mod mcp;
mod store;
#[cfg(test)]
mod tests;

use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};
use store::{field, Result, Store};
use tauri::Manager;
static WAKE: OnceLock<mpsc::SyncSender<()>> = OnceLock::new();
static COLLECT_LOCK: Mutex<()> = Mutex::new(());

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Some(namespace) = crate::runtime_scope::ui_state_namespace_dir() {
        dir = dir.join(namespace);
    }
    Ok(dir.join("memory"))
}
pub fn headless(args: &[String]) -> bool {
    if args.get(1).map(String::as_str) != Some("--memory-mcp") {
        return false;
    }
    let result = match (args.get(2), args.get(3)) {
        (Some(dir), Some(token)) => mcp::serve(Path::new(dir), token),
        _ => Err("Usage: code-bar --memory-mcp <data-dir> <binding-token>".into()),
    };
    if let Err(e) = result {
        eprintln!("[memory] {e}");
        std::process::exit(1);
    }
    true
}
pub fn wake() {
    if let Some(tx) = WAKE.get() {
        let _ = tx.try_send(());
    }
}
pub fn start_hindsight(app: &tauri::AppHandle) {
    if let Ok(dir) = data_dir(app) {
        if let Ok(store) = Store::open(&dir) {
            if let Ok(config) = store.config() {
                hindsight::start(app, &config);
            }
        }
    }
}

pub fn stop_hindsight() {
    hindsight::stop();
}

pub fn start_worker(app: &tauri::AppHandle) {
    let Ok(dir) = data_dir(app) else {
        return;
    };
    let (tx, rx) = mpsc::sync_channel(1);
    if WAKE.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || loop {
        let _ = rx.recv_timeout(Duration::from_secs(15));
        let result = (|| -> Result<()> {
            let store = Store::open(&dir)?;
            let config = store.config()?;
            if !config.enabled {
                return Ok(());
            }
            if config.auto_collect {
                if let Ok(_lock) = COLLECT_LOCK.try_lock() {
                    for b in store.bindings()? {
                        if !store.config()?.enabled {
                            break;
                        }
                        if let Err(e) = collect::collect(&store, &b) {
                            store.save_cursor(&format!("collection-error:{}", b.token), &e)?;
                        } else {
                            store.save_cursor(&format!("collection-error:{}", b.token), "")?;
                        }
                    }
                }
            }
            client::deliver(&store)?;
            Ok(())
        })();
        if let Err(e) = result {
            eprintln!("[memory worker] {e}");
        }
    });
}
#[tauri::command]
pub async fn memory_request(app: tauri::AppHandle, request: Value) -> Result<Value> {
    let dir = data_dir(&app)?;
    let is_configure = field(&request, "op") == "configure";
    let result = tokio::task::spawn_blocking(move || dispatch(&Store::open(&dir)?, &request))
        .await
        .map_err(|e| e.to_string())?;
    if is_configure {
        start_hindsight(&app);
    }
    wake();
    result
}
fn dispatch(store: &Store, v: &Value) -> Result<Value> {
    match field(v, "op") {
        "config" => return Ok(store.config()?.public()),
        "configure" => return store.configure(v),
        "register" => return serde_json::to_value(store.register(v)?).map_err(|e| e.to_string()),
        _ => (),
    }
    let b = store.binding(field(v, "token"))?;
    match field(v, "op") {
        "status" => {
            let mut status = store.status(&b)?;
            let e = store.cursor(&format!("collection-error:{}", b.token))?;
            if !e.is_empty() {
                status["lastError"] = json!(e);
            }
            Ok(status)
        }
        "collect" => {
            let _lock = COLLECT_LOCK.lock().map_err(|e| e.to_string())?;
            let queued = collect::collect(store, &b)?;
            store.save_cursor(&format!("collection-error:{}", b.token), "")?;
            Ok(json!({"queued":queued}))
        }
        "recall" => client::recall(store, &b, field(v, "query")),
        "sources" => Ok(json!(
            store.sources_page(&b, v["offset"].as_u64().unwrap_or(0))?
        )),
        "source" => store.source(&b, field(v, "sourceId")),
        "promote" => {
            store.set_scope(&b, field(v, "sourceId"), "repo")?;
            Ok(json!({"ok":true}))
        }
        "invalidate" => {
            store.invalidate(&b, field(v, "sourceId"))?;
            Ok(json!({"ok":true}))
        }
        _ => Err("Unknown memory operation".into()),
    }
}
pub fn prepare_launch(
    app: &tauri::AppHandle,
    session_id: &str,
    command: &str,
    runner: &str,
    env: &[(String, String)],
    args: Vec<String>,
) -> Result<Vec<String>> {
    if !matches!(runner, "codex" | "claude-code") {
        return Ok(args);
    }
    let get = |key: &str| {
        env.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .unwrap_or("")
    };
    // Only managed Agent PTYs, never arbitrary terminal widgets.
    if get("CODE_BAR_SESSION_ID") != session_id {
        return Ok(args);
    }
    let dir = data_dir(app)?;
    let store = Store::open(&dir)?;
    if !store.config()?.enabled {
        return Ok(args);
    }
    let root = crate::util::resolve_provider_dir(runner, command)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let b=store.register(&json!({"workspacePath":get("CODE_BAR_WORKDIR"),"sessionId":session_id,"runnerType":runner,"worktreePath":get("CODE_BAR_WORKTREE_PATH"),"providerSessionId":get("CODE_BAR_PROVIDER_SESSION_ID"),"providerRoot":root}))?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    wake();
    Ok(mcp::launch_args(
        runner,
        &exe.to_string_lossy(),
        &dir.to_string_lossy(),
        &b.token,
        args,
    ))
}
pub fn bind_native(
    app: &tauri::AppHandle,
    session_id: &str,
    provider_id: &str,
    runner: &str,
    cwd: Option<&str>,
) {
    let result = (|| -> Result<()> {
        let store = Store::open(&data_dir(app)?)?;
        for b in store.bindings()? {
            if b.session_id != session_id || b.runner_type != runner {
                continue;
            }
            if let Some(cwd) = cwd {
                if store::normalized_path(cwd) != store::normalized_path(&b.worktree_path) {
                    continue;
                }
            }
            store.register(&json!({"workspacePath":b.workspace_path,"sessionId":b.session_id,"runnerType":runner,"worktreePath":b.worktree_path,"providerSessionId":provider_id}))?;
        }
        Ok(())
    })();
    if let Err(e) = result {
        eprintln!("[memory bind] {e}");
    }
    wake();
}
