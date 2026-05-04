use crate::contract_map::{
    map_approval_request_to_contract, map_plan_step_to_contract, map_plan_to_contract,
    map_run_attempt_to_contract, map_session_to_contract, map_task_to_contract,
    map_worktree_to_contract, map_workspace_to_contract,
};
use crate::event_bus::EventBus;
use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use codebar_contracts::mcp as mcp_contract;
use codebar_contracts::rpc as contract_rpc;
use codebar_contracts::workflow as workflow_contract;
use daemon_core::domain::{
    ApprovalRequest, DomainResult, EventEnvelope, Plan, PlanStep, Session, Task, Workspace,
    Worktree,
};
use daemon_core::ports::{
    ApprovalFilter, EventFilter, SessionFilter, TaskFilter, WorkspaceRepository, WorktreeRepository,
};
use storage_sqlite::StorageSqlite;

use daemon_core::services::{
    ApprovalService, BootstrapSessionInput, CreateSessionInput, CreateTaskInput, DiagnosticsService, EventService,
    HealthService, LaunchSessionInput, PlanService, PrepareWorktreeInput, RecoveryCoordinator,
    ResolveApprovalInput, ResumeSessionInput, RuntimeLifecycleInput, SendSessionInputInput,
    SessionService, StopSessionInput, TaskService, UpdateSessionInput, UpdateTaskInput, WorktreeService,
};
use daemon_core::workflow::WorkflowService;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct DaemonRpc {
    pub root: PathBuf,
    pub _store: Arc<StorageSqlite>,
    pub events: Arc<EventBus>,
    pub task_service: TaskService,
    pub session_service: SessionService,
    pub worktree_service: WorktreeService,
    pub plan_service: PlanService,
    pub approval_service: ApprovalService,
    pub event_service: EventService,
    pub diagnostics_service: DiagnosticsService,
    pub health_service: HealthService,
    pub workflow_service: WorkflowService,
    pub recovery: RecoveryCoordinator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcRequest {
    pub id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcResponse {
    pub id: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorEnvelope>,
}

fn rpc_ok(id: Option<String>, result: Value) -> RpcResponse {
    RpcResponse {
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn rpc_err(id: Option<String>, error: ErrorEnvelope) -> RpcResponse {
    RpcResponse {
        id,
        ok: false,
        result: None,
        error: Some(error),
    }
}

impl DaemonRpc {
    pub fn socket_path(&self) -> PathBuf {
        self.root.join("codebard.sock")
    }

    pub fn upsert_workspace(&self, workspace: Workspace) -> DomainResult<()> {
        self._store.put_workspace(workspace)
    }

    pub fn get_workspace(&self, workspace_id: &str) -> DomainResult<Workspace> {
        self._store.get_workspace(workspace_id)?.ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::NotFound,
                format!("workspace {workspace_id} not found"),
                false,
            )
        })
    }

    pub fn list_workspaces(&self) -> DomainResult<Vec<Workspace>> {
        self._store.list_workspaces()
    }

    pub fn create_task(&self, input: CreateTaskInput) -> DomainResult<Task> {
        self.task_service.create_task(input)
    }

    pub fn list_tasks(&self, filter: TaskFilter) -> DomainResult<Vec<Task>> {
        self.task_service.list_tasks(filter)
    }

    pub fn get_task(&self, task_id: &str) -> DomainResult<Task> {
        self.task_service.get_task(task_id)
    }

    pub fn update_task(&self, input: UpdateTaskInput) -> DomainResult<Task> {
        self.task_service.update_task(input)
    }

    pub fn create_session(&self, input: CreateSessionInput) -> DomainResult<Session> {
        self.session_service.create_session(input)
    }

    pub fn get_session(&self, session_id: &str) -> DomainResult<Session> {
        self.session_service.get_session(session_id)
    }

    pub fn update_session(&self, input: UpdateSessionInput) -> DomainResult<Session> {
        self.session_service.update_session(input)
    }

    pub fn bootstrap_session(
        &self,
        input: BootstrapSessionInput,
    ) -> DomainResult<(Session, Worktree)> {
        self.session_service.bootstrap_session(input)
    }

    pub fn list_sessions(&self, filter: SessionFilter) -> DomainResult<Vec<Session>> {
        self.session_service.list_sessions(filter)
    }

    pub fn launch_session(
        &self,
        input: LaunchSessionInput,
    ) -> DomainResult<(Session, daemon_core::domain::RunAttempt)> {
        self.session_service.launch_session(input)
    }

    pub fn resume_session(
        &self,
        input: ResumeSessionInput,
    ) -> DomainResult<(Session, daemon_core::domain::RunAttempt)> {
        self.session_service.resume_session(input)
    }

    pub fn send_session_input(&self, input: SendSessionInputInput) -> DomainResult<bool> {
        self.session_service.send_session_input(input)
    }

    pub fn stop_session(&self, input: StopSessionInput) -> DomainResult<bool> {
        self.session_service.stop_session(input)
    }

    pub fn runtime_write_pty(&self, session_id: &str, data: &str) -> DomainResult<()> {
        self.session_service.runtime_write_base64(session_id, data)
    }

    pub fn runtime_resize_pty(&self, session_id: &str, cols: u16, rows: u16) -> DomainResult<()> {
        self.session_service.runtime_resize(session_id, cols, rows)
    }

    pub fn bind_provider_session(
        &self,
        session_id: &str,
        provider_session_id: &str,
    ) -> DomainResult<Session> {
        self.session_service
            .bind_provider_session(session_id, provider_session_id)
    }

    pub fn forward_provider_hook(&self, provider: &str, payload: Value) -> DomainResult<Value> {
        let events = self
            .session_service
            .apply_provider_events(provider, &payload)?;

        let provider_session_id = events.iter().find_map(|event| match &event.event {
            daemon_core::ports::CanonicalProviderEvent::ProviderSessionBound {
                provider_session_id,
            } => Some(provider_session_id.clone()),
            _ => None,
        });

        Ok(
            serde_json::to_value(contract_rpc::ForwardProviderHookOutput {
                provider_session_id,
            })
            .unwrap(),
        )
    }

    pub fn prepare_worktree(&self, input: PrepareWorktreeInput) -> DomainResult<Worktree> {
        self.worktree_service.prepare_worktree(input)
    }

    pub fn cleanup_worktree(&self, worktree_id: &str) -> DomainResult<bool> {
        self.worktree_service.cleanup_worktree(worktree_id)
    }

    pub fn get_worktree(&self, worktree_id: &str) -> DomainResult<Worktree> {
        self.worktree_service.get_worktree(worktree_id)
    }

    pub fn list_worktrees(&self, workspace_id: Option<&str>) -> DomainResult<Vec<Worktree>> {
        self._store.list_worktrees(workspace_id)
    }

    pub fn get_active_plan(&self, task_id: &str) -> DomainResult<(Option<Plan>, Vec<PlanStep>)> {
        self.plan_service.get_active_plan(task_id)
    }

    pub fn get_next_action(&self, session_id: &str) -> DomainResult<Value> {
        let action = self.plan_service.get_next_action(session_id)?;
        Ok(json!({
            "taskId": action.task_id,
            "step": action.step,
            "mode": action.mode,
            "activeSkills": action.active_skills,
            "recommendedNextCalls": action.recommended_next_calls,
        }))
    }

    pub fn context_get_current(
        &self,
        input: mcp_contract::ContextGetCurrentInput,
    ) -> DomainResult<mcp_contract::ContextGetCurrentOutput> {
        let session = self.session_service.get_session(&input.session_id)?;
        let task = self.task_service.get_task(&session.task_id)?;
        let workspace = self
            ._store
            .get_workspace(&session.workspace_id)?
            .ok_or_else(|| {
                ErrorEnvelope::new(
                    ErrorCode::NotFound,
                    format!("workspace {} not found", session.workspace_id),
                    false,
                )
            })?;
        let worktree = match session.worktree_id.as_deref() {
            Some(worktree_id) => self._store.get_worktree(worktree_id)?,
            None => None,
        };

        Ok(mcp_contract::ContextGetCurrentOutput {
            task: mcp_contract::ContextTaskView {
                id: task.id,
                title: task.title,
                prompt: task.prompt,
                goal: task.goal,
                constraints: task.constraints,
            },
            workspace: mcp_contract::ContextWorkspaceView {
                id: workspace.id,
                root_path: workspace.root_path,
            },
            worktree: worktree.map(|worktree| mcp_contract::ContextWorktreeView {
                id: worktree.id,
                path: worktree.path,
                branch_name: worktree.branch_name,
            }),
            session: mcp_contract::ContextSessionView {
                id: session.id,
                provider: session.provider,
                state: session_state_label(session.state),
            },
        })
    }

    pub fn task_get_next_action(
        &self,
        input: mcp_contract::TaskGetNextActionInput,
    ) -> DomainResult<mcp_contract::TaskGetNextActionOutput> {
        self.workflow_service.get_mcp_next_action(&input.session_id)
    }

    pub fn skill_list_active(
        &self,
        input: mcp_contract::SkillListActiveInput,
    ) -> DomainResult<mcp_contract::SkillListActiveOutput> {
        let session = self.session_service.get_session(&input.session_id)?;
        let mut state = self.workflow_service.load_state_for_rpc()?;
        let resolved = self.workflow_service.resolve_active_skills_for_rpc(
            &mut state,
            &session.id,
            session.current_step_id.as_deref(),
        )?;

        Ok(mcp_contract::SkillListActiveOutput {
            active_skills: resolved.active_skills,
            preferred_skills: resolved.preferred_skills,
            forbidden_skills: resolved.forbidden_skills,
        })
    }

    pub fn skill_invoke(
        &self,
        input: mcp_contract::SkillInvokeInput,
    ) -> DomainResult<mcp_contract::SkillInvokeOutput> {
        let mut state = self.workflow_service.load_state_for_rpc()?;
        let output = self
            .workflow_service
            .invoke_skill_for_rpc(&mut state, input)?;

        Ok(mcp_contract::SkillInvokeOutput {
            summary: output.summary,
            result: output.result,
            artifacts: output.artifacts,
        })
    }

    pub fn get_workflow_snapshot(
        &self,
        input: workflow_contract::GetWorkflowSnapshotRequest,
    ) -> DomainResult<workflow_contract::GetWorkflowSnapshotResponse> {
        self.workflow_service.get_snapshot(input)
    }

    pub fn get_workflow_next_action(
        &self,
        input: workflow_contract::GetWorkflowNextActionRequest,
    ) -> DomainResult<workflow_contract::GetWorkflowNextActionResponse> {
        self.workflow_service.get_next_action(input)
    }

    pub fn claim_workflow_step(
        &self,
        input: workflow_contract::ClaimWorkflowStepRequest,
    ) -> DomainResult<workflow_contract::ClaimWorkflowStepResponse> {
        self.workflow_service.claim_step(input)
    }

    pub fn update_workflow_progress(
        &self,
        input: workflow_contract::UpdateWorkflowProgressRequest,
    ) -> DomainResult<()> {
        self.workflow_service.update_progress(input)
    }

    pub fn complete_workflow_step(
        &self,
        input: workflow_contract::CompleteWorkflowStepRequest,
    ) -> DomainResult<workflow_contract::CompleteWorkflowStepResponse> {
        self.workflow_service.complete_step(input)
    }

    pub fn block_workflow_step(
        &self,
        input: workflow_contract::BlockWorkflowStepRequest,
    ) -> DomainResult<()> {
        self.workflow_service.block_step(input)
    }

    pub fn attach_workflow_session(
        &self,
        input: workflow_contract::AttachWorkflowSessionRequest,
    ) -> DomainResult<workflow_contract::AttachWorkflowSessionResponse> {
        self.workflow_service.attach_session(input)
    }

    pub fn resolve_workflow_approval(
        &self,
        input: workflow_contract::ResolveWorkflowApprovalRequest,
    ) -> DomainResult<workflow_contract::ResolveWorkflowApprovalResponse> {
        let request = self
            .approval_service
            .resolve_request(ResolveApprovalInput {
                approval_request_id: input.approval_id,
                decision: match input.decision.as_str() {
                    "approve" | "approved" => daemon_core::domain::ApprovalStatus::Approved,
                    _ => daemon_core::domain::ApprovalStatus::Rejected,
                },
            })?;
        Ok(workflow_contract::ResolveWorkflowApprovalResponse {
            task_id: request.task_id,
            session_id: Some(request.session_id),
        })
    }

    pub fn list_approval_requests(
        &self,
        filter: ApprovalFilter,
    ) -> DomainResult<Vec<ApprovalRequest>> {
        self.approval_service.list_requests(filter)
    }

    pub fn resolve_approval(&self, input: ResolveApprovalInput) -> DomainResult<ApprovalRequest> {
        self.approval_service.resolve_request(input)
    }

    pub fn list_events(&self, filter: EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        self.event_service.list_events(filter)
    }

    pub fn get_diagnostics(
        &self,
        session_id: Option<&str>,
        task_id: Option<&str>,
    ) -> DomainResult<Value> {
        let diagnostics = self
            .diagnostics_service
            .get_diagnostics(session_id, task_id)?;
        Ok(json!({
            "summary": diagnostics.summary,
            "files": diagnostics.files,
        }))
    }

    pub fn health_check(&self) -> DomainResult<Value> {
        let health = self.health_service.health()?;
        Ok(json!({
            "summary": health.summary,
            "ready": health.ready,
            "pendingApprovals": health.pending_approvals,
            "runningSessions": health.running_sessions,
        }))
    }

    pub fn handle_request(&self, request: RpcRequest) -> RpcResponse {
        let id = request.id.clone();
        let result = match request.method.as_str() {
            "health.check" => self.health_check().and_then(|value| {
                let output = contract_rpc::HealthCheckOutput {
                    summary: value.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    ready: value.get("ready").and_then(|v| v.as_bool()).unwrap_or(false),
                    pending_approvals: value.get("pendingApprovals").and_then(|v| v.as_u64()).unwrap_or_default() as usize,
                    running_sessions: value.get("runningSessions").and_then(|v| v.as_u64()).unwrap_or_default() as usize,
                };
                Ok(serde_json::to_value(output).unwrap())
            }),
            "upsertWorkspace" => parse_params::<contract_rpc::UpsertWorkspaceInput>(request.params).and_then(|input| {
                let workspace = daemon_core::domain::Workspace {
                    id: input.workspace.id,
                    display_name: input.workspace.display_name,
                    root_path: input.workspace.root_path,
                    vcs_type: match input.workspace.vcs_type {
                        codebar_contracts::domain::VcsType::Git => daemon_core::domain::VcsType::Git,
                        codebar_contracts::domain::VcsType::None => daemon_core::domain::VcsType::None,
                    },
                    repo_identity: input.workspace.repo_identity,
                    trust_level: match input.workspace.trust_level {
                        codebar_contracts::domain::TrustLevel::Trusted => daemon_core::domain::TrustLevel::Trusted,
                        codebar_contracts::domain::TrustLevel::Untrusted => daemon_core::domain::TrustLevel::Untrusted,
                    },
                    default_provider: input.workspace.default_provider,
                    created_at: input.workspace.created_at,
                    updated_at: input.workspace.updated_at,
                };
                self.upsert_workspace(workspace).map(|_| serde_json::to_value(contract_rpc::AcceptedOutput { accepted: true }).unwrap())
            }),
            "getWorkspace" => parse_params::<contract_rpc::GetWorkspaceInput>(request.params).and_then(|input| self.get_workspace(&input.workspace_id).map(|workspace| serde_json::to_value(contract_rpc::GetWorkspaceOutput { workspace: map_workspace_to_contract(workspace) }).unwrap())),
            "listWorkspaces" => parse_params_or_default::<contract_rpc::ListWorkspacesInput>(request.params).and_then(|_| self.list_workspaces().map(|workspaces| serde_json::to_value(contract_rpc::ListWorkspacesOutput { workspaces: workspaces.into_iter().map(map_workspace_to_contract).collect::<Vec<_>>() }).unwrap())),
            "createTask" => parse_params::<contract_rpc::CreateTaskInput>(request.params).and_then(|input| self.create_task(CreateTaskInput {
                workspace_id: input.workspace_id,
                title: input.title,
                prompt: input.prompt,
                goal: input.goal,
                constraints: input.constraints,
                requested_provider: input.requested_provider,
            }).map(|task| serde_json::to_value(contract_rpc::CreateTaskOutput { task: map_task_to_contract(task) }).unwrap())),
            "listTasks" => parse_list_tasks_input(request.params).and_then(|filter| self.list_tasks(TaskFilter {
                workspace_id: filter.workspace_id,
                status: filter.status.map(|statuses| statuses.into_iter().map(crate::contract_enum_map::map_task_status_from_contract).collect()),
            }).map(|tasks| serde_json::to_value(contract_rpc::ListTasksOutput { tasks: tasks.into_iter().map(map_task_to_contract).collect::<Vec<_>>() }).unwrap())),
            "getTask" => parse_params::<contract_rpc::GetTaskInput>(request.params).and_then(|input| self.get_task(&input.task_id).map(|task| serde_json::to_value(contract_rpc::GetTaskOutput { task: map_task_to_contract(task) }).unwrap())),
            "updateTask" => parse_params::<contract_rpc::UpdateTaskInput>(request.params).and_then(|input| self.update_task(UpdateTaskInput {
                task_id: input.task_id,
                title: input.title,
                prompt: input.prompt,
                goal: input.goal,
                constraints: input.constraints,
                status: input.status,
            }).map(|task| serde_json::to_value(contract_rpc::UpdateTaskOutput { task: map_task_to_contract(task) }).unwrap())),
            "createSession" => parse_params::<contract_rpc::CreateSessionInput>(request.params).and_then(|input| self.create_session(CreateSessionInput {
                task_id: input.task_id,
                provider: input.provider,
                worktree_strategy: input.worktree_strategy,
            }).map(|session| serde_json::to_value(contract_rpc::CreateSessionOutput { session: map_session_to_contract(session) }).unwrap())),
            "updateSession" => parse_params::<contract_rpc::UpdateSessionInput>(request.params).and_then(|input| self.update_session(UpdateSessionInput {
                session_id: input.session_id,
                provider: input.provider,
            }).map(|session| serde_json::to_value(contract_rpc::UpdateSessionOutput { session: map_session_to_contract(session) }).unwrap())),
            "bootstrapSession" => parse_params::<contract_rpc::BootstrapSessionInput>(request.params).and_then(|input| self.bootstrap_session(BootstrapSessionInput {
                session_id: input.session_id,
                strategy: input.strategy,
            }).map(|(session, worktree)| serde_json::to_value(contract_rpc::BootstrapSessionOutput {
                session: map_session_to_contract(session),
                worktree: map_worktree_to_contract(worktree),
            }).unwrap())),
            "getSession" => parse_params::<contract_rpc::GetSessionInput>(request.params).and_then(|input| self.get_session(&input.session_id).map(|session| serde_json::to_value(contract_rpc::GetSessionOutput { session: map_session_to_contract(session) }).unwrap())),
            "listSessions" => parse_params_or_default::<contract_rpc::ListSessionsInput>(request.params).and_then(|filter| self.list_sessions(SessionFilter {
                task_id: filter.task_id,
                workspace_id: filter.workspace_id,
                session_id: filter.session_id,
            }).map(|sessions| serde_json::to_value(contract_rpc::ListSessionsOutput { sessions: sessions.into_iter().map(map_session_to_contract).collect::<Vec<_>>() }).unwrap())),
            "launchSession" => parse_params::<contract_rpc::LaunchSessionInput>(request.params).and_then(|input| self.launch_session(LaunchSessionInput {
                session_id: input.session_id,
            }).map(|(session, run)| serde_json::to_value(contract_rpc::LaunchSessionOutput { session: map_session_to_contract(session), run: map_run_attempt_to_contract(run) }).unwrap())),
            "resumeSession" => parse_params::<contract_rpc::ResumeSessionInput>(request.params).and_then(|input| self.resume_session(ResumeSessionInput {
                session_id: input.session_id,
            }).map(|(session, run)| serde_json::to_value(contract_rpc::ResumeSessionOutput { session: map_session_to_contract(session), run: map_run_attempt_to_contract(run) }).unwrap())),
            "sendSessionInput" => parse_params::<contract_rpc::SendSessionInputInput>(request.params).and_then(|input| self.send_session_input(SendSessionInputInput {
                session_id: input.session_id,
                text: input.text,
            }).map(|accepted| serde_json::to_value(contract_rpc::AcceptedOutput { accepted }).unwrap())),
            "writePty" => parse_params::<contract_rpc::WritePtyInput>(request.params).and_then(|input| self.runtime_write_pty(&input.session_id, &input.data).map(|_| serde_json::to_value(contract_rpc::AcceptedOutput { accepted: true }).unwrap())),
            "resizePty" => parse_params::<contract_rpc::ResizePtyInput>(request.params).and_then(|input| self.runtime_resize_pty(&input.session_id, input.cols, input.rows).map(|_| serde_json::to_value(contract_rpc::AcceptedOutput { accepted: true }).unwrap())),
            "recordRuntimeLifecycle" => parse_params::<contract_rpc::RecordRuntimeLifecycleInput>(request.params).and_then(|input| self.session_service.record_runtime_lifecycle(RuntimeLifecycleInput {
                session_id: input.session_id,
                event_type: input.event_type,
                message: input.message,
            }).map(|session| serde_json::to_value(contract_rpc::RecordRuntimeLifecycleOutput { session: map_session_to_contract(session) }).unwrap())),
            "bindProviderSession" => parse_params::<contract_rpc::BindProviderSessionInput>(request.params).and_then(|input| {
                self.bind_provider_session(&input.session_id, &input.provider_session_id)
                    .map(|session| serde_json::to_value(contract_rpc::BindProviderSessionOutput { session: map_session_to_contract(session) }).unwrap())
            }),
            "forwardProviderHook" => parse_params::<contract_rpc::ForwardProviderHookInput>(request.params).and_then(|input| self.forward_provider_hook(&input.provider, input.payload).map(|value| {
                serde_json::from_value::<contract_rpc::ForwardProviderHookOutput>(value)
                    .map(|output| serde_json::to_value(output).unwrap())
                    .unwrap()
            })),
            "stopSession" => parse_params::<contract_rpc::StopSessionInput>(request.params).and_then(|input| self.stop_session(StopSessionInput {
                session_id: input.session_id,
                reason: input.reason,
            }).map(|accepted| serde_json::to_value(contract_rpc::AcceptedOutput { accepted }).unwrap())),
            "prepareWorktree" => parse_params::<contract_rpc::PrepareWorktreeInput>(request.params).and_then(|input| self.prepare_worktree(PrepareWorktreeInput {
                session_id: input.session_id,
                strategy: input.strategy,
            }).map(|worktree| serde_json::to_value(contract_rpc::PrepareWorktreeOutput { worktree: map_worktree_to_contract(worktree) }).unwrap())),
            "cleanupWorktree" => get_required_string(&request.params, "worktreeId").and_then(|worktree_id| self.cleanup_worktree(&worktree_id).map(|accepted| json!({ "accepted": accepted }))),
            "getWorktree" => parse_params::<contract_rpc::GetWorktreeInput>(request.params).and_then(|input| self.get_worktree(&input.worktree_id).map(|worktree| serde_json::to_value(contract_rpc::GetWorktreeOutput { worktree: map_worktree_to_contract(worktree) }).unwrap())),
            "listWorktrees" => parse_params_or_default::<contract_rpc::ListWorktreesInput>(request.params).and_then(|input| self.list_worktrees(input.workspace_id.as_deref()).map(|worktrees| serde_json::to_value(contract_rpc::ListWorktreesOutput { worktrees: worktrees.into_iter().map(map_worktree_to_contract).collect::<Vec<_>>() }).unwrap())),
            "getActivePlan" => parse_params::<contract_rpc::GetActivePlanInput>(request.params).and_then(|input| self.get_active_plan(&input.task_id).map(|(plan, steps)| serde_json::to_value(contract_rpc::GetActivePlanOutput { plan: plan.map(map_plan_to_contract), steps: steps.into_iter().map(map_plan_step_to_contract).collect::<Vec<_>>() }).unwrap())),
            "getNextAction" => parse_params::<contract_rpc::GetNextActionInput>(request.params).and_then(|input| self.get_next_action(&input.session_id).map(|value| {
                let output = contract_rpc::GetNextActionOutput {
                    task_id: value.get("taskId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    step: value.get("step").cloned().and_then(|v| serde_json::from_value(v).ok()).map(map_plan_step_to_contract),
                    mode: value.get("mode").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or(codebar_contracts::domain::PlanMode::Open),
                    active_skills: value.get("activeSkills").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default(),
                    recommended_next_calls: value.get("recommendedNextCalls").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default(),
                };
                serde_json::to_value(output).unwrap()
            })),
            "listApprovalRequests" => parse_list_approval_requests_input(request.params).and_then(|filter| self.list_approval_requests(ApprovalFilter {
                session_id: filter.session_id,
                task_id: filter.task_id,
                status: filter.status.map(|statuses| statuses.into_iter().map(|status| match status {
                    contract_rpc::ApprovalStatus::Pending => daemon_core::domain::ApprovalStatus::Pending,
                    contract_rpc::ApprovalStatus::Approved => daemon_core::domain::ApprovalStatus::Approved,
                    contract_rpc::ApprovalStatus::Rejected => daemon_core::domain::ApprovalStatus::Rejected,
                    contract_rpc::ApprovalStatus::Expired => daemon_core::domain::ApprovalStatus::Expired,
                }).collect()),
            }).map(|requests| serde_json::to_value(contract_rpc::ListApprovalRequestsOutput { requests: requests.into_iter().map(map_approval_request_to_contract).collect::<Vec<_>>() }).unwrap())),
            "requestApproval" => parse_params::<contract_rpc::RequestApprovalInput>(request.params).and_then(|input| self.approval_service.create_request(
                &input.session_id,
                match input.action_type {
                    codebar_contracts::domain::ApprovalActionType::Write => daemon_core::domain::ApprovalActionType::Write,
                    codebar_contracts::domain::ApprovalActionType::Delete => daemon_core::domain::ApprovalActionType::Delete,
                    codebar_contracts::domain::ApprovalActionType::GitPush => daemon_core::domain::ApprovalActionType::GitPush,
                    codebar_contracts::domain::ApprovalActionType::DangerousBash => daemon_core::domain::ApprovalActionType::DangerousBash,
                    codebar_contracts::domain::ApprovalActionType::ExternalSideEffect => daemon_core::domain::ApprovalActionType::ExternalSideEffect,
                },
                input.title,
                input.description,
                input.payload
                    .and_then(|value| value.as_object().cloned())
                    .map(|map| map.into_iter().collect())
                    .unwrap_or_default(),
            ).map(|approval| serde_json::to_value(contract_rpc::RequestApprovalOutput { approval: map_approval_request_to_contract(approval) }).unwrap())),
            "resolveApproval" => parse_params::<contract_rpc::ResolveApprovalInput>(request.params).and_then(|input| self.resolve_approval(ResolveApprovalInput {
                approval_request_id: input.approval_request_id,
                decision: match input.decision {
                    contract_rpc::ApprovalDecision::Approved => daemon_core::domain::ApprovalStatus::Approved,
                    contract_rpc::ApprovalDecision::Rejected => daemon_core::domain::ApprovalStatus::Rejected,
                },
            }).map(|request| serde_json::to_value(contract_rpc::ResolveApprovalOutput { request: map_approval_request_to_contract(request) }).unwrap())),
            "listEvents" => parse_list_events_input(request.params).and_then(|filter| self.list_events(EventFilter {
                entity_type: filter.entity_type.map(|entity| format!("{:?}", entity).to_lowercase()),
                entity_id: filter.entity_id,
                since: filter.since,
                limit: filter.limit.map(|limit| limit as usize),
            }).map(|events| serde_json::to_value(contract_rpc::ListEventsOutput { events }).unwrap())),
            "getDiagnostics" => parse_get_diagnostics_input(request.params).and_then(|input| self.get_diagnostics(input.session_id.as_deref(), input.task_id.as_deref()).map(|value| {
                let summary = value.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let files = value.get("files").and_then(|v| v.as_array()).map(|items| items.iter().filter_map(|item| item.as_str().map(ToString::to_string)).collect()).unwrap_or_default();
                serde_json::to_value(contract_rpc::GetDiagnosticsOutput { summary, files }).unwrap()
            })),
            "getWorkflowSnapshot" => parse_params::<workflow_contract::GetWorkflowSnapshotRequest>(request.params).and_then(|input| self.get_workflow_snapshot(input).map(|output| serde_json::to_value(output).unwrap())),
            "getWorkflowNextAction" => parse_params::<workflow_contract::GetWorkflowNextActionRequest>(request.params).and_then(|input| self.get_workflow_next_action(input).map(|output| serde_json::to_value(output).unwrap())),
            "claimWorkflowStep" => parse_params::<workflow_contract::ClaimWorkflowStepRequest>(request.params).and_then(|input| self.claim_workflow_step(input).map(|output| serde_json::to_value(output).unwrap())),
            "updateWorkflowProgress" => parse_params::<workflow_contract::UpdateWorkflowProgressRequest>(request.params).and_then(|input| self.update_workflow_progress(input).map(|_| serde_json::to_value(contract_rpc::AcceptedOutput { accepted: true }).unwrap())),
            "completeWorkflowStep" => parse_params::<workflow_contract::CompleteWorkflowStepRequest>(request.params).and_then(|input| self.complete_workflow_step(input).map(|output| serde_json::to_value(output).unwrap())),
            "blockWorkflowStep" => parse_params::<workflow_contract::BlockWorkflowStepRequest>(request.params).and_then(|input| self.block_workflow_step(input).map(|_| serde_json::to_value(contract_rpc::AcceptedOutput { accepted: true }).unwrap())),
            "attachWorkflowSession" => parse_params::<workflow_contract::AttachWorkflowSessionRequest>(request.params).and_then(|input| self.attach_workflow_session(input).map(|output| serde_json::to_value(output).unwrap())),
            "resolveWorkflowApproval" => parse_params::<workflow_contract::ResolveWorkflowApprovalRequest>(request.params).and_then(|input| self.resolve_workflow_approval(input).map(|output| serde_json::to_value(output).unwrap())),
            "context.get_current" => parse_params::<mcp_contract::ContextGetCurrentInput>(request.params)
                .and_then(|input| self.context_get_current(input).map(|output| serde_json::to_value(output).unwrap())),
            "task.get_next_action" => parse_params::<mcp_contract::TaskGetNextActionInput>(request.params)
                .and_then(|input| self.task_get_next_action(input).map(|output| serde_json::to_value(output).unwrap())),
            "task.update_progress" => parse_params::<mcp_contract::TaskUpdateProgressInput>(request.params).and_then(|input| {
                let step_id = input
                    .step_id
                    .ok_or_else(|| ErrorEnvelope::new(ErrorCode::InvalidArgument, "stepId is required", false))?;
                let details = input.details.and_then(|value| {
                    value
                        .as_object()
                        .map(|map| map.iter().map(|(k, v)| (k.clone(), v.clone())).collect::<BTreeMap<String, Value>>())
                });
                self.update_workflow_progress(workflow_contract::UpdateWorkflowProgressRequest {
                    session_id: input.session_id,
                    step_id,
                    lease_token: input.lease_token,
                    summary: input.summary,
                    details,
                })
                .map(|_| serde_json::to_value(mcp_contract::AcceptedOutput { accepted: true }).unwrap())
            }),
            "task.complete_step" => parse_params::<mcp_contract::TaskCompleteStepInput>(request.params).and_then(|input| {
                let outputs = input.outputs.and_then(|value| {
                    value
                        .as_object()
                        .map(|map| map.iter().map(|(k, v)| (k.clone(), v.clone())).collect::<BTreeMap<String, Value>>())
                });
                self.complete_workflow_step(workflow_contract::CompleteWorkflowStepRequest {
                    session_id: input.session_id,
                    step_id: input.step_id,
                    lease_token: input.lease_token,
                    outputs,
                })
                .map(|output| {
                    serde_json::to_value(mcp_contract::TaskCompleteStepOutput {
                        accepted: true,
                        next_step_id: output.next_step_id,
                    })
                    .unwrap()
                })
            }),
            "task.block_step" => parse_params::<mcp_contract::TaskBlockStepInput>(request.params).and_then(|input| {
                self.block_workflow_step(workflow_contract::BlockWorkflowStepRequest {
                    session_id: input.session_id,
                    step_id: input.step_id,
                    reason: input.reason,
                })
                .map(|_| serde_json::to_value(mcp_contract::AcceptedOutput { accepted: true }).unwrap())
            }),
            "skill.list_active" => parse_params::<mcp_contract::SkillListActiveInput>(request.params)
                .and_then(|input| self.skill_list_active(input).map(|output| serde_json::to_value(output).unwrap())),
            "skill.invoke" => parse_params::<mcp_contract::SkillInvokeInput>(request.params)
                .and_then(|input| self.skill_invoke(input).map(|output| serde_json::to_value(output).unwrap())),
            "session.attach" => parse_params::<mcp_contract::SessionAttachInput>(request.params).and_then(|input| {
                self.attach_workflow_session(workflow_contract::AttachWorkflowSessionRequest {
                    provider: match input.provider {
                        codebar_contracts::domain::ProviderKind::Claude => workflow_contract::TaskDagProvider::ClaudeCode,
                        codebar_contracts::domain::ProviderKind::Codex => workflow_contract::TaskDagProvider::Codex,
                    },
                    session_id: None,
                    provider_session_id: input.provider_session_id,
                    cwd: Some(input.cwd),
                    worktree_path: None,
                    workspace_id: None,
                    workspace_name: None,
                    workspace_path: None,
                    session_name: None,
                    current_task: None,
                    branch_name: None,
                    base_branch: None,
                    session_status: None,
                })
                .map(|output| {
                    let active_step_id = output
                        .document
                        .plan
                        .as_ref()
                        .and_then(|plan| plan.active_step_id.clone());
                    let mode = output
                        .document
                        .plan
                        .as_ref()
                        .map(|plan| match plan.mode.as_str() {
                            "guided" => codebar_contracts::domain::PlanMode::Guided,
                            _ => codebar_contracts::domain::PlanMode::Open,
                        })
                        .unwrap_or(codebar_contracts::domain::PlanMode::Open);
                    serde_json::to_value(mcp_contract::SessionAttachOutput {
                        session_id: output.session_id.unwrap_or_default(),
                        task_id: output.task_id,
                        mode,
                        active_step_id,
                        active_skill_profile_id: None,
                        recommended_next_calls: vec![
                            "context.get_current".to_string(),
                            "task.get_next_action".to_string(),
                        ],
                    })
                    .unwrap()
                })
            }),
            other => Err(ErrorEnvelope::new(
                ErrorCode::NotFound,
                format!("unknown rpc method {other}"),
                false,
            )),
        };

        match result {
            Ok(result) => rpc_ok(id, result),
            Err(error) => rpc_err(id, error),
        }
    }
}

pub async fn serve(daemon: DaemonRpc) -> Result<(), String> {
    #[cfg(unix)]
    {
        use tokio::net::UnixListener;
        let socket_path = daemon.socket_path();
        if let Some(parent) = socket_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if socket_path.exists() {
            let _ = std::fs::remove_file(&socket_path);
        }
        let listener = UnixListener::bind(&socket_path).map_err(|error| error.to_string())?;
        let daemon = Arc::new(daemon);
        loop {
            let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
            let daemon = daemon.clone();
            tokio::spawn(async move {
                let _ = handle_stream(daemon, stream).await;
            });
        }
    }

    #[cfg(not(unix))]
    {
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:46340")
            .await
            .map_err(|error| error.to_string())?;
        let daemon = Arc::new(daemon);
        loop {
            let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
            let daemon = daemon.clone();
            tokio::spawn(async move {
                let _ = handle_stream(daemon, stream).await;
            });
        }
    }
}

#[cfg(unix)]
async fn handle_stream(
    daemon: Arc<DaemonRpc>,
    stream: tokio::net::UnixStream,
) -> Result<(), String> {
    handle_stream_impl(daemon, stream).await
}

#[cfg(not(unix))]
async fn handle_stream(
    daemon: Arc<DaemonRpc>,
    stream: tokio::net::TcpStream,
) -> Result<(), String> {
    handle_stream_impl(daemon, stream).await
}

async fn handle_stream_impl<T>(daemon: Arc<DaemonRpc>, stream: T) -> Result<(), String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    while reader
        .read_line(&mut line)
        .await
        .map_err(|error| error.to_string())?
        > 0
    {
        let request = serde_json::from_str::<RpcRequest>(line.trim_end())
            .map_err(|error| error.to_string())?;
        if request.method == "subscribeEvents" {
            let response = rpc_ok(request.id.clone(), json!({ "subscribed": true }));
            write_response(&mut writer, &response).await?;
            let mut receiver = daemon.events.subscribe();
            loop {
                match receiver.recv().await {
                    Ok(event) => {
                        let message = json!({ "event": event });
                        writer
                            .write_all(format!("{}\n", message).as_bytes())
                            .await
                            .map_err(|error| error.to_string())?;
                    }
                    Err(error) => return Err(error.to_string()),
                }
            }
        }
        let response = daemon.handle_request(request);
        write_response(&mut writer, &response).await?;
        line.clear();
    }

    Ok(())
}

async fn write_response<T>(writer: &mut T, response: &RpcResponse) -> Result<(), String>
where
    T: tokio::io::AsyncWrite + Unpin,
{
    let encoded = serde_json::to_string(response).map_err(|error| error.to_string())?;
    writer
        .write_all(format!("{encoded}\n").as_bytes())
        .await
        .map_err(|error| error.to_string())
}

fn parse_params<T>(params: Value) -> DomainResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(params)
        .map_err(|error| ErrorEnvelope::new(ErrorCode::InvalidArgument, error.to_string(), false))
}

