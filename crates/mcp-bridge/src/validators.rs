use crate::registry::has_tool;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
}

impl BridgeError {
    fn invalid_argument(message: impl Into<String>) -> Self {
        Self {
            code: "INVALID_ARGUMENT",
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "NOT_FOUND",
            message: message.into(),
        }
    }
}

pub fn validate_tool_params(tool: &str, params: &Value) -> Result<(), BridgeError> {
    if !has_tool(tool) {
        return Err(BridgeError::not_found(format!("unknown tool {tool}")));
    }

    match tool {
        "session.attach" => require_fields(params, &["provider", "cwd"]),
        "context.get_current" => require_fields(params, &["sessionId"]),
        "task.get_next_action" => require_fields(params, &["sessionId"]),
        "task.update_progress" => require_fields(params, &["sessionId", "summary"]),
        "task.complete_step" => require_fields(params, &["sessionId", "stepId"]),
        "task.block_step" => require_fields(params, &["sessionId", "stepId", "reason"]),
        "skill.list_active" => require_fields(params, &["sessionId"]),
        "skill.invoke" => require_fields(params, &["sessionId", "skill", "input"]),
        _ => Err(BridgeError::not_found(format!("unknown tool {tool}"))),
    }
}

fn require_fields(params: &Value, fields: &[&str]) -> Result<(), BridgeError> {
    let Some(object) = params.as_object() else {
        return Err(BridgeError::invalid_argument("params must be an object"));
    };

    for field in fields {
        if !object.contains_key(*field) {
            return Err(BridgeError::invalid_argument(format!(
                "missing required field {field}"
            )));
        }
    }

    Ok(())
}
