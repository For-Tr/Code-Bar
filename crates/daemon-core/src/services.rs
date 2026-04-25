use crate::domain::{
    error_envelope, ApprovalActionType, ApprovalRequest, ApprovalStatus, DomainResult, ErrorCode,
    ErrorEnvelope, EventEntityType, EventEnvelope, EventSource, Plan, PlanStep, ProviderKind,
    RunAttempt, RunLauncherType, RunStatus, Session, SessionLaunchMode, SessionState, Task,
    TaskStatus, Worktree, WorktreeCleanupPolicy, WorktreeLifecycleState, WorktreeSource,
};
use crate::ports::{
    ApprovalExecutor, ApprovalFilter, Clock, DaemonStore, EventFilter, EventRepository,
    IdGenerator, PreparedWorktree, ProviderAdapter, RuntimeHost, RuntimeLaunchResult,
    RuntimeLaunchSpec, SessionFilter, TaskFilter, WorktreeHost, WorktreeStrategy,
};
use crate::queries::{compute_next_action, NextAction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct ServiceContext {
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
    pub store: Arc<dyn DaemonStore>,
    pub events: Arc<dyn EventRepository>,
    pub runtime: Arc<dyn RuntimeHost>,
    pub worktrees: Arc<dyn WorktreeHost>,
    pub provider_adapter: Arc<dyn ProviderAdapter>,
}

impl ServiceContext {
    pub fn emit_event(
        &self,
        entity_type: EventEntityType,
        entity_id: impl Into<String>,
        event_type: impl Into<String>,
        source: EventSource,
        correlation_id: Option<String>,
        payload: HashMap<String, Value>,
    ) -> DomainResult<EventEnvelope> {
        let event = EventEnvelope::new(
            self.ids.next_event_id(),
            entity_type,
            entity_id.into(),
            event_type.into(),
            source,
            correlation_id,
            Value::Object(payload.into_iter().collect()),
            self.clock.now(),
        );
        self.events.publish_event(event.clone())?;
        Ok(event)
    }
}

pub type CreateTaskInput = codebar_contracts::rpc::CreateTaskInput;
pub type UpdateTaskInput = codebar_contracts::rpc::UpdateTaskInput;
pub type CreateSessionInput = codebar_contracts::rpc::CreateSessionInput;
pub type LaunchSessionInput = codebar_contracts::rpc::LaunchSessionInput;
pub type ResumeSessionInput = codebar_contracts::rpc::ResumeSessionInput;
pub type SendSessionInputInput = codebar_contracts::rpc::SendSessionInputInput;
pub type StopSessionInput = codebar_contracts::rpc::StopSessionInput;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLifecycleInput {
    pub session_id: String,
    pub event_type: String,
    pub message: Option<String>,
}

pub type PrepareWorktreeInput = codebar_contracts::rpc::PrepareWorktreeInput;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApprovalInput {
    pub approval_request_id: String,
    pub decision: ApprovalStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSummary {
    pub summary: String,
    pub ready: bool,
    pub pending_approvals: usize,
    pub running_sessions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub summary: String,
    pub files: Vec<String>,
}

pub struct TaskService {
    ctx: ServiceContext,
}

impl TaskService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn create_task(&self, input: CreateTaskInput) -> DomainResult<Task> {
        require_non_empty(&input.workspace_id, "workspace_id")?;
        require_non_empty(&input.title, "title")?;
        require_non_empty(&input.prompt, "prompt")?;

        let now = self.ctx.clock.now();
        let task = Task {
            id: self.ctx.ids.next_task_id(),
            workspace_id: input.workspace_id,
            title: input.title,
            prompt: input.prompt,
            goal: input.goal,
            constraints: input.constraints,
            requested_provider: input.requested_provider.map(|provider| match provider {
                codebar_contracts::domain::ProviderKind::Claude => ProviderKind::Claude,
                codebar_contracts::domain::ProviderKind::Codex => ProviderKind::Codex,
            }),
            requested_model: None,
            status: TaskStatus::Ready,
            active_plan_id: None,
            active_skill_profile_id: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.ctx.store.put_task(task.clone())?;
        self.ctx.emit_event(
            EventEntityType::Task,
            task.id.clone(),
            "task.created",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("task"), json!(task.clone()))]),
        )?;
        Ok(task)
    }

    pub fn list_tasks(&self, filter: TaskFilter) -> DomainResult<Vec<Task>> {
        self.ctx.store.list_tasks(&filter)
    }

    pub fn get_task(&self, task_id: &str) -> DomainResult<Task> {
        self.ctx
            .store
            .get_task(task_id)?
            .ok_or_else(|| not_found("task_not_found", format!("task {task_id} not found")))
    }

    pub fn update_task(&self, input: UpdateTaskInput) -> DomainResult<Task> {
        let mut task = self.get_task(&input.task_id)?;
        if let Some(title) = input.title {
            require_non_empty(&title, "title")?;
            task.title = title;
        }
        if let Some(prompt) = input.prompt {
            require_non_empty(&prompt, "prompt")?;
            task.prompt = prompt;
        }
        if let Some(goal) = input.goal {
            task.goal = Some(goal);
        }
        if let Some(constraints) = input.constraints {
            task.constraints = Some(constraints);
        }
        if let Some(status) = input.status {
            task.status = match status {
                codebar_contracts::domain::TaskStatus::Draft => TaskStatus::Draft,
                codebar_contracts::domain::TaskStatus::Ready => TaskStatus::Ready,
                codebar_contracts::domain::TaskStatus::Active => TaskStatus::Active,
                codebar_contracts::domain::TaskStatus::Blocked => TaskStatus::Blocked,
                codebar_contracts::domain::TaskStatus::Completed => TaskStatus::Completed,
                codebar_contracts::domain::TaskStatus::Failed => TaskStatus::Failed,
                codebar_contracts::domain::TaskStatus::Cancelled => TaskStatus::Cancelled,
                codebar_contracts::domain::TaskStatus::Archived => TaskStatus::Archived,
            };
        }
        task.updated_at = self.ctx.clock.now();
        self.ctx.store.put_task(task.clone())?;
        self.ctx.emit_event(
            EventEntityType::Task,
            task.id.clone(),
            "task.updated",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("task"), json!(task.clone()))]),
        )?;
        Ok(task)
    }
}

