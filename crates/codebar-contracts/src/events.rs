use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventEntityType {
    Task,
    Session,
    Run,
    Worktree,
    Approval,
    ToolCall,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    Desktop,
    Daemon,
    Mcp,
    Provider,
    Launcher,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub id: String,
    pub entity_type: EventEntityType,
    pub entity_id: String,
    pub event_type: String,
    pub source: EventSource,
    pub correlation_id: Option<String>,
    pub payload: Value,
    pub created_at: String,
}
