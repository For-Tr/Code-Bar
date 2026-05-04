use codebar_contracts::mcp as mcp_contract;
use codebar_contracts::rpc::{
    ApprovalStatus, BindProviderSessionOutput, RecordRuntimeLifecycleOutput,
};
use codebar_contracts::workflow::{
    AttachWorkflowSessionRequest, AttachWorkflowSessionResponse, BlockWorkflowStepRequest,
    ClaimWorkflowStepRequest, ClaimWorkflowStepResponse, CompleteWorkflowStepRequest,
    CompleteWorkflowStepResponse, GetWorkflowSnapshotRequest, GetWorkflowSnapshotResponse,
    UpdateWorkflowProgressRequest,
};
use codebard::rpc::{read_rpc_response, RpcRequest};
use codebard::wiring::build_daemon;
use daemon_core::domain::{ApprovalActionType, ProviderKind, TrustLevel, VcsType, Workspace};
use daemon_core::ports::WorktreeStrategy;
use daemon_core::services::{
    CreateSessionInput, CreateTaskInput, LaunchSessionInput, PrepareWorktreeInput,
    ResolveApprovalInput,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_root(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("codebard-tests-{name}-{nonce}"));
    fs::create_dir_all(&path).unwrap();
    path
}

fn workspace(root: &PathBuf) -> Workspace {
    Workspace {
        id: "ws-1".to_string(),
        display_name: "Workspace".to_string(),
        root_path: root.join("workspace").to_string_lossy().to_string(),
        vcs_type: VcsType::Git,
        repo_identity: Some("repo".to_string()),
        trust_level: TrustLevel::Trusted,
        default_provider: Some(ProviderKind::Claude),
        created_at: "2026-04-24T00:00:00Z".to_string(),
        updated_at: "2026-04-24T00:00:00Z".to_string(),
    }
}

fn sqlite_table_exists(db_path: &Path, table_name: &str) -> bool {
    let Ok(connection) = rusqlite::Connection::open(db_path) else {
        return false;
    };
    let mut statement = match connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
    {
        Ok(stmt) => stmt,
        Err(_) => return false,
    };
    let mut rows = match statement.query(rusqlite::params![table_name]) {
        Ok(rows) => rows,
        Err(_) => return false,
    };
    matches!(rows.next(), Ok(Some(_)))
}

#[tokio::test]
async fn lifecycle_persists_snapshots_and_events() {
    let root = temp_root("lifecycle");
    let daemon = build_daemon(root.clone()).unwrap();
    let workspace = workspace(&root);
    fs::create_dir_all(&workspace.root_path).unwrap();
    daemon.upsert_workspace(workspace.clone()).unwrap();

    let task = daemon
        .create_task(CreateTaskInput {
            workspace_id: workspace.id.clone(),
            title: "Build daemon".to_string(),
            prompt: "Implement daemon".to_string(),
            goal: Some("Have RPC".to_string()),
            constraints: Some(vec!["Keep RPC stable".to_string()]),
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        })
        .unwrap();
    let session = daemon
        .create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();
    let worktree = daemon
        .prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();
    let (session, run) = daemon
        .launch_session(LaunchSessionInput {
            session_id: session.id.clone(),
        })
        .unwrap();

    assert_eq!(worktree.workspace_id, workspace.id);
    assert_eq!(session.task_id, task.id);
    assert_eq!(run.session_id, session.id);

    let diagnostics = daemon
        .get_diagnostics(Some(&session.id), Some(&task.id))
        .unwrap();
    let files = diagnostics.get("files").unwrap().as_array().unwrap();
    assert!(files
        .iter()
        .any(|value| value.as_str().unwrap().ends_with("state.db")));
    assert!(files
        .iter()
        .any(|value| value.as_str().unwrap().contains("app-data/artifacts")));

    let events = daemon.list_events(Default::default()).unwrap();
    assert!(events
        .iter()
        .any(|event| event.event_type == "task.created"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "session.created"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "worktree.prepared"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "session.launched"));

    assert!(root.join("app-data/state.db").exists());
    assert!(root.join("app-data/artifacts").exists());
    assert!(sqlite_table_exists(
        &root.join("app-data/state.db"),
        "recovery_bindings"
    ));
    assert!(sqlite_table_exists(
        &root.join("app-data/state.db"),
        "audit_events"
    ));
}

