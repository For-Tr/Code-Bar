use std::collections::BTreeMap;

use task_orchestrator::{
    ApprovalActionType, ApprovalRequest, ApprovalStatus, CleanupPolicy, Engine, OrchestrationState,
    Plan, PlanMode, PlanStatus, PlanStep, PlanStepStatus, Provider, Session,
    SessionAttachmentInput, SessionLaunchMode, SessionState, SkillProfile, SkillProfileSource,
    Task, TaskStatus, TrustLevel, VcsType, Workspace, Worktree, WorktreeLifecycleState,
    WorktreeSource,
};

fn ts(minute: u32) -> String {
    format!("2026-04-24T12:{minute:02}:00Z")
}

fn base_state(mode: PlanMode) -> OrchestrationState {
    let workspace = Workspace {
        id: "ws-1".into(),
        display_name: "Workspace".into(),
        root_path: "/repo".into(),
        vcs_type: VcsType::Git,
        repo_identity: Some("repo-1".into()),
        trust_level: TrustLevel::Trusted,
        default_provider: Some(Provider::Claude),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let worktree = Worktree {
        id: "wt-1".into(),
        workspace_id: workspace.id.clone(),
        path: "/repo/.codebar/session-1".into(),
        branch_name: Some("ci/test".into()),
        base_branch: Some("main".into()),
        source: WorktreeSource::Managed,
        lifecycle_state: WorktreeLifecycleState::Ready,
        cleanup_policy: CleanupPolicy::Manual,
        created_at: ts(0),
        updated_at: ts(0),
    };
    let task = Task {
        id: "task-1".into(),
        workspace_id: workspace.id.clone(),
        title: "Implement orchestration".into(),
        prompt: "Build the engine".into(),
        goal: Some("Ship orchestration".into()),
        constraints: Some(vec!["tests required".into()]),
        requested_provider: Some(Provider::Claude),
        requested_model: None,
        status: TaskStatus::Ready,
        active_plan_id: Some("plan-1".into()),
        active_skill_profile_id: Some("task-profile".into()),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let session = Session {
        id: "session-1".into(),
        task_id: task.id.clone(),
        workspace_id: workspace.id.clone(),
        worktree_id: Some(worktree.id.clone()),
        provider: Provider::Claude,
        provider_session_id: Some("provider-1".into()),
        launch_mode: SessionLaunchMode::New,
        state: SessionState::Ready,
        current_step_id: None,
        last_activity_at: None,
        created_at: ts(0),
        updated_at: ts(0),
    };
    let plan = Plan {
        id: "plan-1".into(),
        task_id: task.id.clone(),
        mode,
        status: PlanStatus::Active,
        created_at: ts(0),
        updated_at: ts(0),
    };

    let step_a = PlanStep {
        id: "step-a".into(),
        plan_id: plan.id.clone(),
        title: "Prepare domain models".into(),
        description: Some("Create shared data models".into()),
        status: PlanStepStatus::Pending,
        depends_on: vec![],
        parallelizable: false,
        required_skills: vec!["rust".into()],
        allowed_providers: Some(vec![Provider::Claude, Provider::Codex]),
        lease_owner_session_id: None,
        lease_token: None,
        lease_expires_at: None,
        progress_summary: None,
        progress_details: None,
        outputs: None,
        blocked_reason: None,
        created_at: ts(1),
        updated_at: ts(1),
    };
    let step_b = PlanStep {
        id: "step-b".into(),
        plan_id: plan.id.clone(),
        title: "Implement resolver".into(),
        description: Some("Add next action resolver".into()),
        status: PlanStepStatus::Pending,
        depends_on: vec!["step-a".into()],
        parallelizable: true,
        required_skills: vec!["resolver".into()],
        allowed_providers: Some(vec![Provider::Claude]),
        lease_owner_session_id: None,
        lease_token: None,
        lease_expires_at: None,
        progress_summary: None,
        progress_details: None,
        outputs: None,
        blocked_reason: None,
        created_at: ts(2),
        updated_at: ts(2),
    };
    let step_c = PlanStep {
        id: "step-c".into(),
        plan_id: plan.id.clone(),
        title: "Write tests".into(),
        description: Some("Add orchestration tests".into()),
        status: PlanStepStatus::Pending,
        depends_on: vec!["step-b".into()],
        parallelizable: true,
        required_skills: vec!["tests".into()],
        allowed_providers: Some(vec![Provider::Claude]),
        lease_owner_session_id: None,
        lease_token: None,
        lease_expires_at: None,
        progress_summary: None,
        progress_details: None,
        outputs: None,
        blocked_reason: None,
        created_at: ts(3),
        updated_at: ts(3),
    };

    let workspace_profile = SkillProfile {
        id: "workspace-profile".into(),
        name: "workspace".into(),
        source: SkillProfileSource::Workspace,
        workspace_id: Some(workspace.id.clone()),
        worktree_id: None,
        task_id: None,
        step_id: None,
        allowed_skills: vec!["workspace-skill".into(), "shared".into()],
        preferred_skills: Some(vec!["workspace-skill".into()]),
        forbidden_skills: Some(vec!["forbidden-global".into()]),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let worktree_profile = SkillProfile {
        id: "worktree-profile".into(),
        name: "worktree".into(),
        source: SkillProfileSource::Worktree,
        workspace_id: None,
        worktree_id: Some(worktree.id.clone()),
        task_id: None,
        step_id: None,
        allowed_skills: vec!["worktree-skill".into(), "shared".into()],
        preferred_skills: Some(vec!["worktree-skill".into()]),
        forbidden_skills: Some(vec!["forbidden-worktree".into()]),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let task_profile = SkillProfile {
        id: "task-profile".into(),
        name: "task".into(),
        source: SkillProfileSource::Task,
        workspace_id: None,
        worktree_id: None,
        task_id: Some(task.id.clone()),
        step_id: None,
        allowed_skills: vec!["task-skill".into(), "shared".into()],
        preferred_skills: Some(vec!["task-skill".into()]),
        forbidden_skills: Some(vec!["shared".into()]),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let step_profile = SkillProfile {
        id: "step-profile".into(),
        name: "step".into(),
        source: SkillProfileSource::Step,
        workspace_id: None,
        worktree_id: None,
        task_id: None,
        step_id: Some("step-b".into()),
        allowed_skills: vec!["step-skill".into(), "shared".into()],
        preferred_skills: Some(vec!["step-skill".into()]),
        forbidden_skills: Some(vec!["forbidden-step".into()]),
        created_at: ts(0),
        updated_at: ts(0),
    };

    let mut state = OrchestrationState::default();
    state.workspaces.insert(workspace.id.clone(), workspace);
    state.worktrees.insert(worktree.id.clone(), worktree);
    state.tasks.insert(task.id.clone(), task);
    state.sessions.insert(session.id.clone(), session);
    state.plans.insert(plan.id.clone(), plan);
    state.steps.insert(step_a.id.clone(), step_a);
    state.steps.insert(step_b.id.clone(), step_b);
    state.steps.insert(step_c.id.clone(), step_c);
    state
        .skill_profiles
        .insert(workspace_profile.id.clone(), workspace_profile);
    state
        .skill_profiles
        .insert(worktree_profile.id.clone(), worktree_profile);
    state
        .skill_profiles
        .insert(task_profile.id.clone(), task_profile);
    state
        .skill_profiles
        .insert(step_profile.id.clone(), step_profile);
    state
}

#[test]
fn guided_mode_returns_single_best_step() {
    let mut state = base_state(PlanMode::Guided);
    let engine = Engine::default();

    let next = engine
        .get_next_action(&mut state, "session-1", &ts(10))
        .expect("next action");

    assert_eq!(next.mode, PlanMode::Guided);
    assert_eq!(next.step.expect("step").id, "step-a");
    let seq = next.recommended_sequence.expect("sequence");
    assert_eq!(seq[0].name, "task.get_next_action");
    assert_eq!(seq[1].name, "task.update_progress");
}

#[test]
fn open_mode_keeps_priority_and_mcp_shape() {
    let mut state = base_state(PlanMode::Open);
    let engine = Engine::default();

    let next = engine
        .get_next_action(&mut state, "session-1", &ts(10))
        .expect("next action");

    assert_eq!(next.mode, PlanMode::Open);
    assert_eq!(next.step.expect("step").id, "step-a");
    let seq = next.recommended_sequence.expect("sequence");
    assert_eq!(seq[0].name, "task.get_next_action");
    assert!(seq
        .iter()
        .any(|call| call.name == "task.complete_step#step-a"));
}

#[test]
fn depends_on_strictly_unlocks_followup_after_completion() {
    let mut state = base_state(PlanMode::Guided);
    let engine = Engine::default();

    let claim = engine
        .claim_step(&mut state, "session-1", Some("step-a"), &ts(10))
        .expect("claim");
    engine
        .update_progress(
            &mut state,
            "session-1",
            "step-a",
            Some(&claim.lease_token),
            "started",
            None,
            &ts(11),
        )
        .expect("progress");
    let completed = engine
        .complete_step(
            &mut state,
            "session-1",
            "step-a",
            Some(&claim.lease_token),
            Some(&BTreeMap::from([(
                "artifact".into(),
                serde_json::Value::String("done".into()),
            )])),
            &ts(12),
        )
        .expect("complete");

    let step = state.steps.get("step-a").expect("step-a");
    assert_eq!(step.progress_summary.as_deref(), Some("started"));
    assert_eq!(
        step.outputs
            .as_ref()
            .and_then(|value| value.get("artifact"))
            .and_then(|value| value.as_str()),
        Some("done")
    );
    assert_eq!(completed.next_step_id.as_deref(), Some("step-b"));
    let next = engine
        .get_next_action(&mut state, "session-1", &ts(12))
        .expect("next action");
    assert_eq!(next.step.expect("step").id, "step-b");
}

#[test]
fn blocked_step_pauses_only_related_subgraph() {
    let mut state = base_state(PlanMode::Guided);
    let plan_id = "plan-1".to_string();
    state.steps.insert(
        "step-d".into(),
        PlanStep {
            id: "step-d".into(),
            plan_id,
            title: "Independent docs".into(),
            description: None,
            status: PlanStepStatus::Pending,
            depends_on: vec![],
            parallelizable: true,
            required_skills: vec!["docs".into()],
            allowed_providers: Some(vec![Provider::Claude]),
            lease_owner_session_id: None,
            lease_token: None,
            lease_expires_at: None,
            progress_summary: None,
            progress_details: None,
            outputs: None,
            blocked_reason: None,
            created_at: ts(1),
            updated_at: ts(1),
        },
    );

    let engine = Engine::default();
    engine
        .block_step(&mut state, "session-1", "step-a", "waiting on API", &ts(10))
        .expect("block");

    let blocked = state.steps.get("step-a").expect("step-a");
    assert_eq!(blocked.blocked_reason.as_deref(), Some("waiting on API"));

    let next = engine
        .get_next_action(&mut state, "session-1", &ts(10))
        .expect("next action");
    assert_eq!(next.step.expect("step").id, "step-d");
}

#[test]
fn step_skill_profile_overrides_task_worktree_and_workspace() {
    let mut state = base_state(PlanMode::Guided);
    let engine = Engine::default();

    state.steps.get_mut("step-a").unwrap().status = PlanStepStatus::Completed;
    let skills = engine
        .resolve_active_skills(&mut state, "session-1", Some("step-b"), &ts(10))
        .expect("skills");

    assert_eq!(
        skills.active_skill_profile_id.as_deref(),
        Some("step-profile")
    );
    assert_eq!(skills.active_skills, vec!["step-skill"]);
    assert_eq!(skills.preferred_skills, Some(vec!["step-skill".into()]));
    let forbidden = skills.forbidden_skills.expect("forbidden");
    assert!(forbidden.contains(&"forbidden-global".into()));
    assert!(forbidden.contains(&"forbidden-worktree".into()));
    assert!(forbidden.contains(&"forbidden-step".into()));
}

#[test]
fn pending_approval_prevents_new_step_selection() {
    let mut state = base_state(PlanMode::Guided);
    state.approvals.insert(
        "approval-1".into(),
        ApprovalRequest {
            id: "approval-1".into(),
            session_id: "session-1".into(),
            task_id: "task-1".into(),
            action_type: ApprovalActionType::Write,
            title: "Need approval".into(),
            description: "Approve file write".into(),
            payload: BTreeMap::new(),
            status: ApprovalStatus::Pending,
            created_at: ts(9),
            resolved_at: None,
        },
    );
    let engine = Engine::default();

    let next = engine
        .get_next_action(&mut state, "session-1", &ts(10))
        .expect("next action");

    assert!(next.step.is_none());
}

#[test]
fn update_progress_persists_details() {
    let mut state = base_state(PlanMode::Guided);
    let engine = Engine::default();

    let claim = engine
        .claim_step(&mut state, "session-1", Some("step-a"), &ts(10))
        .expect("claim");
    engine
        .update_progress(
            &mut state,
            "session-1",
            "step-a",
            Some(&claim.lease_token),
            "started",
            Some(&BTreeMap::from([(
                "percent".into(),
                serde_json::Value::from(50),
            )])),
            &ts(11),
        )
        .expect("progress");

    let step = state.steps.get("step-a").expect("step-a");
    assert_eq!(step.progress_summary.as_deref(), Some("started"));
    assert_eq!(
        step.progress_details
            .as_ref()
            .and_then(|value| value.get("percent"))
            .and_then(|value| value.as_i64()),
        Some(50)
    );
}

#[test]
fn attach_prefers_provider_binding_before_cwd_fallback() {
    let mut state = base_state(PlanMode::Guided);
    state.sessions.insert(
        "session-2".into(),
        Session {
            id: "session-2".into(),
            task_id: "task-1".into(),
            workspace_id: "ws-1".into(),
            worktree_id: Some("wt-1".into()),
            provider: Provider::Claude,
            provider_session_id: Some("provider-2".into()),
            launch_mode: SessionLaunchMode::Resume,
            state: SessionState::Running,
            current_step_id: Some("step-b".into()),
            last_activity_at: None,
            created_at: ts(0),
            updated_at: ts(0),
        },
    );
    let engine = Engine::default();

    let attachment = engine
        .attach_session(
            &mut state,
            &SessionAttachmentInput {
                provider: Provider::Claude,
                session_id: None,
                provider_session_id: Some("provider-1".into()),
                cwd: Some("/repo/.codebar/session-1".into()),
                worktree_path: Some("/repo/.codebar/session-1".into()),
            },
            &ts(10),
        )
        .expect("attachment");

    assert_eq!(attachment.session_id, "session-1");
}
