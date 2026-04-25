use crate::contract_map::{
    map_approval_request_to_contract, map_plan_step_to_contract, map_plan_to_contract,
    map_run_attempt_to_contract, map_session_to_contract, map_task_to_contract,
    map_worktree_to_contract,
};
use crate::event_bus::EventBus;
use crate::provider_adapter::{NormalizedProviderEvent, RealProviderAdapter};
use crate::storage::FileStore;
use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use codebar_contracts::rpc as contract_rpc;
use daemon_core::domain::{
    ApprovalActionType, ApprovalRequest, DomainResult, EventEnvelope, Plan,
    PlanStep, Session, Task, Worktree, Workspace,
};
use daemon_core::ports::{ApprovalFilter, EventFilter, EventRepository, SessionFilter, TaskFilter, WorkspaceRepository};
use daemon_core::services::{
    ApprovalService, CreateSessionInput, CreateTaskInput, DiagnosticsService, EventService,
    HealthService, LaunchSessionInput, PlanService, PrepareWorktreeInput, RecoveryCoordinator,
    ResolveApprovalInput, ResumeSessionInput, RuntimeLifecycleInput, SendSessionInputInput,
    SessionService, StopSessionInput, TaskService, UpdateTaskInput, WorktreeService,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct DaemonRpc {
    pub root: PathBuf,
    pub _store: Arc<FileStore>,
    pub events: Arc<EventBus>,
    pub task_service: TaskService,
    pub session_service: SessionService,
    pub worktree_service: WorktreeService,
    pub plan_service: PlanService,
    pub approval_service: ApprovalService,
    pub event_service: EventService,
    pub diagnostics_service: DiagnosticsService,
    pub health_service: HealthService,
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

    pub fn list_sessions(&self, filter: SessionFilter) -> DomainResult<Vec<Session>> {
        self.session_service.list_sessions(filter)
    }

    pub fn launch_session(&self, input: LaunchSessionInput) -> DomainResult<(Session, daemon_core::domain::RunAttempt)> {
        self.session_service.launch_session(input)
    }

    pub fn resume_session(&self, input: ResumeSessionInput) -> DomainResult<(Session, daemon_core::domain::RunAttempt)> {
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

    pub fn bind_provider_session(&self, session_id: &str, provider_session_id: &str) -> DomainResult<Session> {
        self.session_service.bind_provider_session(session_id, provider_session_id)
    }

    pub fn forward_provider_hook(&self, provider: &str, payload: Value) -> DomainResult<Value> {
        let provider_session_id = RealProviderAdapter::extract_provider_session_id(provider, &payload);
        let events = RealProviderAdapter::normalize_hook_events(provider, &payload);
        for event in &events {
            self.emit_normalized_provider_event(event);
        }
        Ok(json!({
            "providerSessionId": provider_session_id,
        }))
    }

    fn emit_normalized_provider_event(&self, event: &NormalizedProviderEvent) {
        let _ = self.events.publish_event(EventEnvelope {
            id: format!("provider-event-{}-{}", self.root.display(), event.event_type),
            entity_type: daemon_core::domain::EventEntityType::Session,
            entity_id: event.session_id.clone().unwrap_or_default(),
            event_type: event.event_type.clone(),
            source: daemon_core::domain::EventSource::Provider,
            correlation_id: None,
            payload: event.payload.clone().into_iter().collect(),
            created_at: "provider".to_string(),
        });
    }

    pub fn prepare_worktree(&self, input: PrepareWorktreeInput) -> DomainResult<Worktree> {
        self.worktree_service.prepare_worktree(input)
    }

    pub fn cleanup_worktree(&self, worktree_id: &str) -> DomainResult<bool> {
        self.worktree_service.cleanup_worktree(worktree_id)
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

    pub fn list_approval_requests(&self, filter: ApprovalFilter) -> DomainResult<Vec<ApprovalRequest>> {
        self.approval_service.list_requests(filter)
    }

    pub fn resolve_approval(&self, input: ResolveApprovalInput) -> DomainResult<ApprovalRequest> {
        self.approval_service.resolve_request(input)
    }

    pub fn list_events(&self, filter: EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        self.event_service.list_events(filter)
    }

    pub fn get_diagnostics(&self, session_id: Option<&str>, task_id: Option<&str>) -> DomainResult<Value> {
        let diagnostics = self.diagnostics_service.get_diagnostics(session_id, task_id)?;
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
            "health.check" => self.health_check(),
            "upsertWorkspace" => parse_workspace_params(request.params).and_then(|workspace| self.upsert_workspace(workspace).map(|_| json!({ "accepted": true }))),
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
            "getSession" => get_required_string(&request.params, "sessionId").and_then(|session_id| self.get_session(&session_id).map(|session| json!({ "session": map_session_to_contract(session) }))),
            "listSessions" => parse_params_or_default::<SessionFilter>(request.params).and_then(|filter| self.list_sessions(filter).map(|sessions| json!({ "sessions": sessions.into_iter().map(map_session_to_contract).collect::<Vec<_>>() }))),
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
            "writePty" => parse_write_pty_params(request.params).and_then(|(session_id, data)| self.runtime_write_pty(&session_id, &data).map(|_| json!({ "accepted": true }))),
            "resizePty" => parse_resize_pty_params(request.params).and_then(|(session_id, cols, rows)| self.runtime_resize_pty(&session_id, cols, rows).map(|_| json!({ "accepted": true }))),
            "recordRuntimeLifecycle" => parse_params::<RuntimeLifecycleInput>(request.params).and_then(|input| self.session_service.record_runtime_lifecycle(input).map(|session| json!({ "session": map_session_to_contract(session) }))),
            "bindProviderSession" => parse_bind_provider_params(request.params).and_then(|(session_id, provider_session_id)| {
                self.bind_provider_session(&session_id, &provider_session_id)
                    .map(|session| json!({ "session": map_session_to_contract(session) }))
            }),
            "forwardProviderHook" => parse_provider_hook_params(request.params).and_then(|(provider, payload)| self.forward_provider_hook(&provider, payload)),
            "stopSession" => parse_params::<contract_rpc::StopSessionInput>(request.params).and_then(|input| self.stop_session(StopSessionInput {
                session_id: input.session_id,
                reason: input.reason,
            }).map(|accepted| serde_json::to_value(contract_rpc::AcceptedOutput { accepted }).unwrap())),
            "prepareWorktree" => parse_params::<contract_rpc::PrepareWorktreeInput>(request.params).and_then(|input| self.prepare_worktree(PrepareWorktreeInput {
                session_id: input.session_id,
                strategy: input.strategy,
            }).map(|worktree| serde_json::to_value(contract_rpc::PrepareWorktreeOutput { worktree: map_worktree_to_contract(worktree) }).unwrap())),
            "cleanupWorktree" => get_required_string(&request.params, "worktreeId").and_then(|worktree_id| self.cleanup_worktree(&worktree_id).map(|accepted| json!({ "accepted": accepted }))),
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
            "requestApproval" => parse_approval_request_params(request.params).and_then(|input| self.approval_service.create_request(&input.session_id, input.action_type, input.title, input.description, input.payload).map(|approval| json!({ "approval": approval }))),
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
async fn handle_stream(daemon: Arc<DaemonRpc>, stream: tokio::net::UnixStream) -> Result<(), String> {
    handle_stream_impl(daemon, stream).await
}

#[cfg(not(unix))]
async fn handle_stream(daemon: Arc<DaemonRpc>, stream: tokio::net::TcpStream) -> Result<(), String> {
    handle_stream_impl(daemon, stream).await
}

async fn handle_stream_impl<T>(daemon: Arc<DaemonRpc>, stream: T) -> Result<(), String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    while reader.read_line(&mut line).await.map_err(|error| error.to_string())? > 0 {
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
    if params.is_null() { Ok(contract_rpc::ListTasksInput { workspace_id: None, status: None }) } else { parse_params(params) }
}

fn parse_list_approval_requests_input(params: Value) -> DomainResult<contract_rpc::ListApprovalRequestsInput> {
    if params.is_null() { Ok(contract_rpc::ListApprovalRequestsInput { session_id: None, task_id: None, status: None }) } else { parse_params(params) }
}

fn parse_list_events_input(params: Value) -> DomainResult<contract_rpc::ListEventsInput> {
    if params.is_null() { Ok(contract_rpc::ListEventsInput { entity_type: None, entity_id: None, since: None, limit: None }) } else { parse_params(params) }
}

fn parse_get_diagnostics_input(params: Value) -> DomainResult<contract_rpc::GetDiagnosticsInput> {
    if params.is_null() { Ok(contract_rpc::GetDiagnosticsInput { session_id: None, task_id: None }) } else { parse_params(params) }
}

fn get_required_string(params: &Value, key: &str) -> DomainResult<String> {
    params
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ErrorEnvelope::new(ErrorCode::InvalidArgument, format!("missing {key}"), false))
}

fn parse_bind_provider_params(params: Value) -> DomainResult<(String, String)> {
    let session_id = get_required_string(&params, "sessionId")?;
    let provider_session_id = get_required_string(&params, "providerSessionId")?;
    Ok((session_id, provider_session_id))
}

fn parse_workspace_params(params: Value) -> DomainResult<Workspace> {
    let workspace = params
        .get("workspace")
        .cloned()
        .unwrap_or(params);
    serde_json::from_value(workspace)
        .map_err(|error| ErrorEnvelope::new(ErrorCode::InvalidArgument, error.to_string(), false))
}

fn parse_write_pty_params(params: Value) -> DomainResult<(String, String)> {
    let session_id = get_required_string(&params, "sessionId")?;
    let data = get_required_string(&params, "data")?;
    Ok((session_id, data))
}

fn parse_resize_pty_params(params: Value) -> DomainResult<(String, u16, u16)> {
    let session_id = get_required_string(&params, "sessionId")?;
    let cols = params
        .get("cols")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| ErrorEnvelope::new(ErrorCode::InvalidArgument, "missing cols", false))? as u16;
    let rows = params
        .get("rows")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| ErrorEnvelope::new(ErrorCode::InvalidArgument, "missing rows", false))? as u16;
    Ok((session_id, cols, rows))
}

fn parse_provider_hook_params(params: Value) -> DomainResult<(String, Value)> {
    let provider = get_required_string(&params, "provider")?;
    let payload = params.get("payload").cloned().unwrap_or(Value::Null);
    Ok((provider, payload))
}

struct ApprovalRequestParams {
    session_id: String,
    action_type: ApprovalActionType,
    title: String,
    description: String,
    payload: std::collections::HashMap<String, Value>,
}

fn parse_approval_request_params(params: Value) -> DomainResult<ApprovalRequestParams> {
    let session_id = get_required_string(&params, "sessionId")?;
    let title = get_required_string(&params, "title")?;
    let description = get_required_string(&params, "description")?;
    let action_type = match get_required_string(&params, "actionType")?.as_str() {
        "write" => ApprovalActionType::Write,
        "delete" => ApprovalActionType::Delete,
        "git_push" => ApprovalActionType::GitPush,
        "dangerous_bash" => ApprovalActionType::DangerousBash,
        "external_side_effect" => ApprovalActionType::ExternalSideEffect,
        other => return Err(ErrorEnvelope::new(ErrorCode::InvalidArgument, format!("unknown actionType {other}"), false)),
    };
    let payload = params
        .get("payload")
        .and_then(|value| value.as_object())
        .cloned()
        .map(|map| map.into_iter().collect())
        .unwrap_or_default();
    Ok(ApprovalRequestParams {
        session_id,
        action_type,
        title,
        description,
        payload,
    })
}

pub async fn read_rpc_response(path: &Path, request: &RpcRequest) -> Result<RpcResponse, String> {
    #[cfg(unix)]
    {
        use tokio::net::UnixStream;
        let mut stream = UnixStream::connect(path).await.map_err(|error| error.to_string())?;
        stream
            .write_all(format!("{}\n", serde_json::to_string(request).map_err(|error| error.to_string())?).as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.map_err(|error| error.to_string())?;
        serde_json::from_str(&line).map_err(|error| error.to_string())
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        Err("read_rpc_response is only implemented for unix in tests".to_string())
    }
}
