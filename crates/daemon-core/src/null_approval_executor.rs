use crate::domain::{ApprovalRequest, DomainResult, Session, Workspace, Worktree};
use crate::ports::ApprovalExecutor;

pub struct NullApprovalExecutor;

impl ApprovalExecutor for NullApprovalExecutor {
    fn execute(
        &self,
        _request: &ApprovalRequest,
        _session: &Session,
        _worktree: Option<&Worktree>,
        _workspace: Option<&Workspace>,
    ) -> DomainResult<Option<String>> {
        Ok(None)
    }
}
