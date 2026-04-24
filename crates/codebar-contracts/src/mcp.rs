use serde::{Deserialize, Serialize};

use crate::domain::{PlanMode, ProviderKind};

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