pub struct SessionService {
    pub(crate) ctx: ServiceContext,
}

impl SessionService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn create_session(&self, input: CreateSessionInput) -> DomainResult<Session> {
        let task = self
            .ctx
            .store
            .get_task(&input.task_id)?
            .ok_or_else(|| not_found("task_not_found", format!("task {} not found", input.task_id)))?;
        let now = self.ctx.clock.now();
        let session = Session {
            id: self.ctx.ids.next_session_id(),
            task_id: task.id.clone(),
            workspace_id: task.workspace_id.clone(),
            worktree_id: None,
            provider: match input.provider {
                codebar_contracts::domain::ProviderKind::Claude => ProviderKind::Claude,
                codebar_contracts::domain::ProviderKind::Codex => ProviderKind::Codex,
            },
            provider_session_id: None,
            launch_mode: SessionLaunchMode::New,
            state: match input.worktree_strategy {
                codebar_contracts::rpc::WorktreeStrategy::Reuse
                | codebar_contracts::rpc::WorktreeStrategy::NewManaged
                | codebar_contracts::rpc::WorktreeStrategy::Ask => SessionState::PreparingWorktree,
            },
            current_step_id: None,
            last_activity_at: None,
            recovery_note: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.ctx.store.put_session(session.clone())?;

        let mut task = task;
        task.status = TaskStatus::Active;
        task.updated_at = self.ctx.clock.now();
        self.ctx.store.put_task(task.clone())?;

        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            "session.created",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("session"), json!(session.clone()))]),
        )?;
        Ok(session)
    }

    pub fn get_session(&self, session_id: &str) -> DomainResult<Session> {
        self.ctx
            .store
            .get_session(session_id)?
            .ok_or_else(|| not_found("session_not_found", format!("session {session_id} not found")))
    }

    pub fn list_sessions(&self, filter: SessionFilter) -> DomainResult<Vec<Session>> {
        self.ctx.store.list_sessions(&filter)
    }

    pub fn launch_session(&self, input: LaunchSessionInput) -> DomainResult<(Session, RunAttempt)> {
        let mut session = self.get_session(&input.session_id)?;
        ensure_launchable(&session)?;
        let worktree = session
            .worktree_id
            .as_deref()
            .map(|worktree_id| self.ctx.store.get_worktree(worktree_id))
            .transpose()?
            .flatten();
        let launch_result = self.launch_or_resume_runtime(&session, worktree.as_ref(), false)?;
        session.state = SessionState::Running;
        session.launch_mode = SessionLaunchMode::New;
        session.last_activity_at = Some(self.ctx.clock.now());
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        let run_attempt = self.record_run_attempt(&session, launch_result)?;
        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            "session.launched",
            EventSource::Launcher,
            Some(run_attempt.id.clone()),
            HashMap::from([
                (String::from("session"), json!(session.clone())),
                (String::from("run"), json!(run_attempt.clone())),
            ]),
        )?;
        Ok((session, run_attempt))
    }

    pub fn resume_session(&self, input: ResumeSessionInput) -> DomainResult<(Session, RunAttempt)> {
        let mut session = self.get_session(&input.session_id)?;
        if session.provider_session_id.is_none() && session.launch_mode == SessionLaunchMode::Resume {
            return Err(error_envelope(ErrorCode::InvalidArgument, "cannot resume without providerSessionId", false));
        }
        let worktree = session
            .worktree_id
            .as_deref()
            .map(|worktree_id| self.ctx.store.get_worktree(worktree_id))
            .transpose()?
            .flatten();
        let launch_result = self.launch_or_resume_runtime(&session, worktree.as_ref(), true)?;
        session.state = SessionState::Running;
        session.launch_mode = SessionLaunchMode::Resume;
        session.last_activity_at = Some(self.ctx.clock.now());
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        let run_attempt = self.record_run_attempt(&session, launch_result)?;
        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            "session.resumed",
            EventSource::Launcher,
            Some(run_attempt.id.clone()),
            HashMap::from([
                (String::from("session"), json!(session.clone())),
                (String::from("run"), json!(run_attempt.clone())),
            ]),
        )?;
        Ok((session, run_attempt))
    }

    pub fn send_session_input(&self, input: SendSessionInputInput) -> DomainResult<bool> {
        let mut session = self.get_session(&input.session_id)?;
        if !matches!(session.state, SessionState::Running | SessionState::WaitingInput) {
            return Err(error_envelope(ErrorCode::InvalidArgument, "session must be running or waiting_input to accept input", false));
        }
        self.ctx.runtime.send_input(&session.id, &input.text)?;
        session.state = SessionState::Running;
        session.last_activity_at = Some(self.ctx.clock.now());
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            "session.input_sent",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("text"), json!(input.text))]),
        )?;
        Ok(true)
    }

    pub fn stop_session(&self, input: StopSessionInput) -> DomainResult<bool> {
        let mut session = self.get_session(&input.session_id)?;
        self.ctx.runtime.stop(&session.id, input.reason.as_deref())?;
        session.state = SessionState::Cancelled;
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            "session.stopped",
            EventSource::Launcher,
            None,
            HashMap::from([(String::from("reason"), json!(input.reason))]),
        )?;
        Ok(true)
    }

    pub fn record_runtime_lifecycle(&self, input: RuntimeLifecycleInput) -> DomainResult<Session> {
        let mut session = self.get_session(&input.session_id)?;
        let event_type = input.event_type.trim();
        match event_type {
            "running" => {
                session.state = SessionState::Running;
            }
            "waiting" => {
                session.state = SessionState::WaitingInput;
            }
            "error" => {
                session.state = SessionState::Failed;
            }
            "exit" => {
                session.state = SessionState::Completed;
            }
            other => {
                return Err(error_envelope(ErrorCode::InvalidArgument, format!("unknown runtime event {other}"), false));
            }
        }
        session.last_activity_at = Some(self.ctx.clock.now());
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        self.ctx.emit_event(
            EventEntityType::Session,
            session.id.clone(),
            format!("session.runtime_{event_type}"),
            EventSource::Launcher,
            None,
            HashMap::from([(String::from("message"), json!(input.message))]),
        )?;
        Ok(session)
    }

    pub fn runtime_write_base64(&self, session_id: &str, data: &str) -> DomainResult<()> {
        self.ctx.runtime.write_base64(session_id, data)
    }

    pub fn runtime_resize(&self, session_id: &str, cols: u16, rows: u16) -> DomainResult<()> {
        self.ctx.runtime.resize(session_id, cols, rows)
    }

    pub fn bind_provider_session(
        &self,
        session_id: &str,
        provider_session_id: &str,
    ) -> DomainResult<Session> {
        let mut session = self.get_session(session_id)?;
        if let Some(bound) = self
            .ctx
            .provider_adapter
            .bind_provider_session(&session, provider_session_id)?
        {
            session.provider_session_id = Some(bound);
            session.updated_at = self.ctx.clock.now();
            self.ctx.store.put_session(session.clone())?;
            self.ctx.emit_event(
                EventEntityType::Session,
                session.id.clone(),
                "session.provider_bound",
                EventSource::Provider,
                None,
                HashMap::from([(String::from("providerSessionId"), json!(session.provider_session_id.clone()))]),
            )?;
        }
        Ok(session)
    }

    fn launch_or_resume_runtime(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        resume: bool,
    ) -> DomainResult<RuntimeLaunchResult> {
        let cwd = worktree
            .map(|worktree| worktree.path.clone())
            .unwrap_or_else(|| session.workspace_id.clone());
        let spec = RuntimeLaunchSpec {
            session_id: session.id.clone(),
            provider: session.provider.clone(),
            launcher_type: RunLauncherType::Pty,
            command: match session.provider {
                ProviderKind::Claude => "claude".to_string(),
                ProviderKind::Codex => "codex".to_string(),
            },
            args: if resume {
                session
                    .provider_session_id
                    .clone()
                    .map(|provider_session_id| vec!["resume".to_string(), provider_session_id])
                    .unwrap_or_default()
            } else {
                Vec::new()
            },
            cwd,
            provider_session_id: session.provider_session_id.clone(),
        };
        if resume {
            self.ctx.runtime.resume(spec)
        } else {
            self.ctx.runtime.launch(spec)
        }
    }

    fn record_run_attempt(
        &self,
        session: &Session,
        launch_result: RuntimeLaunchResult,
    ) -> DomainResult<RunAttempt> {
        let existing = self.ctx.store.list_run_attempts(&session.id)?;
        let run_attempt = RunAttempt {
            id: self.ctx.ids.next_run_attempt_id(),
            session_id: session.id.clone(),
            attempt_no: existing.len() as u32 + 1,
            launcher_type: launch_result.launcher_type,
            command: launch_result.command,
            args: launch_result.args,
            cwd: launch_result.cwd,
            pid: launch_result.pid,
            started_at: Some(self.ctx.clock.now()),
            ended_at: None,
            exit_reason: None,
            status: RunStatus::Running,
            continuity_token: Some(format!("run:{}:{}", session.id, existing.len() as u32 + 1)),
            continuity_state: Some("live".to_string()),
        };
        self.ctx.store.put_run_attempt(run_attempt.clone())?;
        Ok(run_attempt)
    }
}

