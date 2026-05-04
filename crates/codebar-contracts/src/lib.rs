pub const CONTRACTS_VERSION: &str = "v1";

pub mod domain;
pub mod errors;
pub mod events;
pub mod mcp;
pub mod rpc;
pub mod workflow;

pub mod v1 {
    pub use crate::domain::*;
    pub use crate::errors::*;
    pub use crate::events::*;
    pub use crate::mcp::{
        AcceptedOutput as McpAcceptedOutput, ContextGetCurrentInput, ContextGetCurrentOutput,
        ContextSessionView, ContextTaskView, ContextWorkspaceView, ContextWorktreeView,
        RecommendedSequenceItem, RecommendedSequenceItemType, SessionAttachInput,
        SessionAttachOutput, SkillArtifact, SkillArtifactType, SkillInvokeInput, SkillInvokeOutput,
        SkillListActiveInput, SkillListActiveOutput, TaskBlockStepInput, TaskCompleteStepInput,
        TaskCompleteStepOutput, TaskGetNextActionInput, TaskGetNextActionOutput,
        TaskGetNextActionStep, TaskUpdateProgressInput,
    };
    pub use crate::rpc::*;
    pub use crate::workflow::*;
}
