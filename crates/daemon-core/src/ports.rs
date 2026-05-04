use crate::domain::{
    ApprovalRequest, ApprovalStatus, DomainResult, EventEnvelope, Plan, PlanStep, ProviderKind,
    RecoveryBinding, RunAttempt, Session, SkillProfile, Task, TaskStatus, Workspace, Worktree,
};
use codebar_contracts::domain::LauncherType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub workspace_id: Option<String>,
    pub status: Option<Vec<TaskStatus>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFilter {
    pub task_id: Option<String>,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalFilter {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub status: Option<Vec<ApprovalStatus>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFilter {
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub since: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeStrategy {
    Reuse,
    NewManaged,
    Ask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedWorktree {
    pub path: String,
    pub branch_name: Option<String>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    pub session_id: String,
    pub provider: ProviderKind,
    pub launcher_type: LauncherType,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub bootstrap_prompt: Option<String>,
    pub user_prompt: Option<String>,
    pub mcp_bridge_command: Option<String>,
    pub mcp_bridge_args: Option<Vec<String>>,
    pub provider_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessHandle {
    pub handle_id: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ProcessEvent {
    Started {
        handle_id: String,
        pid: Option<u32>,
    },
    Stdout {
        handle_id: String,
        chunk: String,
    },
    Stderr {
        handle_id: String,
        chunk: String,
    },
    Exited {
        handle_id: String,
        exit_code: Option<i32>,
        signal: Option<String>,
    },
    Error {
        handle_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub launcher_type: LauncherType,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub handle: ProcessHandle,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub resume_supported: bool,
    pub hook_events_supported: bool,
    pub approval_events_supported: bool,
    pub mcp_bridge_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDetection {
    pub available: bool,
    pub command: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CanonicalProviderEvent {
    ProviderSessionBound {
        provider_session_id: String,
    },
    OutputChunk {
        stream: Option<String>,
        text: Option<String>,
        base64: Option<String>,
    },
    WaitingForInput,
    ApprovalRequested {
        title: Option<String>,
        description: Option<String>,
        payload: Option<Value>,
    },
    RunExited {
        exit_code: Option<i32>,
        signal: Option<String>,
    },
    ErrorRaised {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedProviderEvent {
    pub session_id: Option<String>,
    pub event: CanonicalProviderEvent,
    pub event_type: String,
    pub payload: Value,
}

pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}

pub trait IdGenerator: Send + Sync {
    fn next_task_id(&self) -> String;
    fn next_session_id(&self) -> String;
    fn next_worktree_id(&self) -> String;
    fn next_run_attempt_id(&self) -> String;
    fn next_plan_id(&self) -> String;
    fn next_plan_step_id(&self) -> String;
    fn next_skill_profile_id(&self) -> String;
    fn next_approval_request_id(&self) -> String;
    fn next_event_id(&self) -> String;
}

pub trait WorkspaceRepository: Send + Sync {
    fn put_workspace(&self, workspace: Workspace) -> DomainResult<()>;
    fn get_workspace(&self, workspace_id: &str) -> DomainResult<Option<Workspace>>;
    fn list_workspaces(&self) -> DomainResult<Vec<Workspace>>;
}

pub trait TaskRepository: Send + Sync {
    fn put_task(&self, task: Task) -> DomainResult<()>;
    fn get_task(&self, task_id: &str) -> DomainResult<Option<Task>>;
    fn list_tasks(&self, filter: &TaskFilter) -> DomainResult<Vec<Task>>;
}

pub trait SessionRepository: Send + Sync {
    fn put_session(&self, session: Session) -> DomainResult<()>;
    fn get_session(&self, session_id: &str) -> DomainResult<Option<Session>>;
    fn list_sessions(&self, filter: &SessionFilter) -> DomainResult<Vec<Session>>;
}

pub trait WorktreeRepository: Send + Sync {
    fn put_worktree(&self, worktree: Worktree) -> DomainResult<()>;
    fn get_worktree(&self, worktree_id: &str) -> DomainResult<Option<Worktree>>;
    fn list_worktrees(&self, workspace_id: Option<&str>) -> DomainResult<Vec<Worktree>>;
}

pub trait RunAttemptRepository: Send + Sync {
    fn put_run_attempt(&self, run_attempt: RunAttempt) -> DomainResult<()>;
    fn list_run_attempts(&self, session_id: &str) -> DomainResult<Vec<RunAttempt>>;
}

pub trait PlanRepository: Send + Sync {
    fn put_plan(&self, plan: Plan) -> DomainResult<()>;
    fn get_plan(&self, plan_id: &str) -> DomainResult<Option<Plan>>;
    fn get_active_plan_for_task(&self, task_id: &str) -> DomainResult<Option<Plan>>;
}

pub trait PlanStepRepository: Send + Sync {
    fn put_plan_step(&self, step: PlanStep) -> DomainResult<()>;
    fn list_plan_steps(&self, plan_id: &str) -> DomainResult<Vec<PlanStep>>;
}

pub trait SkillProfileRepository: Send + Sync {
    fn put_skill_profile(&self, profile: SkillProfile) -> DomainResult<()>;
    fn get_skill_profile(&self, skill_profile_id: &str) -> DomainResult<Option<SkillProfile>>;
    fn list_skill_profiles(&self) -> DomainResult<Vec<SkillProfile>>;
}

pub trait ApprovalRepository: Send + Sync {
    fn put_approval_request(&self, request: ApprovalRequest) -> DomainResult<()>;
    fn get_approval_request(
        &self,
        approval_request_id: &str,
    ) -> DomainResult<Option<ApprovalRequest>>;
    fn list_approval_requests(&self, filter: &ApprovalFilter)
        -> DomainResult<Vec<ApprovalRequest>>;
}

pub trait RecoveryBindingRepository: Send + Sync {
    fn put_recovery_binding(&self, binding: RecoveryBinding) -> DomainResult<()>;
    fn get_recovery_binding(&self, session_id: &str) -> DomainResult<Option<RecoveryBinding>>;
}

pub trait AuditEventRepository: Send + Sync {
    fn append_audit_event(&self, event: EventEnvelope) -> DomainResult<()>;
    fn list_audit_events(&self, filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>>;
}

pub trait ArtifactStore: Send + Sync {
    fn artifacts_root(&self) -> String;
    fn write_artifact(&self, relative_path: &str, data: &[u8]) -> DomainResult<String>;
    fn read_artifact(&self, relative_path: &str) -> DomainResult<Vec<u8>>;
}

pub trait StorageIntrospection: Send + Sync {
    fn data_files(&self) -> Vec<String>;
}

pub trait DaemonStore:
    WorkspaceRepository
    + TaskRepository
    + SessionRepository
    + WorktreeRepository
    + RunAttemptRepository
    + PlanRepository
    + PlanStepRepository
    + SkillProfileRepository
    + ApprovalRepository
    + RecoveryBindingRepository
    + ArtifactStore
    + StorageIntrospection
    + Send
    + Sync
{
}

impl<T> DaemonStore for T where
    T: WorkspaceRepository
        + TaskRepository
        + SessionRepository
        + WorktreeRepository
        + RunAttemptRepository
        + PlanRepository
        + PlanStepRepository
        + SkillProfileRepository
        + ApprovalRepository
        + RecoveryBindingRepository
        + ArtifactStore
        + StorageIntrospection
        + Send
        + Sync
{
}

pub trait EventRepository: Send + Sync {
    fn publish_event(&self, event: EventEnvelope) -> DomainResult<()>;
    fn list_events(&self, filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>>;
}

pub trait ProviderAdapter: Send + Sync {
    fn detect(&self, provider: ProviderKind) -> DomainResult<ProviderDetection>;
    fn capabilities(&self, provider: ProviderKind) -> DomainResult<ProviderCapabilities>;

    fn start(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec>;

    fn resume(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec>;

    fn send_input(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        text: &str,
    ) -> DomainResult<()>;

    fn stop(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        reason: Option<&str>,
    ) -> DomainResult<()>;

    fn bind_provider_session(
        &self,
        session: &Session,
        provider_session_id: &str,
    ) -> DomainResult<Option<String>>;

    fn normalize_event(
        &self,
        provider: &str,
        payload: &Value,
    ) -> DomainResult<Vec<NormalizedProviderEvent>>;
}

pub trait ApprovalExecutor: Send + Sync {
    fn execute(
        &self,
        request: &ApprovalRequest,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace: Option<&Workspace>,
    ) -> DomainResult<Option<String>>;
}

pub trait WorktreeHost: Send + Sync {
    fn prepare(
        &self,
        workspace_root: &str,
        session_id: &str,
        strategy: WorktreeStrategy,
    ) -> DomainResult<Option<PreparedWorktree>>;
    fn cleanup(
        &self,
        workspace_root: &str,
        path: &str,
        branch_name: Option<&str>,
    ) -> DomainResult<()>;
}

pub trait RuntimeHost: Send + Sync {
    fn launch(&self, spec: LaunchSpec) -> DomainResult<ProcessHandle>;
    fn send_input(&self, handle_id: &str, text: &str) -> DomainResult<()>;
    fn write_base64(&self, handle_id: &str, data: &str) -> DomainResult<()>;
    fn resize(&self, handle_id: &str, cols: u16, rows: u16) -> DomainResult<()>;
    fn stop(&self, handle_id: &str, reason: Option<&str>) -> DomainResult<()>;
    fn poll_events(&self, handle_id: &str) -> DomainResult<Vec<ProcessEvent>>;
    fn is_handle_alive(&self, handle_id: &str) -> bool;
}
