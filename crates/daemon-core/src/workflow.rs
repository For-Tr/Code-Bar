use crate::{
    domain::{error_envelope, DomainResult, ErrorCode, EventEnvelope, EventEntityType},
    ports::{ApprovalFilter, EventFilter, SessionFilter, TaskFilter},
    services::ServiceContext,
};
use codebar_contracts::workflow::{
    AttachWorkflowSessionRequest, AttachWorkflowSessionResponse, BlockWorkflowStepRequest,
    ClaimWorkflowStepRequest, ClaimWorkflowStepResponse, CompleteWorkflowStepRequest,
    CompleteWorkflowStepResponse, GetWorkflowNextActionRequest, GetWorkflowNextActionResponse,
    GetWorkflowSnapshotRequest, GetWorkflowSnapshotResponse, TaskDagApprovalGateNode,
    TaskDagApprovalRequest, TaskDagApprovalStatus, TaskDagCapabilities, TaskDagDiagnostic,
    TaskDagDiagnosticSeverity, TaskDagDocument, TaskDagEdge, TaskDagEdgeKind, TaskDagEvent,
    TaskDagEventLevel, TaskDagNextAction, TaskDagNode, TaskDagNodeKind, TaskDagPlan,
    TaskDagProvider, TaskDagSession, TaskDagSessionState, TaskDagStepNode, TaskDagStepRuntime,
    TaskDagStepStatus, TaskDagTask, TaskDagTaskRootNode, UpdateWorkflowProgressRequest,
    WorkflowMetadata,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use task_orchestrator::{
    ApprovalRequest, ApprovalStatus, Engine, EventEnvelope as OrchestratorEvent, NextActionView,
    OrchestrationState, PlanMode, PlanStatus, PlanStep, PlanStepStatus, Provider, Session,
    SessionAttachmentInput, SessionState, Task, TaskStatus, Worktree, Workspace,
};

pub struct WorkflowService {
    ctx: ServiceContext,
    engine: Engine,
}

impl WorkflowService {
    pub fn new(ctx: ServiceContext) -> Self {
        Self {
            ctx,
            engine: Engine::default(),
        }
    }

    pub fn get_snapshot(
        &self,
        input: GetWorkflowSnapshotRequest,
    ) -> DomainResult<GetWorkflowSnapshotResponse> {
        let state = self.load_state()?;
        self.project_snapshot(
            &state,
            &input.task_id,
            input.session_id.as_deref(),
            input.include_events.unwrap_or(true),
            input.include_diagnostics.unwrap_or(true),
        )
    }

    pub fn get_next_action(
        &self,
        input: GetWorkflowNextActionRequest,
    ) -> DomainResult<GetWorkflowNextActionResponse> {
        let mut state = self.load_state()?;
        let next = self
            .engine
            .get_next_action(&mut state, &input.session_id, &self.ctx.clock.now())
            .map_err(map_orchestrator_error)?;
        Ok(GetWorkflowNextActionResponse {
            task_id: next.task_id.clone(),
            next_action: map_next_action(&next),
        })
    }

    pub fn claim_step(
        &self,
        input: ClaimWorkflowStepRequest,
    ) -> DomainResult<ClaimWorkflowStepResponse> {
        let mut state = self.load_state()?;
        let claim = self
            .engine
            .claim_step(
                &mut state,
                &input.session_id,
                input.step_id.as_deref(),
                &self.ctx.clock.now(),
            )
            .map_err(map_orchestrator_error)?;
        self.persist_state(&state)?;
        self.persist_events(&state.events)?;
        convert(claim)
    }

    pub fn update_progress(&self, input: UpdateWorkflowProgressRequest) -> DomainResult<()> {
        let mut state = self.load_state()?;
        self.engine
            .update_progress(
                &mut state,
                &input.session_id,
                &input.step_id,
                input.lease_token.as_deref(),
                &input.summary,
                input.details.as_ref(),
                &self.ctx.clock.now(),
            )
            .map_err(map_orchestrator_error)?;
        self.persist_state(&state)?;
        self.persist_events(&state.events)
    }

    pub fn complete_step(
        &self,
        input: CompleteWorkflowStepRequest,
    ) -> DomainResult<CompleteWorkflowStepResponse> {
        let mut state = self.load_state()?;
        let result = self
            .engine
            .complete_step(
                &mut state,
                &input.session_id,
                &input.step_id,
                input.lease_token.as_deref(),
                input.outputs.as_ref(),
                &self.ctx.clock.now(),
            )
            .map_err(map_orchestrator_error)?;
        self.persist_state(&state)?;
        self.persist_events(&state.events)?;
        convert(result)
    }

    pub fn block_step(&self, input: BlockWorkflowStepRequest) -> DomainResult<()> {
        let mut state = self.load_state()?;
        self.engine
            .block_step(
                &mut state,
                &input.session_id,
                &input.step_id,
                &input.reason,
                &self.ctx.clock.now(),
            )
            .map_err(map_orchestrator_error)?;
        self.persist_state(&state)?;
        self.persist_events(&state.events)
    }

    pub fn attach_session(
        &self,
        input: AttachWorkflowSessionRequest,
    ) -> DomainResult<AttachWorkflowSessionResponse> {
        let mut state = self.load_state()?;
        if let Some(session_id) = input.session_id.as_deref() {
            self.ensure_open_session_plan(&mut state, &input, session_id)?;
        }
        let attachment = self
            .engine
            .attach_session(
                &mut state,
                &SessionAttachmentInput {
                    provider: map_provider_from_contract(input.provider),
                    session_id: input.session_id.clone(),
                    provider_session_id: input.provider_session_id.clone(),
                    cwd: input.cwd.clone(),
                    worktree_path: input.worktree_path.clone(),
                },
                &self.ctx.clock.now(),
            )
            .map_err(map_orchestrator_error)?;
        self.persist_state(&state)?;
        self.persist_events(&state.events)?;
        let snapshot = self.project_snapshot(&state, &attachment.task_id, Some(&attachment.session_id), true, true)?;
        Ok(AttachWorkflowSessionResponse {
            task_id: attachment.task_id,
            session_id: Some(attachment.session_id),
            document: snapshot.document,
        })
    }

    pub fn list_task_events(
        &self,
        task_id: &str,
        session_id: Option<&str>,
    ) -> DomainResult<Vec<TaskDagEvent>> {
        let state = self.load_state()?;
        let snapshot = self.project_snapshot(&state, task_id, session_id, true, false)?;
        Ok(snapshot.events)
    }

    fn load_state(&self) -> DomainResult<OrchestrationState> {
        let mut state = OrchestrationState::default();

        for workspace in self.ctx.store.list_workspaces()? {
            let mapped: Workspace = convert(workspace)?;
            state.workspaces.insert(mapped.id.clone(), mapped);
        }
        for worktree in self.ctx.store.list_worktrees(None)? {
            let mapped: Worktree = convert(worktree)?;
            state.worktrees.insert(mapped.id.clone(), mapped);
        }
        for task in self.ctx.store.list_tasks(&TaskFilter::default())? {
            let task_id = task.id.clone();
            let mapped: Task = convert(task)?;
            state.tasks.insert(task_id.clone(), mapped);
            if let Some(plan) = self.ctx.store.get_active_plan_for_task(&task_id)? {
                let plan_id = plan.id.clone();
                let mapped_plan = convert(plan)?;
                state.plans.insert(plan_id.clone(), mapped_plan);
                for step in self.ctx.store.list_plan_steps(&plan_id)? {
                    let mapped_step: PlanStep = convert(step)?;
                    state.steps.insert(mapped_step.id.clone(), mapped_step);
                }
            }
        }
        for session in self.ctx.store.list_sessions(&SessionFilter::default())? {
            let session_id = session.id.clone();
            let mapped: Session = convert(session)?;
            state.sessions.insert(session_id.clone(), mapped);
            for run in self.ctx.store.list_run_attempts(&session_id)? {
                let mapped_run: task_orchestrator::RunAttempt = convert(run)?;
                state.run_attempts.insert(mapped_run.id.clone(), mapped_run);
            }
        }
        for profile in self.ctx.store.list_skill_profiles()? {
            let mapped: task_orchestrator::SkillProfile = convert(profile)?;
            state.skill_profiles.insert(mapped.id.clone(), mapped);
        }
        for approval in self
            .ctx
            .store
            .list_approval_requests(&ApprovalFilter::default())?
        {
            let mapped: ApprovalRequest = convert(approval)?;
            state.approvals.insert(mapped.id.clone(), mapped);
        }

        Ok(state)
    }

    fn persist_state(&self, state: &OrchestrationState) -> DomainResult<()> {
        for task in state.tasks.values().cloned() {
            self.ctx.store.put_task(convert(task)?)?;
        }
        for session in state.sessions.values().cloned() {
            self.ctx.store.put_session(convert(session)?)?;
        }
        for plan in state.plans.values().cloned() {
            self.ctx.store.put_plan(convert(plan)?)?;
        }
        for step in state.steps.values().cloned() {
            self.ctx.store.put_plan_step(convert(step)?)?;
        }
        for approval in state.approvals.values().cloned() {
            self.ctx.store.put_approval_request(convert(approval)?)?;
        }
        Ok(())
    }

    fn persist_events(&self, events: &[OrchestratorEvent]) -> DomainResult<()> {
        for event in events.iter().cloned() {
            let mapped = map_orchestrator_event(event)?;
            self.ctx.events.publish_event(mapped)?;
        }
        Ok(())
    }

    fn ensure_open_session_plan(
        &self,
        state: &mut OrchestrationState,
        input: &AttachWorkflowSessionRequest,
        session_id: &str,
    ) -> DomainResult<()> {
        let session = state
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| error_envelope(ErrorCode::NotFound, format!("session {session_id} not found"), false))?;
        if state.active_plan_for_task(&session.task_id).is_some() {
            return Ok(());
        }

        let now = self.ctx.clock.now();
        let plan_id = format!("plan-{session_id}");
        let step_id = format!("step-{session_id}-open");

        state.plans.insert(
            plan_id.clone(),
            task_orchestrator::Plan {
                id: plan_id.clone(),
                task_id: session.task_id.clone(),
                mode: PlanMode::Open,
                status: PlanStatus::Active,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );

        let task = state
            .tasks
            .get_mut(&session.task_id)
            .ok_or_else(|| error_envelope(ErrorCode::NotFound, "task not found for session", false))?;
        task.active_plan_id = Some(plan_id.clone());
        task.updated_at = now.clone();

        let existing_step = state.steps.get(&step_id).cloned();
        let preserved_status = existing_step.as_ref().map(|step| step.status);
        let preserved_lease_owner = existing_step
            .as_ref()
            .and_then(|step| step.lease_owner_session_id.clone());
        let preserved_lease_token = existing_step.as_ref().and_then(|step| step.lease_token.clone());
        let preserved_lease_expires_at = existing_step
            .as_ref()
            .and_then(|step| step.lease_expires_at.clone());

        let step_status = derive_open_step_status(
            preserved_status,
            preserved_lease_owner.as_deref(),
            input
                .session_status
                .as_deref()
                .or_else(|| Some(session_status_label(session.state))),
        );

        let worktree = session
            .worktree_id
            .as_deref()
            .and_then(|worktree_id| state.worktrees.get(worktree_id));

        state.steps.insert(
            step_id.clone(),
            PlanStep {
                id: step_id.clone(),
                plan_id: plan_id.clone(),
                title: input
                    .current_task
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| input.session_name.clone())
                    .unwrap_or_else(|| task.title.clone()),
                description: Some(build_open_step_description(input, worktree)),
                status: step_status,
                depends_on: vec![],
                parallelizable: false,
                required_skills: vec![],
                allowed_providers: Some(vec![session.provider]),
                lease_owner_session_id: preserved_lease_owner,
                lease_token: preserved_lease_token,
                lease_expires_at: preserved_lease_expires_at,
                progress_summary: existing_step.as_ref().and_then(|step| step.progress_summary.clone()),
                progress_details: existing_step.as_ref().and_then(|step| step.progress_details.clone()),
                outputs: existing_step.as_ref().and_then(|step| step.outputs.clone()),
                blocked_reason: existing_step.as_ref().and_then(|step| step.blocked_reason.clone()),
                created_at: existing_step
                    .as_ref()
                    .map(|step| step.created_at.clone())
                    .unwrap_or_else(|| now.clone()),
                updated_at: now.clone(),
            },
        );

        if let Some(session) = state.sessions.get_mut(session_id) {
            session.current_step_id = if matches!(
                step_status,
                PlanStepStatus::Pending | PlanStepStatus::Claimed | PlanStepStatus::Running
            ) {
                Some(step_id)
            } else {
                None
            };
            session.updated_at = now;
        }

        Ok(())
    }

    fn project_snapshot(
        &self,
        state: &OrchestrationState,
        task_id: &str,
        session_id: Option<&str>,
        include_events: bool,
        include_diagnostics: bool,
    ) -> DomainResult<GetWorkflowSnapshotResponse> {
        let task = state
            .tasks
            .get(task_id)
            .ok_or_else(|| error_envelope(ErrorCode::NotFound, format!("task {task_id} not found"), false))?;
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

        let events = if include_events || include_diagnostics {
            self.project_events(state, task_id)?
        } else {
            Vec::new()
        };
        let revision = format!("rev-{}-{}", task.updated_at, events.len());

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

        let diagnostics = if include_diagnostics {
            project_diagnostics(task_id, &step_map, active_session, &approvals, &events)
        } else {
            Vec::new()
        };

        Ok(GetWorkflowSnapshotResponse {
            document,
            events: if include_events { events } else { Vec::new() },
            diagnostics,
        })
    }

    fn project_events(
        &self,
        state: &OrchestrationState,
        task_id: &str,
    ) -> DomainResult<Vec<TaskDagEvent>> {
        Ok(self
            .ctx
            .events
            .list_events(&EventFilter::default())?
            .into_iter()
            .filter(|event| event_matches_task(state, event, task_id))
            .map(|event| project_event(state, &event))
            .collect())
    }
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
                latest_progress_summary: step.progress_summary.clone(),
                progress_details: value_to_metadata(step.progress_details.as_ref()),
                outputs: value_to_metadata(step.outputs.as_ref()),
                blocked_reason: step.blocked_reason.clone(),
                recommended_next_actions: next_actions,
                metadata: Some(step_runtime_metadata(step, active_session, task)),
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
    let step_id_from_payload = event
        .payload
        .get("stepId")
        .and_then(|value| value.as_str())
        .map(ToString::to_string);

    let (task_id, step_id, session_id) = match event.entity_type {
        EventEntityType::Session => {
            let session = state.sessions.get(&event.entity_id);
            (
                session.map(|session| session.task_id.clone()).unwrap_or_default(),
                step_id_from_payload.or_else(|| session.and_then(|session| session.current_step_id.clone())),
                Some(event.entity_id.clone()),
            )
        }
        EventEntityType::Task => (event.entity_id.clone(), step_id_from_payload, None),
        EventEntityType::Approval => {
            let task_id = step_id_from_payload.clone().unwrap_or_default();
            (task_id, step_id_from_payload, None)
        }
        _ => (String::new(), step_id_from_payload, None),
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
        data: value_to_metadata(Some(&event.payload)),
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
            created_at: None,
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
            created_at: None,
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
            detail: step
                .blocked_reason
                .clone()
                .or_else(|| Some("Unblock or complete upstream work before continuing.".into())),
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

fn step_runtime_metadata(
    step: &PlanStep,
    active_session: Option<&Session>,
    task: &Task,
) -> WorkflowMetadata {
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
    if step.id.contains("-open") {
        metadata.insert("synthetic".into(), Value::Bool(true));
        metadata.insert(
            "source".into(),
            Value::String("attached_session_open_mode".into()),
        );
        metadata.insert("taskPrompt".into(), Value::String(task.prompt.clone()));
        if let Some(session) = active_session {
            metadata.insert(
                "sessionState".into(),
                Value::String(format!("{:?}", session.state)),
            );
        }
    }
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
        EventEntityType::Approval => state
            .approvals
            .get(&event.entity_id)
            .map(|approval| approval.task_id == task_id)
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

fn build_open_step_description(
    input: &AttachWorkflowSessionRequest,
    worktree: Option<&Worktree>,
) -> String {
    let mut parts = Vec::new();
    if let Some(branch) = input
        .branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| worktree.and_then(|item| item.branch_name.as_deref()))
    {
        parts.push(format!("branch {branch}"));
    }
    if let Some(base_branch) = input
        .base_branch
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| worktree.and_then(|item| item.base_branch.as_deref()))
    {
        parts.push(format!("base {base_branch}"));
    }
    if let Some(worktree_path) = input
        .worktree_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| worktree.map(|item| item.path.as_str()))
    {
        parts.push(format!("worktree {worktree_path}"));
    }
    if parts.is_empty() {
        "Continue work in attached session.".into()
    } else {
        format!("Continue work in attached session from {}.", parts.join(", "))
    }
}

