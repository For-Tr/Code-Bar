use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub type VcsType = codebar_contracts::domain::VcsType;
pub type TrustLevel = codebar_contracts::domain::TrustLevel;
pub type ProviderKind = codebar_contracts::domain::ProviderKind;
pub type WorktreeSource = codebar_contracts::domain::WorktreeSource;
pub type WorktreeLifecycleState = codebar_contracts::domain::WorktreeLifecycleState;
pub type WorktreeCleanupPolicy = codebar_contracts::domain::WorktreeCleanupPolicy;
pub type TaskStatus = codebar_contracts::domain::TaskStatus;
pub type SessionLaunchMode = codebar_contracts::domain::SessionLaunchMode;
pub type SessionState = codebar_contracts::domain::SessionState;
pub type RunLauncherType = codebar_contracts::domain::LauncherType;
pub type RunExitReason = codebar_contracts::domain::RunExitReason;
pub type RunStatus = codebar_contracts::domain::RunAttemptStatus;
pub type PlanMode = codebar_contracts::domain::PlanMode;
pub type PlanStatus = codebar_contracts::domain::PlanStatus;
pub type PlanStepStatus = codebar_contracts::domain::PlanStepStatus;
pub type SkillProfileSource = codebar_contracts::domain::SkillProfileSource;
pub type ApprovalActionType = codebar_contracts::domain::ApprovalActionType;
pub type ApprovalStatus = codebar_contracts::rpc::ApprovalStatus;
pub type EventEntityType = codebar_contracts::events::EventEntityType;
pub type EventSource = codebar_contracts::events::EventSource;

pub type Workspace = codebar_contracts::domain::Workspace;
pub type Worktree = codebar_contracts::domain::Worktree;
pub type Task = codebar_contracts::domain::Task;
pub type Session = codebar_contracts::domain::Session;
pub type RunAttempt = codebar_contracts::domain::RunAttempt;
pub type Plan = codebar_contracts::domain::Plan;
pub type PlanStep = codebar_contracts::domain::PlanStep;
pub type SkillProfile = codebar_contracts::domain::SkillProfile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryBinding {
    pub session_id: String,
    pub provider: ProviderKind,
    pub provider_session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub run_attempt_id: Option<String>,
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

pub fn error_envelope(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
) -> ErrorEnvelope {
    codebar_contracts::errors::ErrorEnvelope::new(code, message, retryable)
}

pub fn error_with_details(error: ErrorEnvelope, details: Value) -> ErrorEnvelope {
    codebar_contracts::errors::ErrorEnvelope::with_details(error, details)
}