fn parse_params_or_default<T>(params: Value) -> DomainResult<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if params.is_null() {
        Ok(T::default())
    } else {
        parse_params(params)
    }
}

fn parse_list_tasks_input(params: Value) -> DomainResult<contract_rpc::ListTasksInput> {
    if params.is_null() {
        Ok(contract_rpc::ListTasksInput {
            workspace_id: None,
            status: None,
        })
    } else {
        parse_params(params)
    }
}

fn parse_list_approval_requests_input(
    params: Value,
) -> DomainResult<contract_rpc::ListApprovalRequestsInput> {
    if params.is_null() {
        Ok(contract_rpc::ListApprovalRequestsInput {
            session_id: None,
            task_id: None,
            status: None,
        })
    } else {
        parse_params(params)
    }
}

fn parse_list_events_input(params: Value) -> DomainResult<contract_rpc::ListEventsInput> {
    if params.is_null() {
        Ok(contract_rpc::ListEventsInput {
            entity_type: None,
            entity_id: None,
            since: None,
            limit: None,
        })
    } else {
        parse_params(params)
    }
}

fn parse_get_diagnostics_input(params: Value) -> DomainResult<contract_rpc::GetDiagnosticsInput> {
    if params.is_null() {
        Ok(contract_rpc::GetDiagnosticsInput {
            session_id: None,
            task_id: None,
        })
    } else {
        parse_params(params)
    }
}

