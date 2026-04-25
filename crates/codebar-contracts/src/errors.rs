use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidArgument,
    NotFound,
    ApprovalRequired,
    ApprovalRejected,
    ProviderBindingFailed,
    GitOperationFailed,
    FileVersionConflict,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub details: Option<Value>,
}

impl ErrorEnvelope {
    pub fn new(code: ErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}
