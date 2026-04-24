use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type WorkflowMetadata = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagNodeKind {
    TaskRoot,
    Step,
    ApprovalGate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagEdgeKind {
    DependsOn,
    SpawnsApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagProvider {
    ClaudeCode,
    Codex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagStepStatus {
    Idle,
    Ready,
    Running,
    Blocked,
    WaitingInput,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagSessionState {
    Idle,
    Created,
    Launching,
    Running,
    WaitingInput,
    Paused,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDagDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagTask {
    pub id: String,
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub goal: Option<String>,
    pub status: String,
    pub workspace_id: String,
    #[serde(default)]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub active_plan_id: Option<String>,
    #[serde(default)]
    pub metadata: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagPlan {
    pub id: String,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub active_step_id: Option<String>,
    #[serde(default)]
    pub step_ids: Vec<String>,
    #[serde(default)]
    pub metadata: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagSession {
    pub id: String,
    pub provider: TaskDagProvider,
    pub state: TaskDagSessionState,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagApprovalRequest {
    pub id: String,
    pub status: TaskDagApprovalStatus,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub requested_at: Option<String>,
    #[serde(default)]
    pub responded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagLease {
    #[serde(default)]
    pub owner_session_id: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagStepRuntime {
    #[serde(default)]
    pub current_session: Option<TaskDagSession>,
    #[serde(default)]
    pub active_approval: Option<TaskDagApprovalRequest>,
    #[serde(default)]
    pub lease: Option<TaskDagLease>,
    #[serde(default)]
    pub latest_progress_summary: Option<String>,
    #[serde(default)]
    pub recommended_next_actions: Vec<String>,
    #[serde(default)]
    pub metadata: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagTaskRootNode {
    pub id: String,
    pub kind: TaskDagNodeKind,
    pub task_id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagStepNode {
    pub id: String,
    pub kind: TaskDagNodeKind,
    pub step_id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub status: TaskDagStepStatus,
    pub depends_on: Vec<String>,
    pub required_skills: Vec<String>,
    pub allowed_providers: Vec<TaskDagProvider>,
    pub parallelizable: bool,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub runtime: Option<TaskDagStepRuntime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagApprovalGateNode {
    pub id: String,
    pub kind: TaskDagNodeKind,
    pub step_id: String,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub approval_request: TaskDagApprovalRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TaskDagNode {
    TaskRoot(TaskDagTaskRootNode),
    Step(TaskDagStepNode),
    ApprovalGate(TaskDagApprovalGateNode),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagEdge {
    pub id: String,
    pub kind: TaskDagEdgeKind,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagCapabilities {
    pub can_refresh: bool,
    pub can_claim_step: bool,
    pub can_complete_step: bool,
    pub can_block_step: bool,
    pub can_resolve_approval: bool,
    pub can_attach_session: bool,
    pub can_launch_session: bool,
    pub can_send_session_input: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagDocument {
    pub graph_id: String,
    pub revision: String,
    pub task: TaskDagTask,
    #[serde(default)]
    pub plan: Option<TaskDagPlan>,
    pub nodes: Vec<TaskDagNode>,
    pub edges: Vec<TaskDagEdge>,
    pub layout_version: u32,
    pub capabilities: TaskDagCapabilities,
    #[serde(default)]
    pub metadata: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagEvent {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub step_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub kind: String,
    pub level: TaskDagEventLevel,
    pub message: String,
    pub created_at: String,
    #[serde(default)]
    pub data: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagDiagnostic {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub step_id: Option<String>,
    pub severity: TaskDagDiagnosticSeverity,
    pub summary: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub data: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDagNextAction {
    pub task_id: String,
    pub mode: String,
    #[serde(default)]
    pub step_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub recommended_sequence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkflowSnapshotRequest {
    pub task_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub include_events: Option<bool>,
    #[serde(default)]
    pub include_diagnostics: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkflowSnapshotResponse {
    pub document: TaskDagDocument,
    pub events: Vec<TaskDagEvent>,
    pub diagnostics: Vec<TaskDagDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimWorkflowStepRequest {
    pub session_id: String,
    #[serde(default)]
    pub step_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimWorkflowStepResponse {
    pub step_id: String,
    pub lease_token: String,
    pub lease_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkflowProgressRequest {
    pub session_id: String,
    pub step_id: String,
    #[serde(default)]
    pub lease_token: Option<String>,
    pub summary: String,
    #[serde(default)]
    pub details: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompleteWorkflowStepRequest {
    pub session_id: String,
    pub step_id: String,
    #[serde(default)]
    pub lease_token: Option<String>,
    #[serde(default)]
    pub outputs: Option<WorkflowMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockWorkflowStepRequest {
    pub session_id: String,
    pub step_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkflowApprovalRequest {
    pub approval_id: String,
    pub decision: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachWorkflowSessionRequest {
    pub provider: TaskDagProvider,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
}
