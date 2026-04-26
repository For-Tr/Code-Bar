pub const CONTRACTS_VERSION: &str = "v1";

pub mod domain;
pub mod errors;
pub mod events;
pub mod mcp;
pub mod provider_adapter;
pub mod rpc;
pub mod workflow;

pub use provider_adapter::ProviderAdapter;

pub mod v1 {
    pub use crate::domain::*;
    pub use crate::errors::*;
    pub use crate::events::*;
    pub use crate::mcp::{
        ContextGetCurrentInput, ContextGetCurrentOutput, ContextSessionView, ContextTaskView,
        ContextWorkspaceView, ContextWorktreeView, AcceptedOutput as McpAcceptedOutput, RecommendedSequenceItem,
        RecommendedSequenceItemType, SessionAttachInput, SessionAttachOutput, SkillArtifact,
        SkillArtifactType, SkillInvokeInput, SkillInvokeOutput, SkillListActiveInput,
        SkillListActiveOutput, TaskBlockStepInput, TaskCompleteStepInput,
        TaskCompleteStepOutput, TaskGetNextActionInput, TaskGetNextActionOutput,
        TaskGetNextActionStep, TaskUpdateProgressInput,
    };
    pub use crate::provider_adapter::*;
    pub use crate::rpc::*;
    pub use crate::workflow::*;
}
