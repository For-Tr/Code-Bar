use tauri::command;

use codebar_contracts::workflow::{
    AttachWorkflowSessionRequest, AttachWorkflowSessionResponse, BlockWorkflowStepRequest,
    ClaimWorkflowStepRequest, ClaimWorkflowStepResponse, CompleteWorkflowStepRequest,
    CompleteWorkflowStepResponse, GetWorkflowNextActionRequest, GetWorkflowNextActionResponse,
    GetWorkflowSnapshotRequest, GetWorkflowSnapshotResponse, ResolveWorkflowApprovalRequest,
    ResolveWorkflowApprovalResponse, TaskDagEvent, UpdateWorkflowProgressRequest,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::daemon_client::{daemon_rpc_request, ensure_codebard_running};

#[command]
pub fn orchestration_get_workflow_snapshot(
    input: GetWorkflowSnapshotRequest,
) -> Result<GetWorkflowSnapshotResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc("getWorkflowSnapshot", input)
}

#[command]
pub fn orchestration_list_task_events(task_id: String) -> Result<Vec<TaskDagEvent>, String> {
    ensure_codebard_running()?;
    let snapshot: GetWorkflowSnapshotResponse = daemon_rpc(
        "getWorkflowSnapshot",
        GetWorkflowSnapshotRequest {
            task_id,
            session_id: None,
            include_events: Some(true),
            include_diagnostics: Some(false),
        },
    )?;
    Ok(snapshot.events)
}

#[command]
pub fn orchestration_get_session_next_action(
    session_id: String,
) -> Result<GetWorkflowNextActionResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc(
        "getWorkflowNextAction",
        GetWorkflowNextActionRequest { session_id },
    )
}

#[command]
pub fn orchestration_claim_step(
    input: ClaimWorkflowStepRequest,
) -> Result<ClaimWorkflowStepResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc("claimWorkflowStep", input)
}

#[command]
pub fn orchestration_update_step_progress(
    input: UpdateWorkflowProgressRequest,
) -> Result<(), String> {
    ensure_codebard_running()?;
    let _: Value = daemon_rpc("updateWorkflowProgress", input)?;
    Ok(())
}

#[command]
pub fn orchestration_complete_step(
    input: CompleteWorkflowStepRequest,
) -> Result<CompleteWorkflowStepResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc("completeWorkflowStep", input)
}

#[command]
pub fn orchestration_block_step(input: BlockWorkflowStepRequest) -> Result<(), String> {
    ensure_codebard_running()?;
    let _: Value = daemon_rpc("blockWorkflowStep", input)?;
    Ok(())
}

#[command]
pub fn orchestration_attach_session(
    input: AttachWorkflowSessionRequest,
) -> Result<AttachWorkflowSessionResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc("attachWorkflowSession", input)
}

#[command]
pub fn orchestration_resolve_approval(
    input: ResolveWorkflowApprovalRequest,
) -> Result<ResolveWorkflowApprovalResponse, String> {
    ensure_codebard_running()?;
    daemon_rpc("resolveWorkflowApproval", input)
}

fn daemon_rpc<T>(method: &str, params: impl serde::Serialize) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let params = serde_json::to_value(params).map_err(|error| error.to_string())?;
    let value = daemon_rpc_request(method, params)?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
