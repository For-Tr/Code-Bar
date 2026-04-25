use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::{PlanMode, ProviderKind};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecommendedSequenceItemType {
    Skill,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttachInput {
    pub provider: ProviderKind,
    pub provider_session_id: Option<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttachOutput {
    pub session_id: String,
    pub task_id: String,
    pub mode: PlanMode,
    pub active_step_id: Option<String>,
    pub active_skill_profile_id: Option<String>,
    pub recommended_next_calls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextGetCurrentInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTaskView {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub goal: Option<String>,
    pub constraints: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextWorkspaceView {
    pub id: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextWorktreeView {
    pub id: String,
    pub path: String,
    pub branch_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextSessionView {
    pub id: String,
    pub provider: ProviderKind,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextGetCurrentOutput {
    pub task: ContextTaskView,
    pub workspace: ContextWorkspaceView,
    pub worktree: Option<ContextWorktreeView>,
    pub session: ContextSessionView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedSequenceItem {
    pub r#type: RecommendedSequenceItemType,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetNextActionInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetNextActionStep {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub success_criteria: Option<Vec<String>>,
    pub lease_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetNextActionOutput {
    pub mode: PlanMode,
    pub step: Option<TaskGetNextActionStep>,
    pub active_skills: Vec<String>,
    pub recommended_sequence: Option<Vec<RecommendedSequenceItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateProgressInput {
    pub session_id: String,
    pub step_id: Option<String>,
    pub lease_token: Option<String>,
    pub summary: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedOutput {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompleteStepInput {
    pub session_id: String,
    pub step_id: String,
    pub lease_token: Option<String>,
    pub summary: Option<String>,
    pub outputs: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompleteStepOutput {
    pub accepted: bool,
    pub next_step_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBlockStepInput {
    pub session_id: String,
    pub step_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillListActiveInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillListActiveOutput {
    pub active_skills: Vec<String>,
    pub preferred_skills: Option<Vec<String>>,
    pub forbidden_skills: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokeInput {
    pub session_id: String,
    pub step_id: Option<String>,
    pub skill: String,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillArtifactType {
    Text,
    Json,
    File,
    Command,
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillArtifact {
    pub r#type: SkillArtifactType,
    pub uri: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokeOutput {
    pub summary: String,
    pub result: Option<Value>,
    pub artifacts: Option<Vec<SkillArtifact>>,
}
