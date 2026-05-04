use daemon_core::domain::{DomainResult, ProviderKind, Session, Worktree};
use daemon_core::ports::{
    LaunchSpec, NormalizedProviderEvent, ProviderAdapter, ProviderCapabilities, ProviderDetection,
    RuntimeHost,
};
use provider_claude::ClaudeAdapter;
use provider_codex::CodexAdapter;

#[derive(Default)]
pub struct ProviderRegistry {
    claude: ClaudeAdapter,
    codex: CodexAdapter,
}

impl ProviderRegistry {
    fn by_kind(&self, provider: ProviderKind) -> &dyn ProviderAdapter {
        match provider {
            ProviderKind::Claude => &self.claude,
            ProviderKind::Codex => &self.codex,
        }
    }

    fn by_name(&self, provider: &str) -> Option<&dyn ProviderAdapter> {
        match provider {
            "claude" | "claude-code" => Some(&self.claude),
            "codex" => Some(&self.codex),
            _ => None,
        }
    }
}

impl ProviderAdapter for ProviderRegistry {
    fn detect(&self, provider: ProviderKind) -> DomainResult<ProviderDetection> {
        self.by_kind(provider).detect(provider)
    }

    fn capabilities(&self, provider: ProviderKind) -> DomainResult<ProviderCapabilities> {
        self.by_kind(provider).capabilities(provider)
    }

    fn start(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec> {
        self.by_kind(session.provider)
            .start(session, worktree, workspace_root)
    }

    fn resume(
        &self,
        session: &Session,
        worktree: Option<&Worktree>,
        workspace_root: Option<&str>,
    ) -> DomainResult<LaunchSpec> {
        self.by_kind(session.provider)
            .resume(session, worktree, workspace_root)
    }

    fn send_input(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        text: &str,
    ) -> DomainResult<()> {
        self.by_kind(session.provider)
            .send_input(session, runtime, text)
    }

    fn stop(
        &self,
        session: &Session,
        runtime: &dyn RuntimeHost,
        reason: Option<&str>,
    ) -> DomainResult<()> {
        self.by_kind(session.provider)
            .stop(session, runtime, reason)
    }

    fn bind_provider_session(
        &self,
        session: &Session,
        provider_session_id: &str,
    ) -> DomainResult<Option<String>> {
        self.by_kind(session.provider)
            .bind_provider_session(session, provider_session_id)
    }

    fn normalize_event(
        &self,
        provider: &str,
        payload: &serde_json::Value,
    ) -> DomainResult<Vec<NormalizedProviderEvent>> {
        match self.by_name(provider) {
            Some(adapter) => adapter.normalize_event(provider, payload),
            None => Ok(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderRegistry;
    use daemon_core::ports::{CanonicalProviderEvent, ProviderAdapter};
    use serde_json::json;

    #[test]
    fn normalizes_claude_alias_payloads() {
        let adapter = ProviderRegistry::default();
        let payload = json!({
            "code_bar_session_id": "session-1",
            "hook_event_name": "UserPromptSubmit",
            "session_id": "claude-session-1"
        });

        let events = adapter.normalize_event("claude", &payload).unwrap();
        assert!(events.iter().any(|event| {
            matches!(
                event.event,
                CanonicalProviderEvent::ProviderSessionBound { .. }
            )
        }));
    }

    #[test]
    fn normalizes_codex_payloads() {
        let adapter = ProviderRegistry::default();
        let payload = json!({
            "code_bar_session_id": "session-1",
            "hook_event_name": "Stop"
        });

        let events = adapter.normalize_event("codex", &payload).unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event.event, CanonicalProviderEvent::WaitingForInput)));
    }
}