pub struct WorktreeService {
    ctx: ServiceContext,
}

impl WorktreeService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn prepare_worktree(&self, input: PrepareWorktreeInput) -> DomainResult<Worktree> {
        let mut session = self
            .ctx
            .store
            .get_session(&input.session_id)?
            .ok_or_else(|| not_found("session_not_found", format!("session {} not found", input.session_id)))?;
        let workspace = self
            .ctx
            .store
            .get_workspace(&session.workspace_id)?
            .ok_or_else(|| not_found("workspace_not_found", format!("workspace {} not found", session.workspace_id)))?;

        let prepared = self
            .ctx
            .worktrees
            .prepare(
                &workspace.root_path,
                &session.id,
                match input.strategy {
                    codebar_contracts::rpc::WorktreeStrategy::Reuse => WorktreeStrategy::Reuse,
                    codebar_contracts::rpc::WorktreeStrategy::NewManaged => WorktreeStrategy::NewManaged,
                    codebar_contracts::rpc::WorktreeStrategy::Ask => WorktreeStrategy::Ask,
                },
            )?;

        let now = self.ctx.clock.now();
        let worktree = match prepared {
            Some(PreparedWorktree {
                path,
                branch_name,
                base_branch,
            }) => Worktree {
                id: self.ctx.ids.next_worktree_id(),
                workspace_id: workspace.id,
                path,
                branch_name,
                base_branch,
                source: WorktreeSource::Managed,
                lifecycle_state: WorktreeLifecycleState::Ready,
                cleanup_policy: WorktreeCleanupPolicy::Manual,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            None => Worktree {
                id: self.ctx.ids.next_worktree_id(),
                workspace_id: workspace.id,
                path: workspace.root_path,
                branch_name: None,
                base_branch: None,
                source: WorktreeSource::Existing,
                lifecycle_state: WorktreeLifecycleState::Ready,
                cleanup_policy: WorktreeCleanupPolicy::Manual,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        };

        self.ctx.store.put_worktree(worktree.clone())?;
        session.worktree_id = Some(worktree.id.clone());
        session.state = SessionState::Ready;
        session.updated_at = now;
        self.ctx.store.put_session(session.clone())?;
        self.ctx.emit_event(
            EventEntityType::Worktree,
            worktree.id.clone(),
            "worktree.prepared",
            EventSource::Daemon,
            None,
            HashMap::from([
                (String::from("worktree"), json!(worktree.clone())),
                (String::from("sessionId"), json!(session.id.clone())),
            ]),
        )?;
        Ok(worktree)
    }

    pub fn get_worktree(&self, worktree_id: &str) -> DomainResult<Worktree> {
        self.ctx
            .store
            .get_worktree(worktree_id)?
            .ok_or_else(|| not_found("worktree_not_found", format!("worktree {worktree_id} not found")))
    }

    pub fn cleanup_worktree(&self, worktree_id: &str) -> DomainResult<bool> {
        let mut worktree = self.get_worktree(worktree_id)?;
        let workspace = self
            .ctx
            .store
            .get_workspace(&worktree.workspace_id)?
            .ok_or_else(|| not_found("workspace_not_found", format!("workspace {} not found", worktree.workspace_id)))?;
        self.ctx.worktrees.cleanup(
            &workspace.root_path,
            &worktree.path,
            worktree.branch_name.as_deref(),
        )?;
        worktree.lifecycle_state = WorktreeLifecycleState::Removed;
        worktree.updated_at = self.ctx.clock.now();
        self.ctx.store.put_worktree(worktree.clone())?;
        self.ctx.emit_event(
            EventEntityType::Worktree,
            worktree.id.clone(),
            "worktree.cleaned_up",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("worktree"), json!(worktree.clone()))]),
        )?;
        Ok(true)
    }
}

