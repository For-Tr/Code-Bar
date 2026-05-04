use codebar_contracts::domain::ProviderKind;
use codebar_contracts::domain::SessionLaunchMode;
use codebar_contracts::domain::SessionState;
use daemon_core::domain::{Session, Worktree};
use daemon_core::ports::{CanonicalProviderEvent, ProviderAdapter};
use provider_codex::CodexAdapter;
use serde_json::json;

#[test]
fn replay_user_prompt_submit_binds_provider_session() {
    let adapter = CodexAdapter;
    let payload = json!({
        "code_bar_session_id": "session-1",
        "hook_event_name": "UserPromptSubmit",
        "payload": { "sessionId": "codex-session-1" }
    });

    let events = adapter.normalize_event("codex", &payload).unwrap();
    assert!(events.iter().any(|event| {
        matches!(
            event.event,
            CanonicalProviderEvent::ProviderSessionBound { .. }
        )
    }));
}

#[test]
fn replay_stop_maps_to_waiting_for_input() {
    let adapter = CodexAdapter;
    let payload = json!({
        "code_bar_session_id": "session-1",
        "hook_event_name": "Stop"
    });

    let events = adapter.normalize_event("codex", &payload).unwrap();
    assert!(events
        .iter()
        .any(|event| { matches!(event.event, CanonicalProviderEvent::WaitingForInput) }));
}

#[test]
fn replay_error_maps_to_error_event() {
    let adapter = CodexAdapter;
    let payload = json!({
        "code_bar_session_id": "session-1",
        "hook_event_name": "Error",
        "error": "boom"
    });

    let events = adapter.normalize_event("codex", &payload).unwrap();
    assert!(events
        .iter()
        .any(|event| { matches!(event.event, CanonicalProviderEvent::ErrorRaised { .. }) }));
}

#[test]
fn replay_run_exited_maps_to_exit_event() {
    let adapter = CodexAdapter;
    let payload = json!({
        "code_bar_session_id": "session-1",
        "hook_event_name": "RunExited",
        "exit_code": 0
    });

    let events = adapter.normalize_event("codex", &payload).unwrap();
    assert!(events
        .iter()
        .any(|event| { matches!(event.event, CanonicalProviderEvent::RunExited { .. }) }));
}

#[test]
fn start_spec_injects_bootstrap_and_bridge() {
    let adapter = CodexAdapter;
    let session = sample_session(ProviderKind::Codex, None);
    let worktree = sample_worktree("/tmp/worktree-codex");

    let spec = adapter
        .start(&session, Some(&worktree), Some("/tmp/workspace-root"))
        .unwrap();

    assert_eq!(spec.command, "codex");
    assert_eq!(spec.args, vec!["exec".to_string(), "--color".to_string(), "never".to_string()]);
    assert_eq!(spec.cwd, "/tmp/worktree-codex");
    assert_eq!(spec.bootstrap_prompt.is_some(), true);
    assert_eq!(spec.mcp_bridge_command.as_deref(), Some("codebar-mcp"));
    assert_eq!(
        spec.mcp_bridge_args,
        Some(vec!["--session-id".to_string(), session.id.clone()])
    );
    assert_eq!(spec.env.get("CODEBAR_PROVIDER"), Some(&"codex".to_string()));
}

#[test]
fn resume_spec_adds_provider_resume_args() {
    let adapter = CodexAdapter;
    let session = sample_session(ProviderKind::Codex, Some("codex-provider-1"));

    let spec = adapter
        .resume(&session, None, Some("/tmp/workspace-root"))
        .unwrap();

    assert_eq!(spec.command, "codex");
    assert_eq!(
        spec.args,
        vec!["resume".to_string(), "codex-provider-1".to_string()]
    );
    assert_eq!(spec.cwd, "/tmp/workspace-root");
}

fn sample_session(provider: ProviderKind, provider_session_id: Option<&str>) -> Session {
    Session {
        id: "session-1".to_string(),
        task_id: "task-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        worktree_id: Some("worktree-1".to_string()),
        provider,
        provider_session_id: provider_session_id.map(ToString::to_string),
        launch_mode: SessionLaunchMode::New,
        state: SessionState::Ready,
        current_step_id: None,
        last_activity_at: None,
        created_at: "2026-04-27T00:00:00Z".to_string(),
        updated_at: "2026-04-27T00:00:00Z".to_string(),
    }
}

fn sample_worktree(path: &str) -> Worktree {
    Worktree {
        id: "worktree-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        path: path.to_string(),
        branch_name: Some("feature/test".to_string()),
        base_branch: Some("main".to_string()),
        source: codebar_contracts::domain::WorktreeSource::Managed,
        lifecycle_state: codebar_contracts::domain::WorktreeLifecycleState::Ready,
        cleanup_policy: codebar_contracts::domain::WorktreeCleanupPolicy::Manual,
        created_at: "2026-04-27T00:00:00Z".to_string(),
        updated_at: "2026-04-27T00:00:00Z".to_string(),
    }
}
