use serde::Serialize;

use crate::util::background_command;

#[derive(Debug, serde::Serialize)]
struct ClaudeMessageRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: [ClaudeMessage<'a>; 1],
}

#[derive(Debug, serde::Serialize)]
struct ClaudeMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunnerUsageSnapshot {
    pub runner_type: String,
    pub source: String,
    pub auth_status: Option<String>,
    pub usage_summary: Option<String>,
    pub cost_summary: Option<String>,
    pub raw_text: Option<String>,
    pub last_refreshed_at: String,
    pub error: Option<String>,
}

fn now_iso_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

fn parse_header_f64(response: &reqwest::blocking::Response, name: &str) -> Option<f64> {
    response.headers().get(name)?.to_str().ok()?.parse::<f64>().ok()
}

fn format_timestamp(ts: f64) -> String {
    format!("{ts:.0}")
}

fn fetch_claude_usage_via_headers() -> RunnerUsageSnapshot {
    let api_key = std::env::var("ANTHROPIC_API_KEY").ok().filter(|v| !v.trim().is_empty());
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://api.anthropic.com".to_string());

    let Some(api_key) = api_key else {
        return RunnerUsageSnapshot {
            runner_type: "claude-code".into(),
            source: "unsupported".into(),
            auth_status: Some("Claude auth 当前来自本地 API key 环境。".into()),
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some("ANTHROPIC_API_KEY not found in environment".into()),
        };
    };

    let endpoint = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let request = ClaudeMessageRequest {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [ClaudeMessage { role: "user", content: "hi" }],
    };

    let client = match reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(err) => {
            return RunnerUsageSnapshot {
                runner_type: "claude-code".into(),
                source: "unsupported".into(),
                auth_status: None,
                usage_summary: None,
                cost_summary: None,
                raw_text: None,
                last_refreshed_at: now_iso_string(),
                error: Some(format!("failed to build reqwest client: {err}")),
            }
        }
    };

    let response = match client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&request)
        .send()
    {
        Ok(response) => response,
        Err(err) => {
            return RunnerUsageSnapshot {
                runner_type: "claude-code".into(),
                source: "unsupported".into(),
                auth_status: None,
                usage_summary: None,
                cost_summary: None,
                raw_text: None,
                last_refreshed_at: now_iso_string(),
                error: Some(format!("failed to query Claude API: {err}")),
            }
        }
    };

    if !response.status().is_success() {
        return RunnerUsageSnapshot {
            runner_type: "claude-code".into(),
            source: "unsupported".into(),
            auth_status: None,
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some(format!("Claude API returned status {}", response.status())),
        };
    }

    let five_hour = parse_header_f64(&response, "anthropic-ratelimit-unified-5h-utilization").map(|v| v * 100.0);
    let five_hour_reset = parse_header_f64(&response, "anthropic-ratelimit-unified-5h-reset");
    let weekly = parse_header_f64(&response, "anthropic-ratelimit-unified-7d-utilization").map(|v| v * 100.0);
    let weekly_reset = parse_header_f64(&response, "anthropic-ratelimit-unified-7d-reset");

    let usage_summary = Some(format!(
        "5h usage: {}\n5h reset: {}\n7d usage: {}\n7d reset: {}",
        five_hour.map(|v| format!("{v:.1}%")).unwrap_or_else(|| "unknown".into()),
        five_hour_reset.map(format_timestamp).unwrap_or_else(|| "unknown".into()),
        weekly.map(|v| format!("{v:.1}%")).unwrap_or_else(|| "unknown".into()),
        weekly_reset.map(format_timestamp).unwrap_or_else(|| "unknown".into()),
    ));

    RunnerUsageSnapshot {
        runner_type: "claude-code".into(),
        source: "api".into(),
        auth_status: Some("Claude usage derived from Anthropic API rate-limit headers.".into()),
        usage_summary,
        cost_summary: None,
        raw_text: None,
        last_refreshed_at: now_iso_string(),
        error: None,
    }
}

#[tauri::command]
pub fn refresh_runner_usage(runner_type: String) -> RunnerUsageSnapshot {
    let lowered = runner_type.trim().to_ascii_lowercase();

    if lowered == "codex" {
        match background_command("codex").args(["login", "status"]).output() {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                RunnerUsageSnapshot {
                    runner_type: "codex".into(),
                    source: "cli".into(),
                    auth_status: if text.is_empty() { None } else { Some(text.clone()) },
                    usage_summary: if text.is_empty() { Some("Codex 暂未提供剩余额度接口，当前仅展示登录状态。".into()) } else { Some(text.clone()) },
                    cost_summary: None,
                    raw_text: if text.is_empty() { None } else { Some(text) },
                    last_refreshed_at: now_iso_string(),
                    error: None,
                }
            }
            Err(err) => RunnerUsageSnapshot {
                runner_type: "codex".into(),
                source: "unsupported".into(),
                auth_status: None,
                usage_summary: None,
                cost_summary: None,
                raw_text: None,
                last_refreshed_at: now_iso_string(),
                error: Some(format!("failed to query codex status: {err}")),
            },
        }
    } else {
        fetch_claude_usage_via_headers()
    }
}
