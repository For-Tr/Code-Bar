use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::daemon_client::{daemon_rpc_request, ensure_codebard_running};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonWorkspaceInput {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub vcs_type: String,
    pub repo_identity: Option<String>,
    pub trust_level: String,
    pub default_provider: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn ensure_daemon_ready() -> Result<(), String> {
    ensure_codebard_running()
}

#[tauri::command]
pub fn daemon_health_check() -> Result<serde_json::Value, String> {
    ensure_codebard_running()?;
    daemon_rpc_request("health.check", json!({}))
}

#[tauri::command]
pub fn daemon_request(method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    ensure_codebard_running()?;
    daemon_rpc_request(&method, params)
}

#[tauri::command]
pub fn daemon_upsert_workspace(workspace: DaemonWorkspaceInput) -> Result<(), String> {
    ensure_codebard_running()?;
    daemon_rpc_request(
        "upsertWorkspace",
        json!({
            "workspace": workspace,
        }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn daemon_bind_provider_session(
    session_id: String,
    provider_session_id: String,
) -> Result<serde_json::Value, String> {
    ensure_codebard_running()?;
    daemon_rpc_request(
        "bindProviderSession",
        json!({
            "sessionId": session_id,
            "providerSessionId": provider_session_id,
        }),
    )
}

#[tauri::command]
pub fn daemon_write_pty(session_id: String, data: String) -> Result<(), String> {
    ensure_codebard_running()?;
    daemon_rpc_request(
        "writePty",
        json!({
            "sessionId": session_id,
            "data": data,
        }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn daemon_forward_provider_hook(
    provider: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_codebard_running()?;
    daemon_rpc_request(
        "forwardProviderHook",
        json!({
            "provider": provider,
            "payload": payload,
        }),
    )
}

#[tauri::command]
pub fn daemon_resize_pty(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    ensure_codebard_running()?;
    daemon_rpc_request(
        "resizePty",
        json!({
            "sessionId": session_id,
            "cols": cols,
            "rows": rows,
        }),
    )?;
    Ok(())
}
