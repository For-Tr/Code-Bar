use std::cmp::max;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use codebar_contracts::workflow::{
    AttachWorkflowSessionRequest, BlockWorkflowStepRequest, ClaimWorkflowStepRequest,
    ClaimWorkflowStepResponse, CompleteWorkflowStepRequest, GetWorkflowSnapshotRequest,
    GetWorkflowSnapshotResponse, ResolveWorkflowApprovalRequest, TaskDagApprovalGateNode,
    TaskDagApprovalRequest, TaskDagApprovalStatus, TaskDagCapabilities, TaskDagDiagnostic,
    TaskDagDiagnosticSeverity, TaskDagDocument, TaskDagEdge, TaskDagEdgeKind, TaskDagEvent,
    TaskDagEventLevel, TaskDagNextAction, TaskDagNode, TaskDagNodeKind, TaskDagPlan,
    TaskDagProvider, TaskDagSession, TaskDagSessionState, TaskDagStepNode, TaskDagStepRuntime,
    TaskDagStepStatus, TaskDagTask, TaskDagTaskRootNode, UpdateWorkflowProgressRequest,
    WorkflowMetadata,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use task_orchestrator::{
    ApprovalActionType, ApprovalRequest, ApprovalStatus, CleanupPolicy, Engine, EventEnvelope,
    EventEntityType, EventSource, NextActionView, OrchestrationState, PlanMode, PlanStatus,
    PlanStep, PlanStepStatus, Provider, Session, SessionAttachmentInput, SessionLaunchMode,
    SessionState, Task, TaskStatus, Worktree, WorktreeLifecycleState, WorktreeSource, Workspace,
};

static REVISION_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct OrchestrationRuntime {
    engine: Engine,
    state: Arc<Mutex<OrchestrationState>>,
    revision: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSnapshotUpdatedEvent {
    pub task_id: String,
    pub session_id: Option<String>,
    pub revision: String,
    pub document: TaskDagDocument,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEventsUpdatedEvent {
    pub task_id: String,
    pub session_id: Option<String>,
    pub revision: String,
    pub events: Vec<TaskDagEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDiagnosticsUpdatedEvent {
    pub task_id: String,
    pub session_id: Option<String>,
    pub revision: String,
    pub diagnostics: Vec<TaskDagDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNextActionResponse {
    pub task_id: String,
    pub next_action: TaskDagNextAction,
}

impl Default for OrchestrationRuntime {
    fn default() -> Self {
        Self {
            engine: Engine::default(),
            state: Arc::new(Mutex::new(OrchestrationState::default())),
            revision: AtomicU64::new(REVISION_COUNTER.fetch_add(1, Ordering::SeqCst)),
        }
    }
}

impl OrchestrationRuntime {
    fn next_revision(&self) -> String {
        let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        format!("rev-{revision}")
    }

    fn current_revision(&self) -> String {
        format!("rev-{}", self.revision.load(Ordering::SeqCst))
    }

    fn snapshot_for(
        &self,
        task_id: &str,
        session_id: Option<&str>,
    ) -> Result<GetWorkflowSnapshotResponse, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        project_snapshot(&state, task_id, session_id, self.current_revision())
    }
}

#[tauri::command]
pub fn orchestration_get_workflow_snapshot(
    runtime: State<'_, OrchestrationRuntime>,
    input: GetWorkflowSnapshotRequest,
) -> Result<GetWorkflowSnapshotResponse, String> {
    runtime.snapshot_for(&input.task_id, input.session_id.as_deref())
}

#[tauri::command]
pub fn orchestration_list_task_events(
    runtime: State<'_, OrchestrationRuntime>,
    task_id: String,
) -> Result<Vec<TaskDagEvent>, String> {
    Ok(runtime.snapshot_for(&task_id, None)?.events)
}

#[tauri::command]
pub fn orchestration_get_session_next_action(
    runtime: State<'_, OrchestrationRuntime>,
    session_id: String,
) -> Result<WorkflowNextActionResponse, String> {
    let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
    let next = runtime
        .engine
        .get_next_action(&mut state, &session_id, &now_ts())
        .map_err(|e| e.to_string())?;
    Ok(WorkflowNextActionResponse {
        task_id: next.task_id.clone(),
        next_action: map_next_action(&next),
    })
}

#[tauri::command]
pub fn orchestration_claim_step(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: ClaimWorkflowStepRequest,
) -> Result<ClaimWorkflowStepResponse, String> {
    let (task_id, response) = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        let claimed = runtime
            .engine
            .claim_step(&mut state, &input.session_id, input.step_id.as_deref(), &now_ts())
            .map_err(|e| e.to_string())?;
        let task_id = state
            .sessions
            .get(&input.session_id)
            .map(|session| session.task_id.clone())
            .ok_or_else(|| "session not found".to_string())?;
        (
            task_id,
            ClaimWorkflowStepResponse {
                step_id: claimed.step_id,
                lease_token: claimed.lease_token,
                lease_expires_at: claimed.lease_expires_at,
            },
        )
    };
    emit_snapshot_events(&app, &runtime, &task_id, Some(input.session_id.as_str()))?;
    Ok(response)
}

#[tauri::command]
pub fn orchestration_update_step_progress(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: UpdateWorkflowProgressRequest,
) -> Result<(), String> {
    let task_id = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        runtime
            .engine
            .update_progress(
                &mut state,
                &input.session_id,
                &input.step_id,
                input.lease_token.as_deref(),
                &input.summary,
                input.details.as_ref(),
                &now_ts(),
            )
            .map_err(|e| e.to_string())?;
        state
            .sessions
            .get(&input.session_id)
            .map(|session| session.task_id.clone())
            .ok_or_else(|| "session not found".to_string())?
    };
    emit_snapshot_events(&app, &runtime, &task_id, Some(input.session_id.as_str()))
}

#[tauri::command]
pub fn orchestration_complete_step(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: CompleteWorkflowStepRequest,
) -> Result<(), String> {
    let task_id = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        runtime
            .engine
            .complete_step(
                &mut state,
                &input.session_id,
                &input.step_id,
                input.lease_token.as_deref(),
                input.outputs.as_ref(),
                &now_ts(),
            )
            .map_err(|e| e.to_string())?;
        state
            .sessions
            .get(&input.session_id)
            .map(|session| session.task_id.clone())
            .ok_or_else(|| "session not found".to_string())?
    };
    emit_snapshot_events(&app, &runtime, &task_id, Some(input.session_id.as_str()))
}

#[tauri::command]
pub fn orchestration_block_step(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: BlockWorkflowStepRequest,
) -> Result<(), String> {
    let task_id = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        runtime
            .engine
            .block_step(
                &mut state,
                &input.session_id,
                &input.step_id,
                &input.reason,
                &now_ts(),
            )
            .map_err(|e| e.to_string())?;
        state
            .sessions
            .get(&input.session_id)
            .map(|session| session.task_id.clone())
            .ok_or_else(|| "session not found".to_string())?
    };
    emit_snapshot_events(&app, &runtime, &task_id, Some(input.session_id.as_str()))
}