fn derive_open_step_status(
    existing_status: Option<PlanStepStatus>,
    lease_owner_session_id: Option<&str>,
    session_status: Option<&str>,
) -> PlanStepStatus {
    if matches!(
        existing_status,
        Some(PlanStepStatus::Completed | PlanStepStatus::Blocked)
    ) {
        return existing_status.expect("existing status");
    }

    if lease_owner_session_id.is_some()
        || matches!(existing_status, Some(PlanStepStatus::Claimed | PlanStepStatus::Running))
    {
        return existing_status.unwrap_or(PlanStepStatus::Running);
    }

    match session_status.unwrap_or_default() {
        "done" => PlanStepStatus::Completed,
        "error" => PlanStepStatus::Blocked,
        _ => PlanStepStatus::Pending,
    }
}

fn session_status_label(state: SessionState) -> &'static str {
    match state {
        SessionState::Running => "running",
        SessionState::WaitingInput => "waiting",
        SessionState::Interrupted | SessionState::ApprovalRequired => "suspended",
        SessionState::Completed => "done",
        SessionState::Failed | SessionState::Cancelled | SessionState::Archived => "error",
        _ => "idle",
    }
}

fn value_to_metadata(value: Option<&Value>) -> Option<WorkflowMetadata> {
    value
        .and_then(|value| value.as_object())
        .map(|object| object.clone().into_iter().collect())
}