#[tokio::test]
async fn approval_and_recovery_flow_work() {
    let root = temp_root("approval-recovery");
    let daemon = build_daemon(root.clone()).unwrap();
    let workspace = workspace(&root);
    fs::create_dir_all(&workspace.root_path).unwrap();
    daemon.upsert_workspace(workspace.clone()).unwrap();

    let task = daemon
        .create_task(CreateTaskInput {
            workspace_id: workspace.id.clone(),
            title: "Approval task".to_string(),
            prompt: "Do dangerous thing".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        })
        .unwrap();
    let session = daemon
        .create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();
    daemon
        .prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();
    daemon
        .launch_session(LaunchSessionInput {
            session_id: session.id.clone(),
        })
        .unwrap();

    let approval = daemon
        .approval_service
        .create_request(
            &session.id,
            ApprovalActionType::DangerousBash,
            "Need approval".to_string(),
            "dangerous action".to_string(),
            Default::default(),
        )
        .unwrap();
    let session_after_approval = daemon.get_session(&session.id).unwrap();
    assert_eq!(
        session_after_approval.state,
        daemon_core::domain::SessionState::ApprovalRequired
    );

    let approval_id = approval.id.clone();
    let resolved = daemon
        .resolve_approval(daemon_core::services::ResolveApprovalInput {
            approval_request_id: approval.id,
            decision: daemon_core::domain::ApprovalStatus::Approved,
        })
        .unwrap();
    assert_eq!(resolved.status, ApprovalStatus::Approved);
    let approval_events = daemon.list_events(Default::default()).unwrap();
    let resolved_event = approval_events
        .iter()
        .rev()
        .find(|event| event.event_type == "approval.resolved" && event.entity_id == approval_id)
        .unwrap();
    assert!(resolved_event.payload.get("approval").is_some());

    daemon
        .stop_session(daemon_core::services::StopSessionInput {
            session_id: session.id.clone(),
            reason: Some("simulate crash".to_string()),
        })
        .unwrap();
    let recovered = daemon.recovery.recover().unwrap();
    assert!(recovered.is_empty());

    let db = rusqlite::Connection::open(root.join("app-data/state.db")).unwrap();
    let mut stmt = db
        .prepare("SELECT provider_session_id, worktree_path, run_attempt_id FROM recovery_bindings WHERE session_id = ?1")
        .unwrap();
    let (provider_session_id, worktree_path, run_attempt_id): (
        Option<String>,
        Option<String>,
        Option<String>,
    ) = stmt
        .query_row(rusqlite::params![session.id.clone()], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .unwrap();
    assert_eq!(provider_session_id, None);
    assert!(worktree_path.is_some());
    assert!(run_attempt_id.is_some());

    let mut count_stmt = db
        .prepare("SELECT COUNT(*) FROM audit_events WHERE entity_id = ?1")
        .unwrap();
    let audit_count: i64 = count_stmt
        .query_row(rusqlite::params![session.id], |row| row.get(0))
        .unwrap();
    assert!(audit_count > 0);
}

#[tokio::test]
async fn rpc_session_outputs_use_contract_shape() {
    let root = temp_root("rpc-session-shape");
    let daemon = build_daemon(root.clone()).unwrap();
    let workspace = workspace(&root);
    fs::create_dir_all(&workspace.root_path).unwrap();
    daemon.upsert_workspace(workspace.clone()).unwrap();

    let task = daemon
        .create_task(CreateTaskInput {
            workspace_id: workspace.id.clone(),
            title: "Shape task".to_string(),
            prompt: "Check session shapes".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        })
        .unwrap();
    let session = daemon
        .create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();

    let get_workspace_response = daemon.handle_request(RpcRequest {
        id: Some("workspace-get-1".to_string()),
        method: "getWorkspace".to_string(),
        params: json!({
            "workspaceId": workspace.id,
        }),
    });
    assert!(get_workspace_response.ok);
    let get_workspace_payload: codebar_contracts::rpc::GetWorkspaceOutput =
        serde_json::from_value(get_workspace_response.result.unwrap()).unwrap();
    assert_eq!(get_workspace_payload.workspace.id, workspace.id);

    let list_workspaces_response = daemon.handle_request(RpcRequest {
        id: Some("workspace-list-1".to_string()),
        method: "listWorkspaces".to_string(),
        params: json!({}),
    });
    assert!(list_workspaces_response.ok);
    let list_workspaces_payload: codebar_contracts::rpc::ListWorkspacesOutput =
        serde_json::from_value(list_workspaces_response.result.unwrap()).unwrap();
    assert!(list_workspaces_payload
        .workspaces
        .iter()
        .any(|item| item.id == workspace.id));

    let bind_response = daemon.handle_request(RpcRequest {
        id: Some("bind-1".to_string()),
        method: "bindProviderSession".to_string(),
        params: json!({
            "sessionId": session.id,
            "providerSessionId": "ext_123",
        }),
    });
    assert!(bind_response.ok);
    let bind_payload: BindProviderSessionOutput =
        serde_json::from_value(bind_response.result.unwrap()).unwrap();
    assert_eq!(
        bind_payload.session.provider_session_id.as_deref(),
        Some("ext_123")
    );

    let session_id = bind_payload.session.id.clone();

    let prepared_worktree = daemon
        .prepare_worktree(PrepareWorktreeInput {
            session_id: session_id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();

    let get_worktree_response = daemon.handle_request(RpcRequest {
        id: Some("worktree-get-1".to_string()),
        method: "getWorktree".to_string(),
        params: json!({
            "worktreeId": prepared_worktree.id,
        }),
    });
    assert!(get_worktree_response.ok);
    let get_worktree_payload: codebar_contracts::rpc::GetWorktreeOutput =
        serde_json::from_value(get_worktree_response.result.unwrap()).unwrap();
    assert_eq!(get_worktree_payload.worktree.id, prepared_worktree.id);

    let list_worktrees_response = daemon.handle_request(RpcRequest {
        id: Some("worktree-list-1".to_string()),
        method: "listWorktrees".to_string(),
        params: json!({
            "workspaceId": workspace.id,
        }),
    });
    assert!(list_worktrees_response.ok);
    let list_worktrees_payload: codebar_contracts::rpc::ListWorktreesOutput =
        serde_json::from_value(list_worktrees_response.result.unwrap()).unwrap();
    assert!(list_worktrees_payload
        .worktrees
        .iter()
        .any(|item| item.id == prepared_worktree.id));

    let lifecycle_response = daemon.handle_request(RpcRequest {
        id: Some("lifecycle-1".to_string()),
        method: "recordRuntimeLifecycle".to_string(),
        params: json!({
            "sessionId": session_id,
            "eventType": "running",
            "message": "runtime started",
        }),
    });
    assert!(lifecycle_response.ok);
    let lifecycle_payload: RecordRuntimeLifecycleOutput =
        serde_json::from_value(lifecycle_response.result.unwrap()).unwrap();
    assert_eq!(
        lifecycle_payload.session.state,
        codebar_contracts::domain::SessionState::Running
    );
}

#[tokio::test]
async fn workflow_rpc_roundtrip_persists_runtime_fields() {
    let root = temp_root("workflow-rpc");
    let daemon = build_daemon(root.clone()).unwrap();
    let workspace = workspace(&root);
    fs::create_dir_all(&workspace.root_path).unwrap();
    daemon.upsert_workspace(workspace.clone()).unwrap();

    let task = daemon
        .create_task(CreateTaskInput {
            workspace_id: workspace.id.clone(),
            title: "Workflow task".to_string(),
            prompt: "Exercise workflow RPC".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        })
        .unwrap();
    let session = daemon
        .create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();
    let worktree = daemon
        .prepare_worktree(PrepareWorktreeInput {
            session_id: session.id.clone(),
            strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();

    let attach = daemon
        .attach_workflow_session(AttachWorkflowSessionRequest {
            provider: codebar_contracts::workflow::TaskDagProvider::ClaudeCode,
            session_id: Some(session.id.clone()),
            provider_session_id: None,
            cwd: Some(worktree.path.clone()),
            worktree_path: Some(worktree.path.clone()),
            workspace_id: Some(workspace.id.clone()),
            workspace_name: Some(workspace.display_name.clone()),
            workspace_path: Some(workspace.root_path.clone()),
            session_name: Some("Workflow Session".to_string()),
            current_task: Some(task.prompt.clone()),
            branch_name: worktree.branch_name.clone(),
            base_branch: worktree.base_branch.clone(),
            session_status: Some("idle".to_string()),
        })
        .unwrap();
    assert_eq!(attach.task_id, task.id);

    let snapshot = daemon
        .get_workflow_snapshot(GetWorkflowSnapshotRequest {
            task_id: task.id.clone(),
            session_id: Some(session.id.clone()),
            include_events: Some(true),
            include_diagnostics: Some(true),
        })
        .unwrap();
    let step_id = snapshot
        .document
        .nodes
        .iter()
        .find_map(|node| match node {
            codebar_contracts::workflow::TaskDagNode::Step(step) => Some(step.step_id.clone()),
            _ => None,
        })
        .expect("step id");

    let claim: ClaimWorkflowStepResponse = daemon
        .claim_workflow_step(ClaimWorkflowStepRequest {
            session_id: session.id.clone(),
            step_id: Some(step_id.clone()),
        })
        .unwrap();

    daemon
        .update_workflow_progress(UpdateWorkflowProgressRequest {
            session_id: session.id.clone(),
            step_id: step_id.clone(),
            lease_token: Some(claim.lease_token.clone()),
            summary: "halfway".to_string(),
            details: Some(std::collections::BTreeMap::from([(
                "percent".to_string(),
                json!(50),
            )])),
        })
        .unwrap();

    let complete: CompleteWorkflowStepResponse = daemon
        .complete_workflow_step(CompleteWorkflowStepRequest {
            session_id: session.id.clone(),
            step_id: step_id.clone(),
            lease_token: Some(claim.lease_token.clone()),
            outputs: Some(std::collections::BTreeMap::from([(
                "artifact".to_string(),
                json!("done"),
            )])),
        })
        .unwrap();
    assert!(complete.next_step_id.is_none());

    let snapshot: GetWorkflowSnapshotResponse = daemon
        .get_workflow_snapshot(GetWorkflowSnapshotRequest {
            task_id: task.id.clone(),
            session_id: Some(session.id.clone()),
            include_events: Some(true),
            include_diagnostics: Some(true),
        })
        .unwrap();
    let step_node = snapshot
        .document
        .nodes
        .iter()
        .find_map(|node| match node {
            codebar_contracts::workflow::TaskDagNode::Step(step)
                if step.step_id == claim.step_id =>
            {
                Some(step)
            }
            _ => None,
        })
        .expect("step node");
    assert_eq!(
        step_node
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.latest_progress_summary.as_deref()),
        Some("halfway")
    );
    assert_eq!(
        step_node
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.progress_details.as_ref())
            .and_then(|details| details.get("percent"))
            .and_then(|value| value.as_i64()),
        Some(50)
    );
    assert_eq!(
        step_node
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.outputs.as_ref())
            .and_then(|outputs| outputs.get("artifact"))
            .and_then(|value| value.as_str()),
        Some("done")
    );

    daemon
        .block_workflow_step(BlockWorkflowStepRequest {
            session_id: session.id.clone(),
            step_id: claim.step_id.clone(),
            reason: "needs input".to_string(),
        })
        .unwrap_or(());
}

#[tokio::test]
async fn next_action_and_rpc_roundtrip_work() {
    let root = temp_root("rpc-roundtrip");
    let daemon = build_daemon(root.clone()).unwrap();
    let workspace = workspace(&root);
    fs::create_dir_all(&workspace.root_path).unwrap();
    daemon.upsert_workspace(workspace.clone()).unwrap();

    let task = daemon
        .create_task(CreateTaskInput {
            workspace_id: workspace.id.clone(),
            title: "RPC task".to_string(),
            prompt: "Test RPC".to_string(),
            goal: None,
            constraints: None,
            requested_provider: Some(codebar_contracts::domain::ProviderKind::Claude),
        })
        .unwrap();
    let session = daemon
        .create_session(CreateSessionInput {
            task_id: task.id.clone(),
            provider: codebar_contracts::domain::ProviderKind::Claude,
            worktree_strategy: codebar_contracts::rpc::WorktreeStrategy::NewManaged,
        })
        .unwrap();

    let next_action = daemon.get_next_action(&session.id).unwrap();
    assert_eq!(
        next_action["recommendedNextCalls"],
        json!(["task.get_next_action"])
    );

    #[cfg(unix)]
    {
        let socket_path = daemon.socket_path();
        let session_id = session.id.clone();
        let server = tokio::spawn(async move {
            codebard::rpc::serve(daemon).await.unwrap();
        });

        for _ in 0..20 {
            if socket_path.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let response = read_rpc_response(
            &socket_path,
            &RpcRequest {
                id: Some("1".to_string()),
                method: "health.check".to_string(),
                params: json!({}),
            },
        )
        .await
        .unwrap();
        assert!(response.ok);
        assert_eq!(response.result.unwrap()["ready"], json!(true));

        let attach_response = read_rpc_response(
            &socket_path,
            &RpcRequest {
                id: Some("2".to_string()),
                method: "session.attach".to_string(),
                params: json!({
                    "provider": "claude",
                    "providerSessionId": null,
                    "cwd": workspace.root_path,
                }),
            },
        )
        .await
        .unwrap();
        assert!(attach_response.ok);
        let attach_out: mcp_contract::SessionAttachOutput =
            serde_json::from_value(attach_response.result.unwrap()).unwrap();
        assert!(!attach_out.task_id.is_empty());
        assert!(attach_out
            .recommended_next_calls
            .contains(&"context.get_current".to_string()));

        let next_response = read_rpc_response(
            &socket_path,
            &RpcRequest {
                id: Some("3".to_string()),
                method: "task.get_next_action".to_string(),
                params: json!({ "sessionId": session_id }),
            },
        )
        .await
        .unwrap();
        assert!(next_response.ok);
        let next_out: mcp_contract::TaskGetNextActionOutput =
            serde_json::from_value(next_response.result.unwrap()).unwrap();
        assert!(next_out.recommended_sequence.is_some());

        let skill_list_response = read_rpc_response(
            &socket_path,
            &RpcRequest {
                id: Some("4".to_string()),
                method: "skill.list_active".to_string(),
                params: json!({ "sessionId": session.id }),
            },
        )
        .await
        .unwrap();
        assert!(skill_list_response.ok);
        let _skill_list_out: mcp_contract::SkillListActiveOutput =
            serde_json::from_value(skill_list_response.result.unwrap()).unwrap();

        let bad_invoke_response = read_rpc_response(
            &socket_path,
            &RpcRequest {
                id: Some("5".to_string()),
                method: "skill.invoke".to_string(),
                params: json!({
                    "sessionId": session.id,
                    "stepId": null,
                    "skill": "not-active",
                    "input": {"target": "x"},
                }),
            },
        )
        .await
        .unwrap();
        assert!(!bad_invoke_response.ok);

        server.abort();
    }
}