#[tauri::command]
pub fn orchestration_attach_session(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: AttachWorkflowSessionRequest,
) -> Result<WorkflowSnapshotUpdatedEvent, String> {
    let (task_id, session_id) = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        let task_id = sync_desktop_session_into_orchestrator(&mut state, &input)?;
        let attachment = runtime
            .engine
            .attach_session(
                &mut state,
                &SessionAttachmentInput {
                    provider: map_provider_from_contract(input.provider.clone()),
                    session_id: input.session_id.clone(),
                    provider_session_id: input.provider_session_id.clone(),
                    cwd: input.cwd.clone(),
                    worktree_path: input.worktree_path.clone(),
                },
                &now_ts(),
            )
            .map_err(|e| e.to_string())?;
        (task_id, Some(attachment.session_id))
    };
    emit_snapshot_events(&app, &runtime, &task_id, session_id.as_deref())?;
    let snapshot = runtime.snapshot_for(&task_id, session_id.as_deref())?;
    Ok(WorkflowSnapshotUpdatedEvent {
        task_id,
        session_id,
        revision: snapshot.document.revision.clone(),
        document: snapshot.document,
    })
}

#[tauri::command]
pub fn orchestration_resolve_approval(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    input: ResolveWorkflowApprovalRequest,
) -> Result<(), String> {
    let task_id = {
        let mut state = runtime.state.lock().map_err(|e| e.to_string())?;
        let approval = state
            .approvals
            .get_mut(&input.approval_id)
            .ok_or_else(|| "approval not found".to_string())?;
        approval.status = match input.decision.as_str() {
            "approve" | "approved" => ApprovalStatus::Approved,
            _ => ApprovalStatus::Rejected,
        };
        approval.resolved_at = Some(now_ts());
        approval.task_id.clone()
    };
    emit_snapshot_events(&app, &runtime, &task_id, input.session_id.as_deref())
}