fn map_orchestrator_event(event: OrchestratorEvent) -> DomainResult<EventEnvelope> {
    Ok(EventEnvelope {
        id: event.id,
        entity_type: convert(event.entity_type)?,
        entity_id: event.entity_id,
        event_type: event.event_type,
        source: convert(event.source)?,
        correlation_id: event.correlation_id,
        payload: Value::Object(event.payload.into_iter().collect()),
        created_at: event.created_at,
    })
}

fn map_orchestrator_error(error: task_orchestrator::ErrorEnvelope) -> crate::domain::ErrorEnvelope {
    let base = match error.code.as_str() {
        "not_found" => error_envelope(ErrorCode::NotFound, error.message, error.retryable),
        "invalid_input" => error_envelope(ErrorCode::InvalidArgument, error.message, error.retryable),
        "conflict" => error_envelope(ErrorCode::InvalidArgument, error.message, error.retryable),
        _ => error_envelope(ErrorCode::Internal, error.message, error.retryable),
    };
    match error.details {
        Some(details) => crate::domain::error_with_details(base, Value::Object(details.into_iter().collect())),
        None => base,
    }
}

fn convert<T, U>(value: T) -> DomainResult<U>
where
    T: Serialize,
    U: DeserializeOwned,
{
    let value = serde_json::to_value(value)
        .map_err(|error| error_envelope(ErrorCode::Internal, error.to_string(), true))?;
    serde_json::from_value(value)
        .map_err(|error| error_envelope(ErrorCode::Internal, error.to_string(), true))
}