pub struct PlanService {
    ctx: ServiceContext,
}

impl PlanService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn get_active_plan(&self, task_id: &str) -> DomainResult<(Option<Plan>, Vec<PlanStep>)> {
        let plan = self.ctx.store.get_active_plan_for_task(task_id)?;
        let steps = match &plan {
            Some(plan) => self.ctx.store.list_plan_steps(&plan.id)?,
            None => Vec::new(),
        };
        Ok((plan, steps))
    }

    pub fn get_next_action(&self, session_id: &str) -> DomainResult<NextAction> {
        let session = self
            .ctx
            .store
            .get_session(session_id)?
            .ok_or_else(|| not_found("session_not_found", format!("session {session_id} not found")))?;
        let task = self
            .ctx
            .store
            .get_task(&session.task_id)?
            .ok_or_else(|| not_found("task_not_found", format!("task {} not found", session.task_id)))?;
        Ok(compute_next_action(&task, &session, self.ctx.store.as_ref()))
    }
}

pub struct ApprovalService {
    ctx: ServiceContext,
    executor: Arc<dyn ApprovalExecutor>,
}

impl ApprovalService {
    pub fn new(ctx: ServiceContext, executor: Arc<dyn ApprovalExecutor>) -> Self {
        Self { ctx, executor }
    }

    pub fn create_request(
        &self,
        session_id: &str,
        action_type: ApprovalActionType,
        title: String,
        description: String,
        payload: HashMap<String, Value>,
    ) -> DomainResult<ApprovalRequest> {
        let mut session = self
            .ctx
            .store
            .get_session(session_id)?
            .ok_or_else(|| not_found("session_not_found", format!("session {session_id} not found")))?;
        let request = ApprovalRequest {
            id: self.ctx.ids.next_approval_request_id(),
            session_id: session.id.clone(),
            task_id: session.task_id.clone(),
            action_type,
            title,
            description,
            payload,
            status: ApprovalStatus::Pending,
            created_at: self.ctx.clock.now(),
            resolved_at: None,
        };
        self.ctx.store.put_approval_request(request.clone())?;
        session.state = SessionState::ApprovalRequired;
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session)?;
        self.ctx.emit_event(
            EventEntityType::Approval,
            request.id.clone(),
            "approval.requested",
            EventSource::Daemon,
            None,
            HashMap::from([(String::from("approval"), json!(request.clone()))]),
        )?;
        Ok(request)
    }

    pub fn list_requests(&self, filter: ApprovalFilter) -> DomainResult<Vec<ApprovalRequest>> {
        self.ctx.store.list_approval_requests(&filter)
    }

    pub fn resolve_request(&self, input: ResolveApprovalInput) -> DomainResult<ApprovalRequest> {
        if !matches!(input.decision, ApprovalStatus::Approved | ApprovalStatus::Rejected) {
            return Err(error_envelope(ErrorCode::InvalidArgument, "approval decision must be approved or rejected", false));
        }
        let mut request = self
            .ctx
            .store
            .get_approval_request(&input.approval_request_id)?
            .ok_or_else(|| {
                not_found(
                    "approval_not_found",
                    format!("approval {} not found", input.approval_request_id),
                )
            })?;
        request.status = input.decision;
        request.resolved_at = Some(self.ctx.clock.now());
        self.ctx.store.put_approval_request(request.clone())?;
        let mut session = self
            .ctx
            .store
            .get_session(&request.session_id)?
            .ok_or_else(|| not_found("session_not_found", format!("session {} not found", request.session_id)))?;
        let worktree = session
            .worktree_id
            .as_deref()
            .map(|worktree_id| self.ctx.store.get_worktree(worktree_id))
            .transpose()?
            .flatten();
        let workspace = self.ctx.store.get_workspace(&session.workspace_id)?;
        let execution_message = if matches!(request.status, ApprovalStatus::Approved) {
            self.executor.execute(&request, &session, worktree.as_ref(), workspace.as_ref())?
        } else {
            None
        };
        session.state = match request.status {
            ApprovalStatus::Approved => SessionState::WaitingInput,
            ApprovalStatus::Rejected => SessionState::Interrupted,
            ApprovalStatus::Pending | ApprovalStatus::Expired => SessionState::ApprovalRequired,
        };
        session.updated_at = self.ctx.clock.now();
        self.ctx.store.put_session(session.clone())?;
        let mut payload = HashMap::from([(String::from("approval"), json!(request.clone()))]);
        if let Some(message) = execution_message {
            payload.insert(String::from("execution"), json!({ "status": "executed", "message": message }));
        }
        self.ctx.emit_event(
            EventEntityType::Approval,
            request.id.clone(),
            "approval.resolved",
            EventSource::Daemon,
            None,
            payload,
        )?;
        Ok(request)
    }
}

