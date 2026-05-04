use codebar_contracts::domain::LauncherType;
use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, ProviderKind, Session, Worktree};
use daemon_core::ports::{
    LaunchSpec, NormalizedProviderEvent, ProviderAdapter, ProviderCapabilities, ProviderDetection,
    RuntimeHost,
};
use std::collections::HashMap;

use crate::capabilities;
use crate::normalize;

#[derive(Default)]
pub struct ClaudeAdapter;

impl ProviderAdapter for ClaudeAdapter {
    fn detect(&self, provider: ProviderKind) -> DomainResult<ProviderDetection> {
        capabilities::detect(provider)
    }

    fn capabilities(&self, provider: ProviderKind) -> DomainResult<ProviderCapabilities> {
        capabilities::capabilities(provider)
    }

    fn start(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec> {
        ensure_provider(session.provider)?;
        Ok(build_spec(session, worktree, workspace_root, false))
    }

    fn resume(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec> {
        ensure_provider(session.provider)?;
        Ok(build_spec(session, worktree, workspace_root, true))
    }

    fn send_input(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        text: &str,
    ) -> DomainResult<()> {
        ensure_provider(session.provider)?;
        runtime.send_input(&session.id, text)
    }

    fn stop(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        reason: Option<&str>,
    ) -> DomainResult<()> {
        ensure_provider(session.provider)?;
        runtime.stop(&session.id, reason)
    }

    fn bind_provider_session(
        &self,
        session: &Session,
        provider_session_id: &str,
    ) -> DomainResult<Option<String>> {
        ensure_provider(session.provider)?;
        let trimmed = provider_session_id.trim();
        if trimmed.is_empty() {
            return Err(ErrorEnvelope::new(
                ErrorCode::ProviderBindingFailed,
                "providerSessionId cannot be empty",
                false,
            ));
        }
        if session.provider_session_id.as_deref() == Some(trimmed) {
            Ok(None)
        } else {
            Ok(Some(trimmed.to_string()))
        }
    }

    fn normalize_event(
        &self,
        provider: &str,
        payload: &serde_json::Value,
    ) -> DomainResult<Vec<NormalizedProviderEvent>> {
        if provider != "claude-code" && provider != "claude" {
            return Ok(Vec::new());
        }
        Ok(normalize::normalize(payload))
    }
}

fn ensure_provider(provider: ProviderKind) -> DomainResult<()> {
    if provider != ProviderKind::Claude {
        return Err(ErrorEnvelope::new(
            ErrorCode::InvalidArgument,
            format!("ClaudeAdapter cannot handle provider {provider:?}"),
            false,
        ));
    }
    Ok(())
}

fn build_spec(
    session: &Session,
    worktree: Option<&Worktree>,
    workspace_root: Option<&str>,
    resume: bool,
) -> LaunchSpec {
    let cwd = worktree
        .map(|item| item.path.clone())
        .or_else(|| workspace_root.map(ToString::to_string))
        .unwrap_or_else(|| ".".to_string());

    let args = if resume {
        session
            .provider_session_id
            .clone()
            .map(|provider_session_id| vec!["resume".to_string(), provider_session_id])
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut env = HashMap::new();
    env.insert("CODEBAR_PROVIDER".to_string(), "claude".to_string());

    LaunchSpec {
        session_id: session.id.clone(),
        provider: session.provider,
        launcher_type: LauncherType::Pty,
        command: "claude".to_string(),
        args,
        cwd,
        env,
        bootstrap_prompt: Some("Follow the active Codebar workflow step and use MCP tools for context/progress updates.".to_string()),
        user_prompt: None,
        mcp_bridge_command: Some("codebar-mcp".to_string()),
        mcp_bridge_args: Some(vec!["--session-id".to_string(), session.id.clone()]),
        provider_session_id: session.provider_session_id.clone(),
    }
}
