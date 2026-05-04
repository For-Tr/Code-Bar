use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{
    ApprovalActionType, ApprovalRequest, DomainResult, Session, Workspace, Worktree,
};
use daemon_core::ports::ApprovalExecutor;
use std::process::Command;

pub struct GitApprovalExecutor;

impl ApprovalExecutor for GitApprovalExecutor {
    fn execute(
        &self,
        request: &ApprovalRequest,
        _session: &Session,
        worktree: Option<&Worktree>,
        workspace: Option<&Workspace>,
    ) -> DomainResult<Option<String>> {
        let workdir = worktree
            .map(|worktree| worktree.path.clone())
            .or_else(|| workspace.map(|workspace| workspace.root_path.clone()))
            .ok_or_else(|| {
                ErrorEnvelope::new(
                    ErrorCode::GitOperationFailed,
                    "missing workdir context",
                    true,
                )
            })?;

        match request.action_type {
            ApprovalActionType::Write => {
                let message = request
                    .payload
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .trim();
                if message.is_empty() {
                    return Ok(Some("approved write action: no-op".to_string()));
                }
                let output = Command::new("git")
                    .current_dir(&workdir)
                    .args(["commit", "-m", message])
                    .output()
                    .map_err(|error| {
                        ErrorEnvelope::new(ErrorCode::GitOperationFailed, error.to_string(), true)
                    })?;
                if !output.status.success() {
                    return Err(ErrorEnvelope::new(
                        ErrorCode::GitOperationFailed,
                        String::from_utf8_lossy(&output.stderr).trim().to_string(),
                        true,
                    ));
                }
                Ok(Some(format!("approved write action: {message}")))
            }
            ApprovalActionType::Delete => {
                let path = request
                    .payload
                    .get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .trim();
                let mode = request
                    .payload
                    .get("mode")
                    .and_then(|value| value.as_str())
                    .unwrap_or("unstaged");
                if path.is_empty() {
                    return Ok(Some("approved delete action: no-op".to_string()));
                }
                let args: Vec<&str> = match mode {
                    "untracked" => vec!["clean", "-fd", "--", path],
                    "staged" => vec![
                        "restore",
                        "--staged",
                        "--worktree",
                        "--source=HEAD",
                        "--",
                        path,
                    ],
                    _ => vec!["restore", "--worktree", "--", path],
                };
                let output = Command::new("git")
                    .current_dir(&workdir)
                    .args(args)
                    .output()
                    .map_err(|error| {
                        ErrorEnvelope::new(ErrorCode::GitOperationFailed, error.to_string(), true)
                    })?;
                if !output.status.success() {
                    return Err(ErrorEnvelope::new(
                        ErrorCode::GitOperationFailed,
                        String::from_utf8_lossy(&output.stderr).trim().to_string(),
                        true,
                    ));
                }
                Ok(Some(format!("approved delete action: {path}")))
            }
            _ => Ok(None),
        }
    }
}