fn sync_desktop_session_into_orchestrator(
    state: &mut OrchestrationState,
    input: &AttachWorkflowSessionRequest,
) -> Result<String, String> {
    let session_id = input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "sessionId is required for workflow attach".to_string())?;
    let workspace_id = input
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "workspaceId is required for workflow attach".to_string())?;
    let workspace_path = input
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "workspacePath is required for workflow attach".to_string())?;

    let task_id = format!("task-{session_id}");
    let worktree_id = input
        .worktree_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|_| format!("worktree-{session_id}"));
    let now = now_ts();

    state.workspaces.insert(
        workspace_id.to_string(),
        Workspace {
            id: workspace_id.to_string(),
            display_name: input
                .workspace_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| workspace_path.rsplit('/').next().unwrap_or(workspace_id).to_string()),
            root_path: workspace_path.to_string(),
            vcs_type: task_orchestrator::VcsType::Git,
            repo_identity: None,
            trust_level: task_orchestrator::TrustLevel::Trusted,
            default_provider: Some(map_provider_from_contract(input.provider.clone())),
            created_at: now.clone(),
            updated_at: now.clone(),
        },
    );

    if let (Some(worktree_id), Some(worktree_path)) = (
        worktree_id.as_ref(),
        input
            .worktree_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        state.worktrees.insert(
            worktree_id.clone(),
            Worktree {
                id: worktree_id.clone(),
                workspace_id: workspace_id.to_string(),
                path: worktree_path.to_string(),
                branch_name: input.branch_name.clone(),
                base_branch: input.base_branch.clone(),
                source: WorktreeSource::Managed,
                lifecycle_state: WorktreeLifecycleState::Ready,
                cleanup_policy: CleanupPolicy::Manual,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );
    }

    let task_status = map_session_status_to_task_status(input.session_status.as_deref());
    state.tasks.insert(
        task_id.clone(),
        Task {
            id: task_id.clone(),
            workspace_id: workspace_id.to_string(),
            title: input
                .session_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| format!("Session {session_id}")),
            prompt: input
                .current_task
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| input.session_name.clone())
                .unwrap_or_else(|| format!("Session {session_id}")),
            goal: None,
            constraints: None,
            requested_provider: Some(map_provider_from_contract(input.provider.clone())),
            requested_model: None,
            status: task_status,
            active_plan_id: None,
            active_skill_profile_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        },
    );

    state.sessions.insert(
        session_id.to_string(),
        Session {
            id: session_id.to_string(),
            task_id: task_id.clone(),
            workspace_id: workspace_id.to_string(),
            worktree_id: worktree_id.clone(),
            provider: map_provider_from_contract(input.provider.clone()),
            provider_session_id: input.provider_session_id.clone(),
            launch_mode: SessionLaunchMode::Resume,
            state: map_session_status_to_orchestrator_state(input.session_status.as_deref()),
            current_step_id: None,
            last_activity_at: Some(now.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        },
    );

    ensure_task_attach_event(state, &task_id, session_id, &now, input.provider_session_id.clone());
    Ok(task_id)
}

