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

#[derive(Debug, serde::Deserialize)]
struct CodexUsageResponse {
    plan_type: Option<String>,
    rate_limit: Option<CodexRateLimit>,
    credits: Option<CodexCredits>,
}

#[derive(Debug, serde::Deserialize)]
struct CodexRateLimit {
    primary_window: Option<CodexWindow>,
    secondary_window: Option<CodexWindow>,
}

#[derive(Debug, serde::Deserialize)]
struct CodexWindow {
    used_percent: Option<i64>,
    reset_at: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
struct CodexCredits {
    has_credits: Option<bool>,
    unlimited: Option<bool>,
    balance: Option<serde_json::Value>,
}

fn fetch_codex_usage_via_http() -> RunnerUsageSnapshot {
    let auth_path = std::path::PathBuf::from(crate::util::home_dir().unwrap_or_default()).join(".codex").join("auth.json");
    let Ok(text) = std::fs::read_to_string(&auth_path) else {
        return RunnerUsageSnapshot {
            runner_type: "codex".into(),
            source: "unsupported".into(),
            auth_status: None,
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some("Codex auth.json not found".into()),
        };
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return RunnerUsageSnapshot {
            runner_type: "codex".into(),
            source: "unsupported".into(),
            auth_status: None,
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some("Failed to parse Codex auth.json".into()),
        };
    };

    let access_token = value.get("tokens").and_then(|v| v.get("access_token")).and_then(|v| v.as_str()).unwrap_or("");
    let account_id = value.get("tokens").and_then(|v| v.get("account_id")).and_then(|v| v.as_str()).unwrap_or("");
    if access_token.is_empty() {
        return RunnerUsageSnapshot {
            runner_type: "codex".into(),
            source: "unsupported".into(),
            auth_status: None,
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some("Codex access_token missing".into()),
        };
    }

    let client = match reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(err) => {
            return RunnerUsageSnapshot {
                runner_type: "codex".into(),
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
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .header("User-Agent", "Code-Bar")
        .header("ChatGPT-Account-Id", account_id)
        .send()
    {
        Ok(response) => response,
        Err(err) => {
            return RunnerUsageSnapshot {
                runner_type: "codex".into(),
                source: "unsupported".into(),
                auth_status: None,
                usage_summary: None,
                cost_summary: None,
                raw_text: None,
                last_refreshed_at: now_iso_string(),
                error: Some(format!("failed to query Codex HTTP usage: {err}")),
            }
        }
    };

    if !response.status().is_success() {
        return RunnerUsageSnapshot {
            runner_type: "codex".into(),
            source: "unsupported".into(),
            auth_status: None,
            usage_summary: None,
            cost_summary: None,
            raw_text: None,
            last_refreshed_at: now_iso_string(),
            error: Some(format!("Codex usage API returned status {}", response.status())),
        };
    }

    let parsed: CodexUsageResponse = match response.json() {
        Ok(parsed) => parsed,
        Err(err) => {
            return RunnerUsageSnapshot {
                runner_type: "codex".into(),
                source: "unsupported".into(),
                auth_status: None,
                usage_summary: None,
                cost_summary: None,
                raw_text: None,
                last_refreshed_at: now_iso_string(),
                error: Some(format!("failed to decode Codex usage json: {err}")),
            }
        }
    };

    let primary = parsed.rate_limit.as_ref().and_then(|r| r.primary_window.as_ref());
    let secondary = parsed.rate_limit.as_ref().and_then(|r| r.secondary_window.as_ref());
    let balance = parsed.credits.as_ref().and_then(|c| c.balance.as_ref()).map(|v| {
        v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string())
    }).unwrap_or_else(|| "0".into());
    let unlimited = parsed.credits.as_ref().and_then(|c| c.unlimited).unwrap_or(false);

    RunnerUsageSnapshot {
        runner_type: "codex".into(),
        source: "api".into(),
        auth_status: Some(format!("plan: {}", parsed.plan_type.unwrap_or_else(|| "unknown".into()))),
        usage_summary: Some(format!(
            "5h usage: {}%\n5h reset: {}\n7d usage: {}%\n7d reset: {}",
            primary.and_then(|p| p.used_percent).unwrap_or(0),
            primary.and_then(|p| p.reset_at).map(|v| v.to_string()).unwrap_or_else(|| "unknown".into()),
            secondary.and_then(|s| s.used_percent).unwrap_or(0),
            secondary.and_then(|s| s.reset_at).map(|v| v.to_string()).unwrap_or_else(|| "unknown".into()),
        )),
        cost_summary: Some(format!("credits: {}{}", balance, if unlimited { " (unlimited)" } else { "" })),
        raw_text: None,
        last_refreshed_at: now_iso_string(),
        error: None,
    }
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

fn refresh_runner_usage_sync(runner_type: String) -> RunnerUsageSnapshot {
    let lowered = runner_type.trim().to_ascii_lowercase();

    if lowered == "codex" {
        fetch_codex_usage_via_http()
    } else {
        fetch_claude_usage_via_headers()
    }
}

#[tauri::command]
pub async fn refresh_runner_usage(runner_type: String) -> Result<RunnerUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_runner_usage_sync(runner_type))
        .await
        .map_err(|error| format!("usage refresh task failed: {error}"))
}
