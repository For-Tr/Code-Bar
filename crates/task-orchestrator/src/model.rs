use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type JsonMap = BTreeMap<String, Value>;

pub type Provider = codebar_contracts::domain::ProviderKind;

pub type VcsType = codebar_contracts::domain::VcsType;
pub type TrustLevel = codebar_contracts::domain::TrustLevel;

pub type WorktreeSource = codebar_contracts::domain::WorktreeSource;
pub type WorktreeLifecycleState = codebar_contracts::domain::WorktreeLifecycleState;
pub type CleanupPolicy = codebar_contracts::domain::WorktreeCleanupPolicy;
pub type TaskStatus = codebar_contracts::domain::TaskStatus;

pub type SessionLaunchMode = codebar_contracts::domain::SessionLaunchMode;
pub type SessionState = codebar_contracts::domain::SessionState;
pub type LauncherType = codebar_contracts::domain::LauncherType;
pub type ExitReason = codebar_contracts::domain::RunExitReason;
pub type RunStatus = codebar_contracts::domain::RunAttemptStatus;

pub type PlanMode = codebar_contracts::domain::PlanMode;
pub type PlanStatus = codebar_contracts::domain::PlanStatus;
pub type PlanStepStatus = codebar_contracts::domain::PlanStepStatus;
pub type SkillProfileSource = codebar_contracts::domain::SkillProfileSource;
pub type ApprovalActionType = codebar_contracts::domain::ApprovalActionType;
pub type ApprovalStatus = codebar_contracts::rpc::ApprovalStatus;
pub type EventEntityType = codebar_contracts::events::EventEntityType;
pub type EventSource = codebar_contracts::events::EventSource;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RecommendedCallType {
    Skill,
    Tool,
}

pub type Workspace = codebar_contracts::domain::Workspace;
pub type Worktree = codebar_contracts::domain::Worktree;
pub type Task = codebar_contracts::domain::Task;
pub type Session = codebar_contracts::domain::Session;
pub type RunAttempt = codebar_contracts::domain::RunAttempt;
pub type Plan = codebar_contracts::domain::Plan;
pub type PlanStep = codebar_contracts::domain::PlanStep;
pub type SkillProfile = codebar_contracts::domain::SkillProfile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub session_id: String,
    pub task_id: String,
    pub action_type: ApprovalActionType,
    pub title: String,
    pub description: String,
    pub payload: JsonMap,
    pub status: ApprovalStatus,
    pub created_at: String,
    #[serde(default)]
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub id: String,
    pub entity_type: EventEntityType,
    pub entity_id: String,
    pub event_type: String,
    pub source: EventSource,
    #[serde(default)]
    pub correlation_id: Option<String>,
    pub payload: JsonMap,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default)]
    pub details: Option<JsonMap>,
}

impl ErrorEnvelope {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            details: None,
        }
    }

    pub fn with_details(mut self, details: JsonMap) -> Self {
        self.details = Some(details);
        self
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message, false)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message, true)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message, false)
    }
}

impl std::fmt::Display for ErrorEnvelope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ErrorEnvelope {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NextActionStepView {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub success_criteria: Option<Vec<String>>,
    #[serde(default)]
    pub lease_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedCall {
    #[serde(rename = "type")]
    pub kind: RecommendedCallType,
    pub name: String,
}

impl RecommendedCall {
    pub fn skill(name: impl Into<String>) -> Self {
        Self {
            kind: RecommendedCallType::Skill,
            name: name.into(),
        }
    }

    pub fn tool(name: impl Into<String>) -> Self {
        Self {
            kind: RecommendedCallType::Tool,
            name: name.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NextActionView {
    pub task_id: String,
    pub mode: PlanMode,
    #[serde(default)]
    pub step: Option<NextActionStepView>,
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub recommended_sequence: Option<Vec<RecommendedCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimStepResult {
    pub step_id: String,
    pub lease_token: String,
    pub lease_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSkills {
    #[serde(default)]
    pub active_skill_profile_id: Option<String>,
    #[serde(default)]
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub preferred_skills: Option<Vec<String>>,
    #[serde(default)]
    pub forbidden_skills: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttachmentInput {
    pub provider: Provider,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttachment {
    pub session_id: String,
    pub task_id: String,
    pub mode: PlanMode,
    #[serde(default)]
    pub active_step_id: Option<String>,
    #[serde(default)]
    pub active_skill_profile_id: Option<String>,
    pub recommended_next_calls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompleteStepResult {
    #[serde(default)]
    pub next_step_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationState {
    #[serde(default)]
    pub workspaces: BTreeMap<String, Workspace>,
    #[serde(default)]
    pub worktrees: BTreeMap<String, Worktree>,
    #[serde(default)]
    pub tasks: BTreeMap<String, Task>,
    #[serde(default)]
    pub sessions: BTreeMap<String, Session>,
    #[serde(default)]
    pub run_attempts: BTreeMap<String, RunAttempt>,
    #[serde(default)]
    pub plans: BTreeMap<String, Plan>,
    #[serde(default)]
    pub steps: BTreeMap<String, PlanStep>,
    #[serde(default)]
    pub skill_profiles: BTreeMap<String, SkillProfile>,
    #[serde(default)]
    pub approvals: BTreeMap<String, ApprovalRequest>,
    #[serde(default)]
    pub events: Vec<EventEnvelope>,
}

impl OrchestrationState {
    pub fn active_plan_for_task(&self, task_id: &str) -> Option<&Plan> {
        let task = self.tasks.get(task_id)?;
        if let Some(plan_id) = task.active_plan_id.as_deref() {
            if let Some(plan) = self.plans.get(plan_id) {
                return Some(plan);
            }
        }

        self.plans
            .values()
            .filter(|plan| plan.task_id == task_id && plan.status == PlanStatus::Active)
            .max_by(|left, right| {
                left.updated_at
                    .cmp(&right.updated_at)
                    .then(left.id.cmp(&right.id))
            })
    }

    pub fn steps_for_plan(&self, plan_id: &str) -> Vec<&PlanStep> {
        self.steps
            .values()
            .filter(|step| step.plan_id == plan_id)
            .collect()
    }

    pub fn has_pending_approval(&self, task_id: &str, session_id: &str) -> bool {
        self.approvals.values().any(|request| {
            request.task_id == task_id
                && (request.session_id == session_id || request.session_id.is_empty())
                && request.status == ApprovalStatus::Pending
        })
    }

    pub fn step_task_id(&self, step_id: &str) -> Option<String> {
        let step = self.steps.get(step_id)?;
        let plan = self.plans.get(&step.plan_id)?;
        Some(plan.task_id.clone())
    }

    pub fn normalize_skill_list(values: &[String]) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut next = values
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .filter(|value| seen.insert(value.clone()))
            .collect::<Vec<_>>();
        next.sort();
        next
    }
}
