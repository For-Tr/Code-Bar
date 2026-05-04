use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::util::{background_command, home_dir};

static DAEMON_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn daemon_process_slot() -> &'static Mutex<Option<Child>> {
    DAEMON_PROCESS.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonRpcRequest {
    pub id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonRpcResponse {
    pub id: Option<String>,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<DaemonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonRpcError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub details: Option<Value>,
}

pub fn ensure_codebard_running() -> Result<(), String> {
    if daemon_health_check().is_ok() {
        return Ok(());
    }

    let binary_path = resolve_codebard_binary_path();
    let mut child = background_command(&binary_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to launch codebard: {error}"))?;

    {
        let mut slot = daemon_process_slot().lock().unwrap();
        *slot = Some(child);
    }

    for _ in 0..40 {
        if daemon_health_check().is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let mut slot = daemon_process_slot().lock().unwrap();
    if let Some(mut process) = slot.take() {
        let _ = process.kill();
    }
    Err("codebard did not become ready".to_string())
}

pub fn daemon_health_check() -> Result<Value, String> {
    daemon_rpc_request("health.check", serde_json::json!({}))
}

pub fn daemon_rpc_request(method: &str, params: Value) -> Result<Value, String> {
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let socket_path = codebard_socket_path();
        let mut stream = UnixStream::connect(&socket_path).map_err(|error| {
            format!(
                "failed to connect to codebard {}: {error}",
                socket_path.display()
            )
        })?;
        let request = DaemonRpcRequest {
            id: Some("desktop".to_string()),
            method: method.to_string(),
            params,
        };
        let encoded = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        stream
            .write_all(format!("{encoded}\n").as_bytes())
            .map_err(|error| error.to_string())?;
        let mut line = String::new();
        let mut reader = BufReader::new(stream);
        reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        let response =
            serde_json::from_str::<DaemonRpcResponse>(&line).map_err(|error| error.to_string())?;
        if response.ok {
            Ok(response.result.unwrap_or(Value::Null))
        } else {
            let error = response.error.unwrap_or(DaemonRpcError {
                code: "unknown_error".to_string(),
                message: "unknown daemon error".to_string(),
                retryable: false,
                details: None,
            });
            Err(format!("{}: {}", error.code, error.message))
        }
    }

    #[cfg(not(unix))]
    {
        let _ = method;
        let _ = params;
        Err("codebard desktop bridge currently supports unix sockets only".to_string())
    }
}

pub fn codebard_socket_path() -> PathBuf {
    let home = home_dir().unwrap_or_else(std::env::temp_dir);
    home.join(".codebar").join("codebard").join("codebard.sock")
}

pub fn start_event_bridge(app: AppHandle) {
    #[cfg(unix)]
    {
        let socket_path = codebard_socket_path();
        std::thread::spawn(move || {
            use std::os::unix::net::UnixStream;
            let stream = match UnixStream::connect(&socket_path) {
                Ok(stream) => stream,
                Err(error) => {
                    eprintln!("[codebard] event bridge connect failed: {error}");
                    return;
                }
            };
            let request = DaemonRpcRequest {
                id: Some("desktop-events".to_string()),
                method: "subscribeEvents".to_string(),
                params: Value::Object(Default::default()),
            };
            let encoded = match serde_json::to_string(&request) {
                Ok(encoded) => encoded,
                Err(error) => {
                    eprintln!("[codebard] event bridge encode failed: {error}");
                    return;
                }
            };
            let mut writer = match stream.try_clone() {
                Ok(writer) => writer,
                Err(error) => {
                    eprintln!("[codebard] event bridge clone failed: {error}");
                    return;
                }
            };
            if let Err(error) = writer.write_all(format!("{encoded}\n").as_bytes()) {
                eprintln!("[codebard] event bridge write failed: {error}");
                return;
            }
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(event) = value.get("event") else {
                    continue;
                };
                if let Some(event_type) = event.get("eventType").and_then(|value| value.as_str()) {
                    let payload = event.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(event_type, payload);
                }
                let _ = app.emit("daemon-event", event);
            }
        });
    }
}

fn resolve_codebard_binary_path() -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .expect("workspace root");

    #[cfg(debug_assertions)]
    {
        let candidate = workspace_root
            .join("target")
            .join("debug")
            .join(if cfg!(windows) {
                "codebard.exe"
            } else {
                "codebard"
            });
        return candidate.to_string_lossy().to_string();
    }

    #[cfg(not(debug_assertions))]
    {
        let candidate = workspace_root
            .join("target")
            .join("release")
            .join(if cfg!(windows) {
                "codebard.exe"
            } else {
                "codebard"
            });
        candidate.to_string_lossy().to_string()
    }
}
