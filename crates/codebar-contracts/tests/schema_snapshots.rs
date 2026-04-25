use codebar_contracts::{
    domain::{ProviderKind, Session, SessionLaunchMode, SessionState, Task, TaskStatus, VcsType, Workspace, TrustLevel},
    errors::{ErrorCode, ErrorEnvelope},
    rpc::{CreateTaskInput, SessionFileReadResult},
};

#[test]
fn snapshot_workspace_json() {
    let workspace = Workspace {
        id: "ws_123".into(),
        display_name: "CodeBar".into(),
        root_path: "/repo".into(),
        vcs_type: VcsType::Git,
        repo_identity: Some("owner/repo".into()),
        trust_level: TrustLevel::Trusted,
        default_provider: Some(ProviderKind::Claude),
        created_at: "2026-04-24T00:00:00Z".into(),
        updated_at: "2026-04-24T00:00:00Z".into(),
    };
    let json = serde_json::to_string_pretty(&workspace).unwrap();
    assert!(json.contains("displayName"));
    assert!(json.contains("rootPath"));
}

#[test]
fn snapshot_task_json() {
    let task = Task {
        id: "task_123".into(),
        workspace_id: "ws_123".into(),
        title: "Ship contracts".into(),
        prompt: "Add shared contracts".into(),
        goal: Some("Freeze API surface".into()),
        constraints: Some(vec!["stable mcp".into()]),
        requested_provider: Some(ProviderKind::Claude),
        requested_model: Some("claude-opus-4-6".into()),
        status: TaskStatus::Ready,
        active_plan_id: None,
        active_skill_profile_id: None,
        created_at: "2026-04-24T00:00:00Z".into(),
        updated_at: "2026-04-24T00:00:00Z".into(),
    };
    let json = serde_json::to_string_pretty(&task).unwrap();
    assert!(json.contains("workspaceId"));
    assert!(json.contains("requestedProvider"));
}

#[test]
fn snapshot_session_json() {
    let session = Session {
        id: "sess_123".into(),
        task_id: "task_123".into(),
        workspace_id: "ws_123".into(),
        worktree_id: Some("wt_123".into()),
        provider: ProviderKind::Claude,
        provider_session_id: Some("ext_123".into()),
        launch_mode: SessionLaunchMode::New,
        state: SessionState::Ready,
        current_step_id: None,
        last_activity_at: None,
        created_at: "2026-04-24T00:00:00Z".into(),
        updated_at: "2026-04-24T00:00:00Z".into(),
    };
    let json = serde_json::to_string_pretty(&session).unwrap();
    assert!(json.contains("providerSessionId"));
    assert!(json.contains("launchMode"));
}

#[test]
fn snapshot_error_json() {
    let error = ErrorEnvelope {
        code: ErrorCode::ApprovalRequired,
        message: "approval needed".into(),
        retryable: false,
        details: None,
    };
    let json = serde_json::to_string_pretty(&error).unwrap();
    assert!(json.contains("APPROVAL_REQUIRED"));
}

#[test]
fn snapshot_rpc_json() {
    let input = CreateTaskInput {
        workspace_id: "ws_123".into(),
        title: "Title".into(),
        prompt: "Prompt".into(),
        goal: None,
        constraints: None,
        requested_provider: Some(ProviderKind::Codex),
    };
    let result = SessionFileReadResult {
        path: "src/lib.rs".into(),
        content: "fn main() {}".into(),
        version_token: Some("1:2".into()),
        is_binary: false,
        missing: false,
    };
    let input_json = serde_json::to_string_pretty(&input).unwrap();
    let result_json = serde_json::to_string_pretty(&result).unwrap();
    assert!(input_json.contains("workspaceId"));
    assert!(result_json.contains("versionToken"));
}
