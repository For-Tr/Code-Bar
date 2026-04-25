use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub enum HookBridgeProvider {
    ClaudeCode,
    Codex,
}

impl HookBridgeProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
        }
    }
}

pub fn forward_provider_hook_to_daemon(provider: HookBridgeProvider, payload: &Value) -> Option<String> {
    let result = crate::daemon_bridge::daemon_forward_provider_hook(
        provider.as_str().to_string(),
        payload.clone(),
    )
    .ok()?;
    result
        .get("providerSessionId")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}
