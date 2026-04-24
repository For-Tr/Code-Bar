use std::collections::BTreeMap;

use serde_json::Value;

use crate::model::{EventEnvelope, EventEntityType, EventSource};

fn payload(entries: impl IntoIterator<Item = (impl Into<String>, Value)>) -> BTreeMap<String, Value> {
    entries
        .into_iter()
        .map(|(key, value)| (key.into(), value))
        .collect()
}

pub fn event(
    id: impl Into<String>,
    entity_type: EventEntityType,
    entity_id: impl Into<String>,
    event_type: impl Into<String>,
    source: EventSource,
    created_at: impl Into<String>,
    payload: BTreeMap<String, Value>,
) -> EventEnvelope {
    EventEnvelope {
        id: id.into(),
        entity_type,
        entity_id: entity_id.into(),
        event_type: event_type.into(),
        source,
        correlation_id: None,
        payload,
        created_at: created_at.into(),
    }
}

pub fn next_action_resolved(
    session_id: &str,
    created_at: &str,
    task_id: &str,
    step_id: Option<&str>,
) -> EventEnvelope {
    event(
        format!("evt-next-action-{session_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "next_action.resolved",
        EventSource::Daemon,
        created_at,
        payload([
            ("taskId", Value::String(task_id.to_string())),
            (
                "stepId",
                step_id
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null),
            ),
        ]),
    )
}

pub fn step_claimed(
    session_id: &str,
    step_id: &str,
    lease_token: &str,
    lease_expires_at: &str,
    created_at: &str,
) -> EventEnvelope {
    event(
        format!("evt-step-claimed-{step_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "step.claimed",
        EventSource::Daemon,
        created_at,
        payload([
            ("stepId", Value::String(step_id.to_string())),
            ("leaseToken", Value::String(lease_token.to_string())),
            (
                "leaseExpiresAt",
                Value::String(lease_expires_at.to_string()),
            ),
        ]),
    )
}

pub fn step_lease_expired(step_id: &str, owner_session_id: &str, created_at: &str) -> EventEnvelope {
    event(
        format!("evt-step-lease-expired-{step_id}-{created_at}"),
        EventEntityType::Session,
        owner_session_id,
        "step.lease_expired",
        EventSource::Daemon,
        created_at,
        payload([
            ("stepId", Value::String(step_id.to_string())),
            (
                "leaseOwnerSessionId",
                Value::String(owner_session_id.to_string()),
            ),
        ]),
    )
}

pub fn step_progress_updated(
    session_id: &str,
    step_id: &str,
    created_at: &str,
    summary: &str,
) -> EventEnvelope {
    event(
        format!("evt-step-progress-{step_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "step.progress_updated",
        EventSource::Daemon,
        created_at,
        payload([
            ("stepId", Value::String(step_id.to_string())),
            ("summary", Value::String(summary.to_string())),
        ]),
    )
}

pub fn step_completed(session_id: &str, step_id: &str, created_at: &str) -> EventEnvelope {
    event(
        format!("evt-step-completed-{step_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "step.completed",
        EventSource::Daemon,
        created_at,
        payload([("stepId", Value::String(step_id.to_string()))]),
    )
}

pub fn step_blocked(session_id: &str, step_id: &str, created_at: &str, reason: &str) -> EventEnvelope {
    event(
        format!("evt-step-blocked-{step_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "step.blocked",
        EventSource::Daemon,
        created_at,
        payload([
            ("stepId", Value::String(step_id.to_string())),
            ("reason", Value::String(reason.to_string())),
        ]),
    )
}

pub fn skills_resolved(
    session_id: &str,
    created_at: &str,
    active_profile_id: Option<&str>,
    active_skills: &[String],
) -> EventEnvelope {
    event(
        format!("evt-skills-resolved-{session_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "skills.resolved",
        EventSource::Daemon,
        created_at,
        payload([
            (
                "activeSkillProfileId",
                active_profile_id
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null),
            ),
            (
                "activeSkills",
                Value::Array(active_skills.iter().cloned().map(Value::String).collect()),
            ),
        ]),
    )
}

pub fn task_attached(
    session_id: &str,
    task_id: &str,
    created_at: &str,
    provider_session_id: Option<&str>,
) -> EventEnvelope {
    event(
        format!("evt-task-attached-{session_id}-{created_at}"),
        EventEntityType::Session,
        session_id,
        "task.attached",
        EventSource::Daemon,
        created_at,
        payload([
            ("taskId", Value::String(task_id.to_string())),
            (
                "providerSessionId",
                provider_session_id
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null),
            ),
        ]),
    )
}
