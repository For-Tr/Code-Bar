use mcp_bridge::{all_tools, has_tool, validate_tool_params};
use serde_json::json;

#[test]
fn registry_matches_fixed_contract_surface() {
    let names = all_tools().iter().map(|tool| tool.name).collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            "session.attach",
            "context.get_current",
            "task.get_next_action",
            "task.update_progress",
            "task.complete_step",
            "task.block_step",
            "skill.list_active",
            "skill.invoke",
        ]
    );
}

#[test]
fn unknown_tool_rejected() {
    let err = validate_tool_params("tool.unknown", &json!({})).unwrap_err();
    assert_eq!(err.code, "NOT_FOUND");
}

#[test]
fn malformed_params_rejected() {
    let err =
        validate_tool_params("task.complete_step", &json!({ "sessionId": "s1" })).unwrap_err();
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(err.message.contains("stepId"));
}

#[test]
fn session_attach_params_accept_valid_payload() {
    validate_tool_params(
        "session.attach",
        &json!({
            "provider": "claude",
            "providerSessionId": "provider-sess-1",
            "cwd": "/tmp/worktree"
        }),
    )
    .unwrap();
}

#[test]
fn registry_contains_mcp_tools() {
    assert!(has_tool("context.get_current"));
    assert!(has_tool("skill.invoke"));
}
