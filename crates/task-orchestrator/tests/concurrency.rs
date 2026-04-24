use std::sync::{Arc, Mutex};
use std::thread;

use task_orchestrator::{
    CleanupPolicy, Engine, OrchestrationState, Plan, PlanMode, PlanStatus, PlanStep,
    PlanStepStatus, Provider, Session, SessionLaunchMode, SessionState, Task, TaskStatus,
    TrustLevel, VcsType, Workspace, Worktree, WorktreeLifecycleState, WorktreeSource,
};

fn ts(minute: u32) -> String {
    format!("2026-04-24T13:{minute:02}:00Z")
}

fn state_with_two_sessions() -> OrchestrationState {
    let workspace = Workspace {
        id: "ws-1".into(),
        display_name: "Workspace".into(),
        root_path: "/repo".into(),
        vcs_type: VcsType::Git,
        repo_identity: None,
        trust_level: TrustLevel::Trusted,
        default_provider: Some(Provider::Claude),
        created_at: ts(0),
        updated_at: ts(0),
    };
    let worktree = Worktree {
        id: "wt-1".into(),
        workspace_id: workspace.id.clone(),
        path: "/repo/wt-1".into(),
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
        title: "Task".into(),
        prompt: "Prompt".into(),
        goal: None,
        constraints: None,
        requested_provider: Some(Provider::Claude),
        requested_model: None,
        status: TaskStatus::Ready,
        active_plan_id: Some("plan-1".into()),
        active_skill_profile_id: None,
        created_at: ts(0),
        updated_at: ts(0),
    };
    let session_1 = Session {
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
    let session_2 = Session {
        id: "session-2".into(),
        task_id: task.id.clone(),
        workspace_id: workspace.id.clone(),
        worktree_id: Some(worktree.id.clone()),
        provider: Provider::Claude,
        provider_session_id: Some("provider-2".into()),
        launch_mode: SessionLaunchMode::Resume,
        state: SessionState::Ready,
        current_step_id: None,
        last_activity_at: None,
        created_at: ts(0),
        updated_at: ts(0),
    };
    let plan = Plan {
        id: "plan-1".into(),
        task_id: task.id.clone(),
        mode: PlanMode::Guided,
        status: PlanStatus::Active,
        created_at: ts(0),
        updated_at: ts(0),
    };
    let step_a = PlanStep {
        id: "step-a".into(),
        plan_id: plan.id.clone(),
        title: "A".into(),
        description: None,
        status: PlanStepStatus::Pending,
        depends_on: vec![],
        parallelizable: false,
        required_skills: vec![],
        allowed_providers: Some(vec![Provider::Claude]),
        lease_owner_session_id: None,
        lease_token: None,
        lease_expires_at: None,
        created_at: ts(1),
        updated_at: ts(1),
    };
    let step_b = PlanStep {
        id: "step-b".into(),
        plan_id: plan.id.clone(),
        title: "B".into(),
        description: None,
        status: PlanStepStatus::Pending,
        depends_on: vec!["step-a".into()],
        parallelizable: true,
        required_skills: vec![],
        allowed_providers: Some(vec![Provider::Claude]),
        lease_owner_session_id: None,
        lease_token: None,
        lease_expires_at: None,
        created_at: ts(2),
        updated_at: ts(2),
    };

    let mut state = OrchestrationState::default();
    state.workspaces.insert(workspace.id.clone(), workspace);
    state.worktrees.insert(worktree.id.clone(), worktree);
    state.tasks.insert(task.id.clone(), task);
    state.sessions.insert(session_1.id.clone(), session_1);
    state.sessions.insert(session_2.id.clone(), session_2);
    state.plans.insert(plan.id.clone(), plan);
    state.steps.insert(step_a.id.clone(), step_a);
    state.steps.insert(step_b.id.clone(), step_b);
    state
}

#[test]
fn concurrent_claim_allows_only_one_session() {
    let state = Arc::new(Mutex::new(state_with_two_sessions()));
    let engine = Engine::default();

    let handles = ["session-1", "session-2"].into_iter().map(|session_id| {
        let state = Arc::clone(&state);
        thread::spawn(move || {
            let engine = Engine::default();
            let mut state = state.lock().unwrap();
            engine.claim_step(&mut state, session_id, Some("step-a"), &ts(10))
        })
    });

    let results = handles.map(|handle| handle.join().unwrap()).collect::<Vec<_>>();
    let success_count = results.iter().filter(|result| result.is_ok()).count();
    assert_eq!(success_count, 1);

    let locked = state.lock().unwrap();
    let step = locked.steps.get("step-a").unwrap();
    assert!(step.lease_owner_session_id.is_some());
    assert_eq!(step.status, PlanStepStatus::Claimed);
    let _ = engine;
}

#[test]
fn expired_lease_can_be_reclaimed_and_old_token_rejected() {
    let mut state = state_with_two_sessions();
    let engine = Engine::new(1_000);

    let first = engine
        .claim_step(&mut state, "session-1", Some("step-a"), &ts(10))
        .expect("first claim");
    let second = engine
        .claim_step(&mut state, "session-2", Some("step-a"), &ts(11))
        .expect("reclaim after expiry");

    assert_ne!(first.lease_token, second.lease_token);
    let err = engine
        .update_progress(
            &mut state,
            "session-1",
            "step-a",
            Some(&first.lease_token),
            "stale",
            None,
            &ts(11),
        )
        .expect_err("old token should fail");
    assert_eq!(err.code, "conflict");
}

#[test]
fn dependent_step_unlocks_once_after_completion_under_contention() {
    let mut initial = state_with_two_sessions();
    initial.steps.get_mut("step-b").unwrap().depends_on = vec!["step-a".into(), "step-x".into()];
    initial.steps.insert(
        "step-x".into(),
        PlanStep {
            id: "step-x".into(),
            plan_id: "plan-1".into(),
            title: "X".into(),
            description: None,
            status: PlanStepStatus::Pending,
            depends_on: vec![],
            parallelizable: true,
            required_skills: vec![],
            allowed_providers: Some(vec![Provider::Claude]),
            lease_owner_session_id: None,
            lease_token: None,
            lease_expires_at: None,
            created_at: ts(1),
            updated_at: ts(1),
        },
    );

    let state = Arc::new(Mutex::new(initial));
    let engine = Engine::default();

    let claim_a = {
        let mut locked = state.lock().unwrap();
        engine
            .claim_step(&mut locked, "session-1", Some("step-a"), &ts(10))
            .expect("claim a")
    };
    let claim_x = {
        let mut locked = state.lock().unwrap();
        engine
            .claim_step(&mut locked, "session-2", Some("step-x"), &ts(10))
            .expect("claim x")
    };

    let completion_handles = [
        ("session-1", "step-a", claim_a.lease_token.clone()),
        ("session-2", "step-x", claim_x.lease_token.clone()),
    ]
    .into_iter()
    .map(|(session_id, step_id, token)| {
        let state = Arc::clone(&state);
        thread::spawn(move || {
            let engine = Engine::default();
            let mut state = state.lock().unwrap();
            engine.complete_step(&mut state, session_id, step_id, Some(&token), None, &ts(11))
        })
    });

    for handle in completion_handles {
        handle.join().unwrap().expect("completion");
    }

    let claim_handles = ["session-1", "session-2"].into_iter().map(|session_id| {
        let state = Arc::clone(&state);
        thread::spawn(move || {
            let engine = Engine::default();
            let mut state = state.lock().unwrap();
            engine.claim_step(&mut state, session_id, Some("step-b"), &ts(12))
        })
    });

    let results = claim_handles.map(|handle| handle.join().unwrap()).collect::<Vec<_>>();
    let success_count = results.iter().filter(|result| result.is_ok()).count();
    assert_eq!(success_count, 1);

    let locked = state.lock().unwrap();
    let step_b = locked.steps.get("step-b").unwrap();
    assert_eq!(step_b.status, PlanStepStatus::Claimed);
    assert!(step_b.lease_owner_session_id.is_some());
}
