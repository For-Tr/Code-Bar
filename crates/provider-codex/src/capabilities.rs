use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, ProviderKind};
use daemon_core::ports::{ProviderCapabilities, ProviderDetection};

pub fn detect(provider: ProviderKind) -> DomainResult<ProviderDetection> {
    ensure_codex(provider)?;
    let command = "codex".to_string();
    let output = std::process::Command::new(&command)
        .arg("--version")
        .output();

    let detection = match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let version = if !stdout.is_empty() {
                Some(stdout.lines().next().unwrap_or_default().to_string())
            } else if !stderr.is_empty() {
                Some(stderr.lines().next().unwrap_or_default().to_string())
            } else {
                None
            };
            ProviderDetection {
                available: true,
                command,
                version,
            }
        }
        _ => ProviderDetection {
            available: false,
            command,
            version: None,
        },
    };

    Ok(detection)
}

pub fn capabilities(provider: ProviderKind) -> DomainResult<ProviderCapabilities> {
    ensure_codex(provider)?;
    Ok(ProviderCapabilities {
        resume_supported: true,
        hook_events_supported: true,
        approval_events_supported: false,
        mcp_bridge_supported: true,
    })
}

fn ensure_codex(provider: ProviderKind) -> DomainResult<()> {
    if provider != ProviderKind::Codex {
        return Err(ErrorEnvelope::new(
            ErrorCode::InvalidArgument,
            format!("provider-codex cannot handle provider {provider:?}"),
            false,
        ));
    }
    Ok(())
}