pub struct EventService {
    ctx: ServiceContext,
}

impl EventService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn list_events(&self, filter: EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        self.ctx.events.list_events(&filter)
    }
}

pub struct RecoveryCoordinator {
    ctx: ServiceContext,
}

impl RecoveryCoordinator {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn recover(&self) -> DomainResult<Vec<Session>> {
        let mut recovered = Vec::new();
        for mut session in self.ctx.store.list_sessions(&SessionFilter::default())? {
            if matches!(session.state, SessionState::Running | SessionState::Launching)
                && !self.ctx.runtime.is_session_alive(&session.id)
            {
                session.state = SessionState::Interrupted;
                let last_run = self.ctx.store.list_run_attempts(&session.id)?
                    .into_iter()
                    .max_by_key(|run| run.attempt_no);
                session.recovery_note = Some(match last_run {
                    Some(run) => format!(
                        "runtime missing during recovery; last continuity token {} state {}",
                        run.continuity_token.unwrap_or_else(|| "unknown".to_string()),
                        run.continuity_state.unwrap_or_else(|| "unknown".to_string())
                    ),
                    None => "runtime missing during recovery; marked interrupted".to_string(),
                });
                session.updated_at = self.ctx.clock.now();
                self.ctx.store.put_session(session.clone())?;
                self.ctx.emit_event(
                    EventEntityType::Session,
                    session.id.clone(),
                    "session.recovered",
                    EventSource::Daemon,
                    None,
                    HashMap::from([
                        (String::from("session"), json!(session.clone())),
                        (String::from("recovery"), json!({ "reason": "runtime_missing", "interrupted": true })),
                    ]),
                )?;
                recovered.push(session);
            }
        }
        Ok(recovered)
    }
}

pub struct DiagnosticsService {
    ctx: ServiceContext,
}

impl DiagnosticsService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn get_diagnostics(&self, session_id: Option<&str>, task_id: Option<&str>) -> DomainResult<DiagnosticsSummary> {
        let pending_approvals = self
            .ctx
            .store
            .list_approval_requests(&ApprovalFilter {
                session_id: session_id.map(ToString::to_string),
                task_id: task_id.map(ToString::to_string),
                status: Some(vec![ApprovalStatus::Pending]),
            })?
            .len();
        let events = self
            .ctx
            .events
            .list_events(&EventFilter {
                entity_id: session_id.map(ToString::to_string).or_else(|| task_id.map(ToString::to_string)),
                limit: Some(20),
                ..EventFilter::default()
            })?;
        let recovery_summary = session_id
            .and_then(|session_id| self.ctx.store.get_session(session_id).ok().flatten())
            .and_then(|session| session.recovery_note)
            .unwrap_or_default();
        let summary = if recovery_summary.is_empty() {
            format!(
                "{} pending approvals, {} recent events",
                pending_approvals,
                events.len()
            )
        } else {
            format!(
                "{} pending approvals, {} recent events, recovery: {}",
                pending_approvals,
                events.len(),
                recovery_summary
            )
        };
        Ok(DiagnosticsSummary {
            summary,
            files: self.ctx.store.data_files(),
        })
    }
}

pub struct HealthService {
    ctx: ServiceContext,
}

impl HealthService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self { ctx }
    }

    pub fn health(&self) -> DomainResult<HealthSummary> {
        let pending_approvals = self
            .ctx
            .store
            .list_approval_requests(&ApprovalFilter {
                status: Some(vec![ApprovalStatus::Pending]),
                ..ApprovalFilter::default()
            })?
            .len();
        let running_sessions = self
            .ctx
            .store
            .list_sessions(&SessionFilter::default())?
            .into_iter()
            .filter(|session| matches!(session.state, SessionState::Running | SessionState::Launching))
            .count();
        Ok(HealthSummary {
            summary: format!(
                "ready: {} running sessions, {} pending approvals",
                running_sessions, pending_approvals
            ),
            ready: true,
            pending_approvals,
            running_sessions,
        })
    }
}

fn ensure_launchable(session: &Session) -> DomainResult<()> {
    if !matches!(
        session.state,
        SessionState::Ready | SessionState::Interrupted | SessionState::WaitingInput
    ) {
        return Err(error_envelope(
            ErrorCode::InvalidArgument,
            "session must be ready, interrupted, or waiting_input before launch",
            false,
        ));
    }
    Ok(())
}

fn require_non_empty(value: &str, field: &str) -> DomainResult<()> {
    if value.trim().is_empty() {
        return Err(error_envelope(ErrorCode::InvalidArgument, format!("{field} cannot be empty"), false));
    }
    Ok(())
}