fn ensure_task_attach_event(
    state: &mut OrchestrationState,
    task_id: &str,
    session_id: &str,
    now: &str,
    provider_session_id: Option<String>,
) {
    if state.events.iter().any(|event| {
        event.event_type == "task.attached"
            && event.entity_id == session_id
            && event
                .payload
                .get("taskId")
                .and_then(|value| value.as_str())
                == Some(task_id)
    }) {
        return;
    }

    state.events.push(EventEnvelope {
        id: format!("event-attach-{session_id}-{now}"),
        entity_type: EventEntityType::Session,
        entity_id: session_id.to_string(),
        event_type: "task.attached".into(),
        source: EventSource::Daemon,
        correlation_id: None,
        payload: BTreeMap::from([
            ("taskId".into(), Value::String(task_id.to_string())),
            (
                "providerSessionId".into(),
                provider_session_id.map(Value::String).unwrap_or(Value::Null),
            ),
        ]),
        created_at: now.to_string(),
    });
}

fn emit_snapshot_events(
    app: &AppHandle,
    runtime: &OrchestrationRuntime,
    task_id: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let revision = runtime.next_revision();
    let snapshot = {
        let state = runtime.state.lock().map_err(|e| e.to_string())?;
        project_snapshot(&state, task_id, session_id, revision.clone())?
    };

    let snapshot_event = WorkflowSnapshotUpdatedEvent {
        task_id: task_id.to_string(),
        session_id: session_id.map(ToOwned::to_owned),
        revision: revision.clone(),
        document: snapshot.document.clone(),
    };
    let events_event = WorkflowEventsUpdatedEvent {
        task_id: task_id.to_string(),
        session_id: session_id.map(ToOwned::to_owned),
        revision: revision.clone(),
        events: snapshot.events.clone(),
    };
    let diagnostics_event = WorkflowDiagnosticsUpdatedEvent {
        task_id: task_id.to_string(),
        session_id: session_id.map(ToOwned::to_owned),
        revision,
        diagnostics: snapshot.diagnostics.clone(),
    };

    let _ = app.emit("workflow-snapshot-updated", snapshot_event);
    let _ = app.emit("workflow-events-appended", events_event);
    let _ = app.emit("workflow-diagnostics-updated", diagnostics_event);
    Ok(())
}

