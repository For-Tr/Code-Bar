use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    domain::{ApprovalActionType, ApprovalRequest, Plan, PlanMode, PlanStep, ProviderKind, Session, Task, Worktree, Workspace},
    events::EventEnvelope,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeStrategy {
    Reuse,
    NewManaged,
    Ask,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileReadResult {
    pub path: String,
    pub content: String,
    pub version_token: Option<String>,
    pub is_binary: bool,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileWriteResult {
    pub path: String,
    pub version_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDirectoryListResult {
    pub path: String,
    pub entries: Vec<SessionDirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatusEntry {
    pub path: String,
    pub kind: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatusGroups {
    pub conflicts: Vec<ScmStatusEntry>,
    pub staged: Vec<ScmStatusEntry>,
    pub unstaged: Vec<ScmStatusEntry>,
    pub untracked: Vec<ScmStatusEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileVersion {
    pub label: String,
    pub content: String,
    pub is_binary: bool,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFilePayload {
    pub path: String,
    pub versions: Vec<ConflictFileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DeletedSessionRef {
    pub session_id: String,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DeletedWorkspaceRef {
    pub workspace_id: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletedUiState {
    pub session_ids: Vec<String>,
    pub workspace_ids: Vec<String>,
    pub sessions: Vec<DeletedSessionRef>,
    pub workspaces: Vec<DeletedWorkspaceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecoveryBindingInput {
    pub session_id: String,
    pub runner_type: String,
    pub provider_session_id: String,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackfillSessionBindingInput {
    pub session_id: String,
    pub runner_type: String,
    pub worktree_path: Option<String>,
    pub provider_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackfilledSessionBinding {
    pub session_id: String,
    pub provider_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub workspace_id: String,
    pub title: String,
    pub prompt: String,
    pub goal: Option<String>,
    pub constraints: Option<Vec<String>>,
    pub requested_provider: Option<ProviderKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskOutput {
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksInput {
    pub workspace_id: Option<String>,
    pub status: Option<Vec<crate::domain::TaskStatus>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksOutput {
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskOutput {
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub task_id: String,
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub goal: Option<String>,
    pub constraints: Option<Vec<String>>,
    pub status: Option<crate::domain::TaskStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskOutput {
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertWorkspaceInput {
    pub workspace: Workspace,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionOutput {
    pub session: Session,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsInput {
    pub task_id: Option<String>,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsOutput {
    pub sessions: Vec<Session>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub task_id: String,
    pub provider: ProviderKind,
    pub worktree_strategy: WorktreeStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionOutput {
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSessionInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSessionOutput {
    pub session: Session,
    pub run: crate::domain::RunAttempt,
}

pub type ResumeSessionInput = LaunchSessionInput;
pub type ResumeSessionOutput = LaunchSessionOutput;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendSessionInputInput {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedOutput {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritePtyInput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResizePtyInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordRuntimeLifecycleInput {
    pub session_id: String,
    pub event_type: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordRuntimeLifecycleOutput {
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BindProviderSessionInput {
    pub session_id: String,
    pub provider_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BindProviderSessionOutput {
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderHookInput {
    pub provider: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForwardProviderHookOutput {
    pub provider_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StopSessionInput {
    pub session_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareWorktreeInput {
    pub session_id: String,
    pub strategy: WorktreeStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareWorktreeOutput {
    pub worktree: Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupWorktreeInput {
    pub worktree_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetActivePlanInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetActivePlanOutput {
    pub plan: Option<Plan>,
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetNextActionInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetNextActionOutput {
    pub task_id: String,
    pub step: Option<PlanStep>,
    pub mode: PlanMode,
    pub active_skills: Vec<String>,
    pub recommended_next_calls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListApprovalRequestsInput {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub status: Option<Vec<ApprovalStatus>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListApprovalRequestsOutput {
    pub requests: Vec<ApprovalRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApprovalInput {
    pub approval_request_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApprovalOutput {
    pub request: ApprovalRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestApprovalInput {
    pub session_id: String,
    pub action_type: ApprovalActionType,
    pub title: String,
    pub description: String,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestApprovalOutput {
    pub approval: ApprovalRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsInput {
    pub entity_type: Option<crate::events::EventEntityType>,
    pub entity_id: Option<String>,
    pub since: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsOutput {
    pub events: Vec<EventEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetDiagnosticsInput {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetDiagnosticsOutput {
    pub summary: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckOutput {
    pub summary: String,
    pub ready: bool,
    pub pending_approvals: usize,
    pub running_sessions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RpcEventPayload {
    pub session_id: String,
    pub data: Value,
}
