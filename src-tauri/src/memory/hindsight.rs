use super::store::{is_local_url, Config};
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::Manager;

static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn child_slot() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}

fn resource_root(resource_dir: &Path) -> Option<PathBuf> {
    [
        resource_dir.join("hindsight"),
        resource_dir.join("resources").join("hindsight"),
    ]
    .into_iter()
    .find(|p| p.is_dir())
}

fn executable(root: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "hindsight-api.exe"
    } else {
        "hindsight-api"
    };
    let path = root.join(name);
    path.is_file().then_some(path)
}

fn healthy(url: &str) -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .ok()
        .and_then(|c| {
            c.get(format!("{}/health", url.trim_end_matches('/')))
                .send()
                .ok()
        })
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub fn start(app: &tauri::AppHandle, config: &Config) {
    if !config.enabled || !is_local_url(&config.base_url) {
        return;
    }
    if healthy(&config.base_url) {
        return;
    }
    let resource_dir = match app.path().resource_dir() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[hindsight] resource dir unavailable: {e}");
            return;
        }
    };
    let Some(root) = resource_root(&resource_dir) else {
        eprintln!(
            "[hindsight] bundled resource directory not found under {}",
            resource_dir.display()
        );
        return;
    };
    let Some(bin) = executable(&root) else {
        eprintln!(
            "[hindsight] bundled sidecar not found under {}",
            root.display()
        );
        return;
    };
    let mut slot = child_slot().lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_some() {
        return;
    }
    let port = reqwest::Url::parse(&config.base_url)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(8888);
    let mut cmd = Command::new(bin);
    cmd.env("HINDSIGHT_API_HOST", "127.0.0.1")
        .env("HINDSIGHT_API_PORT", port.to_string())
        .env("HINDSIGHT_API_DATABASE_URL", "pg0")
        .env("HINDSIGHT_API_LLM_PROVIDER", "openai")
        .env("HINDSIGHT_API_LLM_BASE_URL", &config.llm_base_url)
        .env("HINDSIGHT_API_LLM_MODEL", &config.llm_model)
        // Use the model shipped with the installer. This avoids a first-run
        // Hugging Face download and the optional sentence-transformers package.
        .env("HINDSIGHT_API_EMBEDDINGS_PROVIDER", "onnx")
        .env(
            "HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_ID",
            root.join("models").join("multilingual-e5-small"),
        )
        .env(
            "HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_PATH",
            root.join("models")
                .join("multilingual-e5-small")
                .join("onnx/model_O4.onnx"),
        )
        .env("HINDSIGHT_API_EMBEDDINGS_ONNX_FILE", "onnx/model_O4.onnx")
        .env(
            "HINDSIGHT_API_EMBEDDINGS_ONNX_TOKENIZER_NAME_OR_PATH",
            root.join("models")
                .join("multilingual-e5-small")
                .join("onnx"),
        )
        .env("HINDSIGHT_API_RERANKER_PROVIDER", "rrf")
        .env("HINDSIGHT_API_MCP_ENABLED", "true")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if !config.api_key.is_empty() {
        cmd.env("HINDSIGHT_API_LLM_API_KEY", &config.api_key);
    }
    match cmd.spawn() {
        Ok(child) => {
            *slot = Some(child);
            let url = config.base_url.clone();
            thread::spawn(move || {
                for _ in 0..40 {
                    if healthy(&url) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(250));
                }
                eprintln!("[hindsight] sidecar did not become healthy within 10 seconds");
            });
        }
        Err(e) => eprintln!("[hindsight] failed to start sidecar: {e}"),
    }
}

pub fn stop() {
    if let Some(mut child) = child_slot().lock().ok().and_then(|mut s| s.take()) {
        let _ = child.kill();
        let _ = child.wait();
    }
}