fn get_required_string(params: &Value, key: &str) -> DomainResult<String> {
    params
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ErrorEnvelope::new(ErrorCode::InvalidArgument, format!("missing {key}"), false)
        })
}

fn session_state_label(state: codebar_contracts::domain::SessionState) -> String {
    match state {
        codebar_contracts::domain::SessionState::Draft => "draft",
        codebar_contracts::domain::SessionState::PreparingWorkspace => "preparing_workspace",
        codebar_contracts::domain::SessionState::PreparingWorktree => "preparing_worktree",
        codebar_contracts::domain::SessionState::Ready => "ready",
        codebar_contracts::domain::SessionState::Launching => "launching",
        codebar_contracts::domain::SessionState::Running => "running",
        codebar_contracts::domain::SessionState::WaitingInput => "waiting_input",
        codebar_contracts::domain::SessionState::ApprovalRequired => "approval_required",
        codebar_contracts::domain::SessionState::Interrupted => "interrupted",
        codebar_contracts::domain::SessionState::Completed => "completed",
        codebar_contracts::domain::SessionState::Failed => "failed",
        codebar_contracts::domain::SessionState::Cancelled => "cancelled",
        codebar_contracts::domain::SessionState::Archived => "archived",
    }
    .to_string()
}

pub async fn read_rpc_response(path: &Path, request: &RpcRequest) -> Result<RpcResponse, String> {
    #[cfg(unix)]
    {
        use tokio::net::UnixStream;
        let mut stream = UnixStream::connect(path)
            .await
            .map_err(|error| error.to_string())?;
        stream
            .write_all(
                format!(
                    "{}\n",
                    serde_json::to_string(request).map_err(|error| error.to_string())?
                )
                .as_bytes(),
            )
            .await
            .map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&line).map_err(|error| error.to_string())
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        Err("read_rpc_response is only implemented for unix in tests".to_string())
    }
}
