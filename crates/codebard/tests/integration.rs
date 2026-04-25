use codebard::rpc::{read_rpc_response, RpcRequest};
use codebard::wiring::build_daemon;
use daemon_core::domain::{ApprovalActionType, ProviderKind, TrustLevel, VcsType, Workspace};
use daemon_core::ports::WorktreeStrategy;
use daemon_core::services::{CreateSessionInput, CreateTaskInput, LaunchSessionInput, PrepareWorktreeInput, ResolveApprovalInput};
use codebar_contracts::rpc::{ApprovalDecision, ApprovalStatus};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
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

    let diagnostics = daemon.get_diagnostics(Some(&session.id), Some(&task.id)).unwrap();
    let files = diagnostics.get("files").unwrap().as_array().unwrap();
    assert!(files.iter().any(|value| value.as_str().unwrap().ends_with("tasks.json")));
    assert!(files.iter().any(|value| value.as_str().unwrap().ends_with("events.jsonl")));

    let events = daemon.list_events(Default::default()).unwrap();
    assert!(events.iter().any(|event| event.event_type == "task.created"));
    assert!(events.iter().any(|event| event.event_type == "session.created"));
    assert!(events.iter().any(|event| event.event_type == "worktree.prepared"));
    assert!(events.iter().any(|event| event.event_type == "session.launched"));

    assert!(root.join("tasks.json").exists());
    assert!(root.join("sessions.json").exists());
    assert!(root.join("worktrees.json").exists());
    assert!(root.join("run_attempts.json").exists());
    assert!(root.join("events.jsonl").exists());
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
    assert_eq!(session_after_approval.state, daemon_core::domain::SessionState::ApprovalRequired);

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

    daemon.stop_session(daemon_core::services::StopSessionInput {
        session_id: session.id.clone(),
        reason: Some("simulate crash".to_string()),
    }).unwrap();
    let recovered = daemon.recovery.recover().unwrap();
    assert!(recovered.is_empty());
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

    let bind_response = daemon.handle_request(RpcRequest {
        id: Some("bind-1".to_string()),
        method: "bindProviderSession".to_string(),
        params: json!({
            "sessionId": session.id,
            "providerSessionId": "ext_123",
        }),
    });
    assert!(bind_response.ok);
    let bind_payload = bind_response.result.unwrap();
    let bind_session = bind_payload.get("session").unwrap();
    assert_eq!(bind_session.get("providerSessionId"), Some(&json!("ext_123")));
    assert!(bind_session.get("recoveryNote").is_none());

    let session_id = String::from(bind_session.get("id").and_then(|v| v.as_str()).unwrap_or_default());
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
    let lifecycle_payload = lifecycle_response.result.unwrap();
    let lifecycle_session = lifecycle_payload.get("session").unwrap();
    assert_eq!(lifecycle_session.get("state"), Some(&json!("running")));
    assert!(lifecycle_session.get("recoveryNote").is_none());
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
        json!(["prepareWorktree"])
    );

    #[cfg(unix)]
    {
        let socket_path = daemon.socket_path();
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
        server.abort();
    }
}