fn not_found(_code: impl Into<String>, message: impl Into<String>) -> ErrorEnvelope {
    error_envelope(ErrorCode::NotFound, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{PlanMode, PlanStatus, ProviderKind, TrustLevel, VcsType, Workspace};
    use crate::ports::{
        EventRepository, EventFilter, IdGenerator, RuntimeHost, RuntimeLaunchResult,
        RuntimeLaunchSpec, WorktreeHost,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct TestClock;
    impl Clock for TestClock {
        fn now(&self) -> String {
            "2026-04-23T00:00:00Z".to_string()
        }
    }

    #[derive(Default)]
    struct TestIds {
        counter: Mutex<u64>,
    }
    impl TestIds {
        fn next(&self, prefix: &str) -> String {
            let mut counter = self.counter.lock().unwrap();
            *counter += 1;
            format!("{prefix}-{}", *counter)
        }
    }
    impl IdGenerator for TestIds {
        fn next_task_id(&self) -> String { self.next("task") }
        fn next_session_id(&self) -> String { self.next("session") }
        fn next_worktree_id(&self) -> String { self.next("worktree") }
        fn next_run_attempt_id(&self) -> String { self.next("run") }
        fn next_plan_id(&self) -> String { self.next("plan") }
        fn next_plan_step_id(&self) -> String { self.next("step") }
        fn next_skill_profile_id(&self) -> String { self.next("skill") }
        fn next_approval_request_id(&self) -> String { self.next("approval") }
        fn next_event_id(&self) -> String { self.next("event") }
    }

    #[derive(Default)]
    struct TestStore {
        workspaces: Mutex<HashMap<String, Workspace>>,
        tasks: Mutex<HashMap<String, Task>>,
        sessions: Mutex<HashMap<String, Session>>,
        worktrees: Mutex<HashMap<String, Worktree>>,
        run_attempts: Mutex<Vec<RunAttempt>>,
        plans: Mutex<HashMap<String, Plan>>,
        plan_steps: Mutex<HashMap<String, Vec<PlanStep>>>,
        approvals: Mutex<HashMap<String, ApprovalRequest>>,
        skills: Mutex<HashMap<String, crate::domain::SkillProfile>>,
    }

    impl crate::ports::WorkspaceRepository for TestStore {
        fn put_workspace(&self, workspace: Workspace) -> DomainResult<()> {
            self.workspaces.lock().unwrap().insert(workspace.id.clone(), workspace); Ok(())
        }
        fn get_workspace(&self, workspace_id: &str) -> DomainResult<Option<Workspace>> {
            Ok(self.workspaces.lock().unwrap().get(workspace_id).cloned())
        }
        fn list_workspaces(&self) -> DomainResult<Vec<Workspace>> {
            Ok(self.workspaces.lock().unwrap().values().cloned().collect())
        }
    }
    impl crate::ports::TaskRepository for TestStore {
        fn put_task(&self, task: Task) -> DomainResult<()> {
            self.tasks.lock().unwrap().insert(task.id.clone(), task); Ok(())
        }
        fn get_task(&self, task_id: &str) -> DomainResult<Option<Task>> {
            Ok(self.tasks.lock().unwrap().get(task_id).cloned())
        }
        fn list_tasks(&self, _filter: &TaskFilter) -> DomainResult<Vec<Task>> {
            Ok(self.tasks.lock().unwrap().values().cloned().collect())
        }
    }
    impl crate::ports::SessionRepository for TestStore {
        fn put_session(&self, session: Session) -> DomainResult<()> {
            self.sessions.lock().unwrap().insert(session.id.clone(), session); Ok(())
        }
        fn get_session(&self, session_id: &str) -> DomainResult<Option<Session>> {
            Ok(self.sessions.lock().unwrap().get(session_id).cloned())
        }
        fn list_sessions(&self, _filter: &SessionFilter) -> DomainResult<Vec<Session>> {
            Ok(self.sessions.lock().unwrap().values().cloned().collect())
        }
    }
    impl crate::ports::WorktreeRepository for TestStore {
        fn put_worktree(&self, worktree: Worktree) -> DomainResult<()> {
            self.worktrees.lock().unwrap().insert(worktree.id.clone(), worktree); Ok(())
        }
        fn get_worktree(&self, worktree_id: &str) -> DomainResult<Option<Worktree>> {
            Ok(self.worktrees.lock().unwrap().get(worktree_id).cloned())
        }
        fn list_worktrees(&self, _workspace_id: Option<&str>) -> DomainResult<Vec<Worktree>> {
            Ok(self.worktrees.lock().unwrap().values().cloned().collect())
        }
    }
    impl crate::ports::RunAttemptRepository for TestStore {
        fn put_run_attempt(&self, run_attempt: RunAttempt) -> DomainResult<()> {
            self.run_attempts.lock().unwrap().push(run_attempt); Ok(())
        }
        fn list_run_attempts(&self, session_id: &str) -> DomainResult<Vec<RunAttempt>> {
            Ok(self.run_attempts.lock().unwrap().iter().filter(|run| run.session_id == session_id).cloned().collect())
        }
    }
    impl crate::ports::PlanRepository for TestStore {
        fn put_plan(&self, plan: Plan) -> DomainResult<()> {
            self.plans.lock().unwrap().insert(plan.id.clone(), plan); Ok(())
        }
        fn get_plan(&self, plan_id: &str) -> DomainResult<Option<Plan>> {
            Ok(self.plans.lock().unwrap().get(plan_id).cloned())
        }
        fn get_active_plan_for_task(&self, task_id: &str) -> DomainResult<Option<Plan>> {
            Ok(self.plans.lock().unwrap().values().find(|plan| plan.task_id == task_id && matches!(plan.status, PlanStatus::Active)).cloned())
        }
        fn put_plan_step(&self, step: PlanStep) -> DomainResult<()> {
            self.plan_steps.lock().unwrap().entry(step.plan_id.clone()).or_default().push(step); Ok(())
        }
        fn list_plan_steps(&self, plan_id: &str) -> DomainResult<Vec<PlanStep>> {
            Ok(self.plan_steps.lock().unwrap().get(plan_id).cloned().unwrap_or_default())
        }
    }
    impl crate::ports::SkillProfileRepository for TestStore {
        fn put_skill_profile(&self, profile: crate::domain::SkillProfile) -> DomainResult<()> {
            self.skills.lock().unwrap().insert(profile.id.clone(), profile); Ok(())
        }
        fn get_skill_profile(&self, skill_profile_id: &str) -> DomainResult<Option<crate::domain::SkillProfile>> {
            Ok(self.skills.lock().unwrap().get(skill_profile_id).cloned())
        }
    }
    impl crate::ports::ApprovalRepository for TestStore {
        fn put_approval_request(&self, request: ApprovalRequest) -> DomainResult<()> {
            self.approvals.lock().unwrap().insert(request.id.clone(), request); Ok(())
        }
        fn get_approval_request(&self, approval_request_id: &str) -> DomainResult<Option<ApprovalRequest>> {
            Ok(self.approvals.lock().unwrap().get(approval_request_id).cloned())
        }
        fn list_approval_requests(&self, filter: &ApprovalFilter) -> DomainResult<Vec<ApprovalRequest>> {
            Ok(self.approvals.lock().unwrap().values().filter(|approval| {
                filter.session_id.as_ref().map(|id| &approval.session_id == id).unwrap_or(true)
                    && filter.task_id.as_ref().map(|id| &approval.task_id == id).unwrap_or(true)
                    && filter.status.as_ref().map(|statuses| statuses.contains(&approval.status)).unwrap_or(true)
            }).cloned().collect())
        }
    }
    impl crate::ports::StorageIntrospection for TestStore {
        fn data_files(&self) -> Vec<String> { vec!["memory://store".to_string()] }
    }

    #[derive(Default)]
    struct TestEvents {
        events: Mutex<Vec<EventEnvelope>>,
    }
    impl EventRepository for TestEvents {
        fn publish_event(&self, event: EventEnvelope) -> DomainResult<()> {
            self.events.lock().unwrap().push(event); Ok(())
        }
        fn list_events(&self, _filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>> {
            Ok(self.events.lock().unwrap().clone())
        }
    }

    struct TestRuntime;
    impl RuntimeHost for TestRuntime {
        fn launch(&self, spec: RuntimeLaunchSpec) -> DomainResult<RuntimeLaunchResult> {
            Ok(RuntimeLaunchResult { launcher_type: spec.launcher_type, command: spec.command, args: spec.args, cwd: spec.cwd, pid: Some(42) })
        }
        fn resume(&self, spec: RuntimeLaunchSpec) -> DomainResult<RuntimeLaunchResult> {
            Ok(RuntimeLaunchResult { launcher_type: spec.launcher_type, command: spec.command, args: spec.args, cwd: spec.cwd, pid: Some(43) })
        }
        fn send_input(&self, _session_id: &str, _text: &str) -> DomainResult<()> { Ok(()) }
        fn write_base64(&self, _session_id: &str, _data: &str) -> DomainResult<()> { Ok(()) }
        fn resize(&self, _session_id: &str, _cols: u16, _rows: u16) -> DomainResult<()> { Ok(()) }
        fn stop(&self, _session_id: &str, _reason: Option<&str>) -> DomainResult<()> { Ok(()) }
        fn is_session_alive(&self, _session_id: &str) -> bool { false }
    }

    struct TestWorktreeHost;
    impl WorktreeHost for TestWorktreeHost {
        fn prepare(&self, workspace_root: &str, session_id: &str, strategy: WorktreeStrategy) -> DomainResult<Option<PreparedWorktree>> {
            match strategy {
                WorktreeStrategy::Reuse => Ok(None),
                WorktreeStrategy::NewManaged | WorktreeStrategy::Ask => Ok(Some(PreparedWorktree {
                    path: format!("{workspace_root}/.code-bar-worktrees/{session_id}"),
                    branch_name: Some(format!("ci/test/session-{session_id}")),
                    base_branch: Some("main".to_string()),
                })),
            }
        }
        fn cleanup(&self, _workspace_root: &str, _path: &str, _branch_name: Option<&str>) -> DomainResult<()> { Ok(()) }
    }

    struct TestProviderAdapter;
    impl ProviderAdapter for TestProviderAdapter {
        fn bind_provider_session(&self, session: &Session, provider_session_id: &str) -> DomainResult<Option<String>> {
            if session.provider_session_id.as_deref() == Some(provider_session_id) {
                Ok(None)
            } else {
                Ok(Some(provider_session_id.to_string()))
            }
        }
    }

    fn test_context() -> ServiceContext {
        let store: Arc<dyn DaemonStore> = Arc::new(TestStore::default());
        store.put_workspace(Workspace {
            id: "ws-1".to_string(),
            display_name: "Workspace".to_string(),
            root_path: "/tmp/workspace".to_string(),
            vcs_type: VcsType::Git,
            repo_identity: Some("repo".to_string()),
            trust_level: TrustLevel::Trusted,
            default_provider: Some(ProviderKind::Claude),
            created_at: "2026-04-23T00:00:00Z".to_string(),
            updated_at: "2026-04-23T00:00:00Z".to_string(),
        }).unwrap();
        ServiceContext {
            clock: Arc::new(TestClock),
            ids: Arc::new(TestIds::default()),
            store,
            events: Arc::new(TestEvents::default()),
            runtime: Arc::new(TestRuntime),
            worktrees: Arc::new(TestWorktreeHost),
            provider_adapter: Arc::new(TestProviderAdapter),
        }
    }

    #[test]
    fn lifecycle_requires_worktree_before_launch() {
        let ctx = test_context();
        let task_service = TaskService::new(ctx.clone());
        let session_service = SessionService::new(ctx.clone());

        let task = task_service.create_task(CreateTaskInput {
            workspace_id: "ws-1".to_string(),
            title: "T".to_string(),
            prompt: "P".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        }).unwrap();
        let session = session_service.create_session(CreateSessionInput {
            task_id: task.id,
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();

        let err = session_service.launch_session(LaunchSessionInput { session_id: session.id }).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArgument);
    }

    #[test]
    fn full_lifecycle_and_next_action() {
        let ctx = test_context();
        let task_service = TaskService::new(ctx.clone());
        let session_service = SessionService::new(ctx.clone());
        let worktree_service = WorktreeService::new(ctx.clone());
        let plan_service = PlanService::new(ctx.clone());

        let task = task_service.create_task(CreateTaskInput {
            workspace_id: "ws-1".to_string(),
            title: "Build daemon".to_string(),
            prompt: "Implement daemon".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        }).unwrap();
        let session = session_service.create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        let next_action_before = plan_service.get_next_action(&session.id).unwrap();
        assert_eq!(next_action_before.recommended_next_calls, vec!["prepareWorktree"]);

        let worktree = worktree_service.prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        assert!(matches!(worktree.source, WorktreeSource::Managed));

        let (launched_session, run) = session_service.launch_session(LaunchSessionInput {
            session_id: session.id.clone(),
        }).unwrap();
        assert!(matches!(launched_session.state, SessionState::Running));
        assert_eq!(run.attempt_no, 1);
        assert_eq!(run.continuity_state.as_deref(), Some("live"));
        assert!(run.continuity_token.as_deref().unwrap_or_default().contains(&session.id));

        let next_action_after = plan_service.get_next_action(&session.id).unwrap();
        assert_eq!(next_action_after.recommended_next_calls, vec!["sendSessionInput", "stopSession"]);
    }

    #[test]
    fn approval_interrupts_and_resolves_session() {
        let ctx = test_context();
        let task_service = TaskService::new(ctx.clone());
        let session_service = SessionService::new(ctx.clone());
        let worktree_service = WorktreeService::new(ctx.clone());
        let approval_service = ApprovalService::new(ctx.clone(), Arc::new(crate::null_approval_executor::NullApprovalExecutor));

        let task = task_service.create_task(CreateTaskInput {
            workspace_id: "ws-1".to_string(),
            title: "Need approval".to_string(),
            prompt: "Push code".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        }).unwrap();
        let session = session_service.create_session(CreateSessionInput {
            task_id: task.id,
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        worktree_service.prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        session_service.launch_session(LaunchSessionInput {
            session_id: session.id.clone(),
        }).unwrap();

        let request = approval_service.create_request(
            &session.id,
            ApprovalActionType::GitPush,
            "Push?".to_string(),
            "Needs approval".to_string(),
            HashMap::new(),
        ).unwrap();
        let approval_session = session_service.get_session(&session.id).unwrap();
        assert!(matches!(approval_session.state, SessionState::ApprovalRequired));

        let resolved = approval_service.resolve_request(ResolveApprovalInput {
            approval_request_id: request.id,
            decision: ApprovalStatus::Approved,
        }).unwrap();
        assert!(matches!(resolved.status, ApprovalStatus::Approved));
        let updated_session = session_service.get_session(&session.id).unwrap();
        assert!(matches!(updated_session.state, SessionState::WaitingInput));
    }

    #[test]
    fn recovery_marks_running_sessions_interrupted_when_runtime_missing() {
        let ctx = test_context();
        let task_service = TaskService::new(ctx.clone());
        let session_service = SessionService::new(ctx.clone());
        let worktree_service = WorktreeService::new(ctx.clone());
        let recovery = RecoveryCoordinator::new(ctx.clone());

        let task = task_service.create_task(CreateTaskInput {
            workspace_id: "ws-1".to_string(),
            title: "Recover".to_string(),
            prompt: "Resume later".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        }).unwrap();
        let session = session_service.create_session(CreateSessionInput {
            task_id: task.id,
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        worktree_service.prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        }).unwrap();
        session_service.launch_session(LaunchSessionInput {
            session_id: session.id.clone(),
        }).unwrap();

        let recovered = recovery.recover().unwrap();
        assert_eq!(recovered.len(), 1);
        assert!(matches!(recovered[0].state, SessionState::Interrupted));
        assert!(recovered[0].recovery_note.as_deref().unwrap_or_default().contains("continuity token"));
    }

    #[test]
    fn active_plan_is_returned_with_steps() {
        let ctx = test_context();
        let task_service = TaskService::new(ctx.clone());
        let plan_service = PlanService::new(ctx.clone());
        let task = task_service.create_task(CreateTaskInput {
            workspace_id: "ws-1".to_string(),
            title: "Plan task".to_string(),
            prompt: "Prompt".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        }).unwrap();
        let plan = Plan {
            id: "plan-1".to_string(),
            task_id: task.id.clone(),
            mode: PlanMode::Guided,
            status: PlanStatus::Active,
            created_at: "2026-04-23T00:00:00Z".to_string(),
            updated_at: "2026-04-23T00:00:00Z".to_string(),
        };
        ctx.store.put_plan(plan.clone()).unwrap();
        ctx.store.put_plan_step(PlanStep {
            id: "step-1".to_string(),
            plan_id: plan.id.clone(),
            title: "Step".to_string(),
            description: Some("Desc".to_string()),
            status: crate::domain::PlanStepStatus::Pending,
            depends_on: vec![],
            parallelizable: false,
            required_skills: vec![],
            allowed_providers: None,
            lease_owner_session_id: None,
            lease_token: None,
            lease_expires_at: None,
            created_at: "2026-04-23T00:00:00Z".to_string(),
            updated_at: "2026-04-23T00:00:00Z".to_string(),
        }).unwrap();
        let (active_plan, steps) = plan_service.get_active_plan(&task.id).unwrap();
        assert_eq!(active_plan.unwrap().id, plan.id);
        assert_eq!(steps.len(), 1);
    }

    #[test]
    fn diagnostics_and_health_report_counts() {
        let ctx = test_context();
        let diagnostics = DiagnosticsService::new(ctx.clone());
        let health = HealthService::new(ctx.clone());
        let result = diagnostics.get_diagnostics(None, None).unwrap();
        assert_eq!(result.files, vec!["memory://store"]);
        let health_summary = health.health().unwrap();
        assert!(health_summary.ready);
        assert_eq!(health_summary.pending_approvals, 0);
    }
}
