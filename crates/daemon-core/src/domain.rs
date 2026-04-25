use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VcsType {
    Git,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    Trusted,
    Untrusted,
}

pub type ProviderKind = codebar_contracts::domain::ProviderKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeSource {
    Existing,
    Managed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeLifecycleState {
    Preparing,
    Ready,
    InUse,
    CleanupPending,
    Removed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeCleanupPolicy {
    Manual,
    AutoOnTaskDone,
    Keep,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    Ready,
    Active,
    Blocked,
    Completed,
    Failed,
    Cancelled,
    Archived,
}

pub type SessionLaunchMode = codebar_contracts::domain::SessionLaunchMode;
pub type SessionState = codebar_contracts::domain::SessionState;
pub type RunLauncherType = codebar_contracts::domain::LauncherType;
pub type RunExitReason = codebar_contracts::domain::RunExitReason;
pub type RunStatus = codebar_contracts::domain::RunAttemptStatus;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanMode {
    Guided,
    Open,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Active,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepStatus {
    Pending,
    Claimed,
    Running,
    Blocked,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillProfileSource {
    Workspace,
    Worktree,
    Task,
    Step,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalActionType {
    Write,
    Delete,
    GitPush,
    DangerousBash,
    ExternalSideEffect,
}

pub type ApprovalStatus = codebar_contracts::rpc::ApprovalStatus;
pub type EventEntityType = codebar_contracts::events::EventEntityType;
pub type EventSource = codebar_contracts::events::EventSource;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub vcs_type: VcsType,
    pub repo_identity: Option<String>,
    pub trust_level: TrustLevel,
    pub default_provider: Option<ProviderKind>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub branch_name: Option<String>,
    pub base_branch: Option<String>,
    pub source: WorktreeSource,
    pub lifecycle_state: WorktreeLifecycleState,
    pub cleanup_policy: WorktreeCleanupPolicy,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub prompt: String,
    pub goal: Option<String>,
    pub constraints: Option<Vec<String>>,
    pub requested_provider: Option<ProviderKind>,
    pub requested_model: Option<String>,
    pub status: TaskStatus,
    pub active_plan_id: Option<String>,
    pub active_skill_profile_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub type Session = codebar_contracts::domain::Session;
pub type RunAttempt = codebar_contracts::domain::RunAttempt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub task_id: String,
    pub mode: PlanMode,
    pub status: PlanStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub plan_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: PlanStepStatus,
    pub depends_on: Vec<String>,
    pub parallelizable: bool,
    pub required_skills: Vec<String>,
    pub allowed_providers: Option<Vec<ProviderKind>>,
    pub lease_owner_session_id: Option<String>,
    pub lease_token: Option<String>,
    pub lease_expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillProfile {
    pub id: String,
    pub name: String,
    pub source: SkillProfileSource,
    pub workspace_id: Option<String>,
    pub worktree_id: Option<String>,
    pub task_id: Option<String>,
    pub step_id: Option<String>,
    pub allowed_skills: Vec<String>,
    pub preferred_skills: Option<Vec<String>>,
    pub forbidden_skills: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub session_id: String,
    pub task_id: String,
    pub action_type: ApprovalActionType,
    pub title: String,
    pub description: String,
    pub payload: HashMap<String, Value>,
    pub status: ApprovalStatus,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

pub type EventEnvelope = codebar_contracts::events::EventEnvelope;
pub type ErrorEnvelope = codebar_contracts::errors::ErrorEnvelope;
pub type ErrorCode = codebar_contracts::errors::ErrorCode;
pub type DomainResult<T> = Result<T, ErrorEnvelope>;

pub fn error_envelope(code: ErrorCode, message: impl Into<String>, retryable: bool) -> ErrorEnvelope {
    codebar_contracts::errors::ErrorEnvelope::new(code, message, retryable)
}

pub fn error_with_details(error: ErrorEnvelope, details: Value) -> ErrorEnvelope {
    codebar_contracts::errors::ErrorEnvelope::with_details(error, details)
}
