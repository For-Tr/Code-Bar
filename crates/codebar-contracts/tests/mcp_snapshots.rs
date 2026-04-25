use codebar_contracts::mcp::{
    RecommendedSequenceItem, RecommendedSequenceItemType, SessionAttachInput, SessionAttachOutput,
    SkillArtifact, SkillArtifactType, SkillInvokeInput, SkillInvokeOutput, TaskGetNextActionInput,
    TaskGetNextActionOutput, TaskGetNextActionStep,
};
use codebar_contracts::domain::{PlanMode, ProviderKind};
use serde_json::json;

#[test]
fn snapshot_session_attach_json() {
    let input = SessionAttachInput {
        provider: ProviderKind::Claude,
        provider_session_id: Some("provider_sess_123".into()),
        cwd: "/workspace/repo".into(),
    };
    let output = SessionAttachOutput {
        session_id: "sess_123".into(),
        task_id: "task_123".into(),
        mode: PlanMode::Guided,
        active_step_id: Some("step_001".into()),
        active_skill_profile_id: Some("skill_001".into()),
        recommended_next_calls: vec!["context.get_current".into(), "task.get_next_action".into()],
    };
    let payload = json!({ "input": input, "output": output });
    let serialized = serde_json::to_string_pretty(&payload).unwrap();
    assert!(serialized.contains("recommendedNextCalls"));
    assert!(serialized.contains("providerSessionId"));
}

#[test]
fn snapshot_task_get_next_action_json() {
    let input = TaskGetNextActionInput {
        session_id: "sess_123".into(),
    };
    let output = TaskGetNextActionOutput {
        mode: PlanMode::Guided,
        step: Some(TaskGetNextActionStep {
            id: "step_001".into(),
            title: "Freeze contracts".into(),
            description: Some("Define shared task and session models".into()),
            success_criteria: Some(vec!["Rust and TS types align".into(), "Snapshots updated".into()]),
            lease_token: Some("lease_123".into()),
        }),
        active_skills: vec!["contracts".into(), "tests".into()],
        recommended_sequence: Some(vec![
            RecommendedSequenceItem { r#type: RecommendedSequenceItemType::Tool, name: "context.get_current".into() },
            RecommendedSequenceItem { r#type: RecommendedSequenceItemType::Tool, name: "task.update_progress".into() },
            RecommendedSequenceItem { r#type: RecommendedSequenceItemType::Skill, name: "contracts.generate".into() },
        ]),
    };
    let payload = json!({ "input": input, "output": output });
    let serialized = serde_json::to_string_pretty(&payload).unwrap();
    assert!(serialized.contains("recommendedSequence"));
    assert!(serialized.contains("successCriteria"));
}

#[test]
fn snapshot_skill_invoke_json() {
    let input = SkillInvokeInput {
        session_id: "sess_123".into(),
        step_id: Some("step_001".into()),
        skill: "contracts.generate".into(),
        input: json!({ "target": "domain" }),
    };
    let output = SkillInvokeOutput {
        summary: "Generated shared contract artifacts".into(),
        result: Some(json!({
            "files": [
                "crates/codebar-contracts/src/domain.rs",
                "packages/contracts/src/domain.ts"
            ]
        })),
        artifacts: Some(vec![
            SkillArtifact {
                r#type: SkillArtifactType::File,
                uri: Some("file:///workspace/repo/crates/codebar-contracts/src/domain.rs".into()),
                text: None,
            },
            SkillArtifact {
                r#type: SkillArtifactType::File,
                uri: Some("file:///workspace/repo/packages/contracts/src/domain.ts".into()),
                text: None,
            },
        ]),
    };
    let payload = json!({ "input": input, "output": output });
    let serialized = serde_json::to_string_pretty(&payload).unwrap();
    assert!(serialized.contains("contracts.generate"));
    assert!(serialized.contains("artifacts"));
}