fn project_snapshot(
    state: &OrchestrationState,
    task_id: &str,
    session_id: Option<&str>,
    revision: String,
) -> Result<GetWorkflowSnapshotResponse, String> {
    let task = state
        .tasks
        .get(task_id)
        .ok_or_else(|| format!("task not found: {task_id}"))?;
    let plan = state.active_plan_for_task(task_id);
    let active_session = session_id
        .and_then(|id| state.sessions.get(id))
        .or_else(|| state.sessions.values().find(|session| session.task_id == task_id));
    let approvals = state
        .approvals
        .values()
        .filter(|approval| approval.task_id == task_id && approval.status == ApprovalStatus::Pending)
        .cloned()
        .collect::<Vec<_>>();
    let step_map = plan
        .map(|plan| {
            state
                .steps_for_plan(&plan.id)
                .into_iter()
                .map(|step| (step.id.clone(), (*step).clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();

    let document = TaskDagDocument {
        graph_id: task.id.clone(),
        revision,
        task: TaskDagTask {
            id: task.id.clone(),
            title: task.title.clone(),
            prompt: task.prompt.clone(),
            goal: task.goal.clone(),
            status: map_task_status(task.status).to_string(),
            workspace_id: task.workspace_id.clone(),
            active_session_id: active_session.map(|session| session.id.clone()),
            active_plan_id: task.active_plan_id.clone(),
            metadata: Some(BTreeMap::from([(
                "updatedAt".into(),
                Value::String(task.updated_at.clone()),
            )])),
        },
        plan: plan.map(|plan| TaskDagPlan {
            id: plan.id.clone(),
            mode: map_plan_mode(plan.mode).to_string(),
            status: map_plan_status(plan.status).to_string(),
            active_step_id: active_session.and_then(|session| session.current_step_id.clone()),
            step_ids: step_map.keys().cloned().collect(),
            metadata: None,
        }),
        nodes: project_nodes(task, active_session, &step_map, &approvals),
        edges: project_edges(&step_map, &approvals),
        layout_version: 1,
        capabilities: TaskDagCapabilities {
            can_refresh: true,
            can_claim_step: active_session.is_some() && !step_map.is_empty(),
            can_complete_step: active_session.is_some() && !step_map.is_empty(),
            can_block_step: active_session.is_some() && !step_map.is_empty(),
            can_resolve_approval: !approvals.is_empty(),
            can_attach_session: true,
            can_launch_session: true,
            can_send_session_input: active_session.is_some(),
        },
        metadata: None,
    };

    let events = state
        .events
        .iter()
        .filter(|event| event_matches_task(state, event, task_id))
        .map(|event| project_event(state, event))
        .collect::<Vec<_>>();
    let diagnostics = project_diagnostics(task_id, &step_map, active_session, &approvals, &events);

    Ok(GetWorkflowSnapshotResponse {
        document,
        events,
        diagnostics,
    })
}

fn project_nodes(
    task: &Task,
    active_session: Option<&Session>,
    step_map: &BTreeMap<String, PlanStep>,
    approvals: &[ApprovalRequest],
) -> Vec<TaskDagNode> {
    let mut nodes = Vec::new();
    nodes.push(TaskDagNode::TaskRoot(TaskDagTaskRootNode {
        id: format!("task:{}", task.id),
        kind: TaskDagNodeKind::TaskRoot,
        task_id: task.id.clone(),
        label: task.title.clone(),
        description: task.goal.clone().or_else(|| Some(task.prompt.clone())),
        status: Some(map_task_status(task.status).to_string()),
        x: 80.0,
        y: 80.0,
    }));

    let levels = build_step_levels(step_map);
    for (index, step) in step_map.values().enumerate() {
        let level = levels.get(&step.id).copied().unwrap_or(0) as f64;
        let y = 200.0 + (index as f64 * 170.0);
        let session = active_session.filter(|session| session.current_step_id.as_deref() == Some(step.id.as_str()));
        let step_approval = approvals
            .iter()
            .find(|approval| active_session.map(|s| s.id.as_str()) == Some(approval.session_id.as_str()));
        let next_actions = if active_session
            .and_then(|session| session.current_step_id.as_deref())
            == Some(step.id.as_str())
        {
            vec!["task.get_next_action".to_string(), "task.complete_step".to_string()]
        } else {
            Vec::new()
        };
        nodes.push(TaskDagNode::Step(TaskDagStepNode {
            id: format!("step:{}", step.id),
            kind: TaskDagNodeKind::Step,
            step_id: step.id.clone(),
            label: step.title.clone(),
            description: step.description.clone(),
            status: map_step_status(step, session),
            depends_on: step.depends_on.clone(),
            required_skills: step.required_skills.clone(),
            allowed_providers: step
                .allowed_providers
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(map_provider_to_contract)
                .collect(),
            parallelizable: step.parallelizable,
            x: 320.0 + (level * 280.0),
            y,
            runtime: Some(TaskDagStepRuntime {
                current_session: session.map(project_session),
                active_approval: step_approval.map(project_approval),
                lease: Some(codebar_contracts::workflow::TaskDagLease {
                    owner_session_id: step.lease_owner_session_id.clone(),
                    token: step.lease_token.clone(),
                    expires_at: step.lease_expires_at.clone(),
                }),
                latest_progress_summary: step.lease_token.as_ref().map(|_| "Leased for execution".to_string()),
                recommended_next_actions: next_actions,
                metadata: Some(step_runtime_metadata(step)),
            }),
        }));
    }

    for (index, approval) in approvals.iter().enumerate() {
        let step_id = active_session
            .and_then(|session| session.current_step_id.clone())
            .unwrap_or_else(|| format!("task:{}", task.id));
        nodes.push(TaskDagNode::ApprovalGate(TaskDagApprovalGateNode {
            id: format!("approval:{}", approval.id),
            kind: TaskDagNodeKind::ApprovalGate,
            step_id,
            label: approval.title.clone(),
            x: 920.0,
            y: 150.0 + (index as f64 * 160.0),
            approval_request: project_approval(approval),
        }));
    }

    nodes
}

fn project_edges(step_map: &BTreeMap<String, PlanStep>, approvals: &[ApprovalRequest]) -> Vec<TaskDagEdge> {
    let mut edges = Vec::new();
    for step in step_map.values() {
        for dependency in &step.depends_on {
            edges.push(TaskDagEdge {
                id: format!("edge:{dependency}->{}", step.id),
                kind: TaskDagEdgeKind::DependsOn,
                source: format!("step:{dependency}"),
                target: format!("step:{}", step.id),
                label: None,
            });
        }
    }
    for approval in approvals {
        edges.push(TaskDagEdge {
            id: format!("edge:approval:{}", approval.id),
            kind: TaskDagEdgeKind::SpawnsApproval,
            source: format!("task:{}", approval.task_id),
            target: format!("approval:{}", approval.id),
            label: Some("approval".into()),
        });
    }
    edges
}

fn project_event(state: &OrchestrationState, event: &EventEnvelope) -> TaskDagEvent {
    let (task_id, step_id, session_id) = match event.entity_type {
        EventEntityType::Session => {
            let session = state.sessions.get(&event.entity_id);
            (
                session.map(|session| session.task_id.clone()).unwrap_or_default(),
                session.and_then(|session| session.current_step_id.clone()),
                Some(event.entity_id.clone()),
            )
        }
        EventEntityType::Task => (event.entity_id.clone(), None, None),
        _ => (String::new(), None, None),
    };

    TaskDagEvent {
        id: event.id.clone(),
        task_id,
        step_id,
        session_id,
        kind: event.event_type.clone(),
        level: infer_event_level(&event.event_type),
        message: event_message(event),
        created_at: event.created_at.clone(),
        data: Some(event.payload.clone()),
    }
}

fn project_diagnostics(
    task_id: &str,
    step_map: &BTreeMap<String, PlanStep>,
    active_session: Option<&Session>,
    approvals: &[ApprovalRequest],
    events: &[TaskDagEvent],
) -> Vec<TaskDagDiagnostic> {
    let mut diagnostics = Vec::new();
    if step_map.is_empty() {
        diagnostics.push(TaskDagDiagnostic {
            id: format!("diag:{task_id}:empty-plan"),
            task_id: task_id.to_string(),
            step_id: None,
            severity: TaskDagDiagnosticSeverity::Info,
            summary: "No active plan yet".into(),
            detail: Some("This session is attached to workflow runtime, but no explicit plan/steps exist yet.".into()),
            created_at: Some(now_ts()),
            data: None,
        });
    }
    if !approvals.is_empty() {
        diagnostics.push(TaskDagDiagnostic {
            id: format!("diag:{task_id}:approval"),
            task_id: task_id.to_string(),
            step_id: active_session.and_then(|session| session.current_step_id.clone()),
            severity: TaskDagDiagnosticSeverity::Warning,
            summary: "Pending approval blocks progress".into(),
            detail: Some("Resolve the pending approval to continue guided execution.".into()),
            created_at: Some(now_ts()),
            data: None,
        });
    }
    for step in step_map.values().filter(|step| step.status == PlanStepStatus::Blocked) {
        diagnostics.push(TaskDagDiagnostic {
            id: format!("diag:{}:blocked", step.id),
            task_id: task_id.to_string(),
            step_id: Some(step.id.clone()),
            severity: TaskDagDiagnosticSeverity::Error,
            summary: format!("Step '{}' is blocked", step.title),
            detail: Some("Unblock or complete upstream work before continuing.".into()),
            created_at: Some(step.updated_at.clone()),
            data: None,
        });
    }
    for event in events.iter().filter(|event| event.kind == "step.lease_expired") {
        diagnostics.push(TaskDagDiagnostic {
            id: format!("diag:{}:lease-expired", event.id),
            task_id: task_id.to_string(),
            step_id: event.step_id.clone(),
            severity: TaskDagDiagnosticSeverity::Warning,
            summary: "A step lease expired".into(),
            detail: Some(event.message.clone()),
            created_at: Some(event.created_at.clone()),
            data: event.data.clone(),
        });
    }
    diagnostics
}

fn step_runtime_metadata(step: &PlanStep) -> WorkflowMetadata {
    let mut metadata = BTreeMap::new();
    metadata.insert("updatedAt".into(), Value::String(step.updated_at.clone()));
    metadata.insert(
        "allowedProvidersRaw".into(),
        Value::Array(
            step.allowed_providers
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|provider| Value::String(format!("{:?}", provider)))
                .collect(),
        ),
    );
    metadata
}

fn build_step_levels(step_map: &BTreeMap<String, PlanStep>) -> HashMap<String, usize> {
    fn depth_for(
        id: &str,
        step_map: &BTreeMap<String, PlanStep>,
        cache: &mut HashMap<String, usize>,
        visiting: &mut BTreeSet<String>,
    ) -> usize {
        if let Some(depth) = cache.get(id) {
            return *depth;
        }
        if !visiting.insert(id.to_string()) {
            return 0;
        }
        let depth = step_map
            .get(id)
            .map(|step| {
                step.depends_on
                    .iter()
                    .map(|dependency| depth_for(dependency, step_map, cache, visiting) + 1)
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        visiting.remove(id);
        cache.insert(id.to_string(), depth);
        depth
    }

    let mut cache = HashMap::new();
    let mut visiting = BTreeSet::new();
    for id in step_map.keys() {
        depth_for(id, step_map, &mut cache, &mut visiting);
    }
    cache
}

fn event_matches_task(state: &OrchestrationState, event: &EventEnvelope, task_id: &str) -> bool {
    match event.entity_type {
        EventEntityType::Task => event.entity_id == task_id,
        EventEntityType::Session => state
            .sessions
            .get(&event.entity_id)
            .map(|session| session.task_id == task_id)
            .unwrap_or(false),
        _ => false,
    }
}

fn infer_event_level(kind: &str) -> TaskDagEventLevel {
    if kind.contains("blocked") || kind.contains("error") {
        TaskDagEventLevel::Error
    } else if kind.contains("approval") || kind.contains("lease_expired") {
        TaskDagEventLevel::Warning
    } else {
        TaskDagEventLevel::Info
    }
}

fn event_message(event: &EventEnvelope) -> String {
    match event.event_type.as_str() {
        "next_action.resolved" => "Resolved next action".into(),
        "step.claimed" => "Claimed step lease".into(),
        "step.progress_updated" => event
            .payload
            .get("summary")
            .and_then(|value| value.as_str())
            .unwrap_or("Updated step progress")
            .to_string(),
        "step.completed" => "Completed step".into(),
        "step.blocked" => event
            .payload
            .get("reason")
            .and_then(|value| value.as_str())
            .unwrap_or("Blocked step")
            .to_string(),
        "step.lease_expired" => "Step lease expired".into(),
        "skills.resolved" => "Resolved active skills".into(),
        "task.attached" => "Attached session to workflow task".into(),
        _ => event.event_type.clone(),
    }
}

fn map_task_status(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Draft => "draft",
        TaskStatus::Ready => "ready",
        TaskStatus::Active => "active",
        TaskStatus::Blocked => "blocked",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Cancelled => "cancelled",
        TaskStatus::Archived => "archived",
    }
}

fn map_plan_mode(mode: PlanMode) -> &'static str {
    match mode {
        PlanMode::Guided => "guided",
        PlanMode::Open => "open",
    }
}

fn map_plan_status(status: PlanStatus) -> &'static str {
    match status {
        PlanStatus::Draft => "draft",
        PlanStatus::Active => "active",
        PlanStatus::Completed => "completed",
        PlanStatus::Cancelled => "cancelled",
    }
}

fn map_step_status(step: &PlanStep, active_session: Option<&Session>) -> TaskDagStepStatus {
    match step.status {
        PlanStepStatus::Pending => {
            if active_session
                .and_then(|session| session.current_step_id.as_deref())
                == Some(step.id.as_str())
            {
                TaskDagStepStatus::Ready
            } else {
                TaskDagStepStatus::Idle
            }
        }
        PlanStepStatus::Claimed => TaskDagStepStatus::Ready,
        PlanStepStatus::Running => {
            if active_session.map(|session| session.state) == Some(SessionState::WaitingInput) {
                TaskDagStepStatus::WaitingInput
            } else {
                TaskDagStepStatus::Running
            }
        }
        PlanStepStatus::Blocked => TaskDagStepStatus::Blocked,
        PlanStepStatus::Completed => TaskDagStepStatus::Completed,
        PlanStepStatus::Cancelled => TaskDagStepStatus::Failed,
    }
}

fn project_session(session: &Session) -> TaskDagSession {
    TaskDagSession {
        id: session.id.clone(),
        provider: map_provider_to_contract(session.provider),
        state: map_session_state(session.state),
        provider_session_id: session.provider_session_id.clone(),
        created_at: Some(session.created_at.clone()),
        updated_at: Some(session.updated_at.clone()),
        summary: session.last_activity_at.clone(),
    }
}

fn project_approval(approval: &ApprovalRequest) -> TaskDagApprovalRequest {
    TaskDagApprovalRequest {
        id: approval.id.clone(),
        status: match approval.status {
            ApprovalStatus::Pending => TaskDagApprovalStatus::Pending,
            ApprovalStatus::Approved => TaskDagApprovalStatus::Approved,
            ApprovalStatus::Rejected | ApprovalStatus::Expired => TaskDagApprovalStatus::Rejected,
        },
        title: Some(approval.title.clone()),
        summary: Some(approval.description.clone()),
        requested_at: Some(approval.created_at.clone()),
        responded_at: approval.resolved_at.clone(),
    }
}

fn map_provider_to_contract(provider: Provider) -> TaskDagProvider {
    match provider {
        Provider::Claude => TaskDagProvider::ClaudeCode,
        Provider::Codex => TaskDagProvider::Codex,
    }
}

fn map_provider_from_contract(provider: TaskDagProvider) -> Provider {
    match provider {
        TaskDagProvider::ClaudeCode => Provider::Claude,
        TaskDagProvider::Codex => Provider::Codex,
    }
}

fn map_session_state(state: SessionState) -> TaskDagSessionState {
    match state {
        SessionState::Draft | SessionState::Ready => TaskDagSessionState::Created,
        SessionState::PreparingWorkspace | SessionState::PreparingWorktree | SessionState::Launching => {
            TaskDagSessionState::Launching
        }
        SessionState::Running => TaskDagSessionState::Running,
        SessionState::WaitingInput => TaskDagSessionState::WaitingInput,
        SessionState::ApprovalRequired | SessionState::Interrupted => TaskDagSessionState::Paused,
        SessionState::Completed => TaskDagSessionState::Completed,
        SessionState::Failed => TaskDagSessionState::Failed,
        SessionState::Cancelled | SessionState::Archived => TaskDagSessionState::Stopped,
    }
}

fn map_next_action(next: &NextActionView) -> TaskDagNextAction {
    TaskDagNextAction {
        task_id: next.task_id.clone(),
        mode: map_plan_mode(next.mode).to_string(),
        step_id: next.step.as_ref().map(|step| step.id.clone()),
        label: next.step.as_ref().map(|step| step.title.clone()),
        description: next.step.as_ref().and_then(|step| step.description.clone()),
        active_skills: next.active_skills.clone(),
        recommended_sequence: next
            .recommended_sequence
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|call| call.name)
            .collect(),
    }
}

fn map_session_status_to_task_status(status: Option<&str>) -> TaskStatus {
    match status.unwrap_or_default() {
        "running" | "waiting" | "suspended" => TaskStatus::Active,
        "error" => TaskStatus::Failed,
        "done" => TaskStatus::Completed,
        _ => TaskStatus::Ready,
    }
}

fn map_session_status_to_orchestrator_state(status: Option<&str>) -> SessionState {
    match status.unwrap_or_default() {
        "running" => SessionState::Running,
        "waiting" => SessionState::WaitingInput,
        "suspended" => SessionState::Interrupted,
        "done" => SessionState::Completed,
        "error" => SessionState::Failed,
        _ => SessionState::Ready,
    }
}

fn now_ts() -> String {
    format!("{}", max(1, REVISION_COUNTER.fetch_add(1, Ordering::SeqCst)))
}
