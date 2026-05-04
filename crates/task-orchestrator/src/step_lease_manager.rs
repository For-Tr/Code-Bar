use std::sync::atomic::{AtomicU64, Ordering};

use crate::{
    model::{
        ClaimStepResult, CompleteStepResult, ErrorEnvelope, JsonMap, OrchestrationState,
        PlanStepStatus, SessionState, TaskStatus,
    },
    next_action_resolver::{has_any_runnable_step, is_step_runnable_at},
};
use serde_json::Value;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const DEFAULT_LEASE_TTL_MS: i64 = 5 * 60 * 1000;

static LEASE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpiredLease {
    pub step_id: String,
    pub owner_session_id: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct StepLeaseManager {
    pub lease_ttl_ms: i64,
}

impl StepLeaseManager {
    pub fn new(lease_ttl_ms: i64) -> Self {
        Self { lease_ttl_ms }
    }

    pub fn reap_expired(&self, state: &mut OrchestrationState, now: &str) -> Vec<ExpiredLease> {
        let mut expired = Vec::new();
        for step in state.steps.values_mut() {
            if is_lease_expired(step.lease_expires_at.as_deref(), now) {
                if let Some(owner_session_id) = step.lease_owner_session_id.clone() {
                    expired.push(ExpiredLease {
                        step_id: step.id.clone(),
                        owner_session_id,
                    });
                }
                step.lease_owner_session_id = None;
                step.lease_token = None;
                step.lease_expires_at = None;
                if matches!(
                    step.status,
                    PlanStepStatus::Claimed | PlanStepStatus::Running
                ) {
                    step.status = PlanStepStatus::Pending;
                }
                step.updated_at = now.to_string();
            }
        }
        expired
    }

    pub fn claim_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        now: &str,
    ) -> Result<ClaimStepResult, ErrorEnvelope> {
        self.reap_expired(state, now);

        let session = state
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;

        if !state.steps.contains_key(step_id) {
            return Err(ErrorEnvelope::not_found("step not found"));
        }
        if !is_step_runnable_at(state, &session, step_id, now) {
            return Err(ErrorEnvelope::conflict("step is not runnable"));
        }

        let step = state
            .steps
            .get_mut(step_id)
            .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;

        if let Some(owner) = step.lease_owner_session_id.as_deref() {
            if owner != session_id && !is_lease_expired(step.lease_expires_at.as_deref(), now) {
                return Err(ErrorEnvelope::conflict(
                    "step already claimed by another session",
                ));
            }
            if owner == session_id && !is_lease_expired(step.lease_expires_at.as_deref(), now) {
                return Ok(ClaimStepResult {
                    step_id: step.id.clone(),
                    lease_token: step.lease_token.clone().unwrap_or_default(),
                    lease_expires_at: step.lease_expires_at.clone().unwrap_or_default(),
                });
            }
        }

        let lease_token = next_lease_token(session_id, step_id);
        let lease_expires_at = add_millis_to_timestamp(now, self.lease_ttl_ms)?;
        step.status = PlanStepStatus::Claimed;
        step.lease_owner_session_id = Some(session_id.to_string());
        step.lease_token = Some(lease_token.clone());
        step.lease_expires_at = Some(lease_expires_at.clone());
        step.updated_at = now.to_string();

        if let Some(session) = state.sessions.get_mut(session_id) {
            session.current_step_id = Some(step_id.to_string());
            session.updated_at = now.to_string();
            session.state = SessionState::Running;
        }
        if let Some(task_id) = state.step_task_id(step_id) {
            if let Some(task) = state.tasks.get_mut(&task_id) {
                task.status = TaskStatus::Active;
                task.updated_at = now.to_string();
            }
        }

        Ok(ClaimStepResult {
            step_id: step_id.to_string(),
            lease_token,
            lease_expires_at,
        })
    }

    pub fn update_progress(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        lease_token: Option<&str>,
        now: &str,
        summary: &str,
        details: Option<&JsonMap>,
    ) -> Result<(), ErrorEnvelope> {
        self.reap_expired(state, now);
        validate_step_access(state, session_id, step_id, lease_token, now)?;

        let step = state
            .steps
            .get_mut(step_id)
            .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;
        if step.status == PlanStepStatus::Claimed {
            step.status = PlanStepStatus::Running;
        }
        step.progress_summary = Some(summary.to_string());
        step.progress_details = details
            .cloned()
            .map(|value| Value::Object(value.into_iter().collect()));
        step.updated_at = now.to_string();

        if let Some(session) = state.sessions.get_mut(session_id) {
            session.current_step_id = Some(step_id.to_string());
            session.state = SessionState::Running;
            session.last_activity_at = Some(now.to_string());
            session.updated_at = now.to_string();
        }

        Ok(())
    }

    pub fn complete_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        lease_token: Option<&str>,
        now: &str,
        outputs: Option<&JsonMap>,
        next_step_id: Option<String>,
    ) -> Result<CompleteStepResult, ErrorEnvelope> {
        self.reap_expired(state, now);
        validate_step_access(state, session_id, step_id, lease_token, now)?;

        let step = state
            .steps
            .get_mut(step_id)
            .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;
        step.status = PlanStepStatus::Completed;
        step.lease_owner_session_id = None;
        step.lease_token = None;
        step.lease_expires_at = None;
        step.outputs = outputs
            .cloned()
            .map(|value| Value::Object(value.into_iter().collect()));
        step.blocked_reason = None;
        step.updated_at = now.to_string();

        let task_id = state
            .step_task_id(step_id)
            .ok_or_else(|| ErrorEnvelope::not_found("task not found for step"))?;
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.current_step_id = next_step_id.clone();
            session.last_activity_at = Some(now.to_string());
            session.updated_at = now.to_string();
            if next_step_id.is_none() {
                session.state = SessionState::WaitingInput;
            }
        }

        if let Some(plan) = state.active_plan_for_task(&task_id).cloned() {
            let all_completed = state
                .steps_for_plan(&plan.id)
                .into_iter()
                .all(|candidate| candidate.status == PlanStepStatus::Completed);
            let session_snapshot = state
                .sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;
            let has_more_runnable = has_any_runnable_step(state, &session_snapshot, &task_id, now);
            if let Some(task) = state.tasks.get_mut(&task_id) {
                task.status = if all_completed {
                    TaskStatus::Completed
                } else if has_more_runnable {
                    TaskStatus::Active
                } else {
                    TaskStatus::Ready
                };
                task.updated_at = now.to_string();
            }
            if let Some(session) = state.sessions.get_mut(session_id) {
                session.state = if all_completed {
                    SessionState::Completed
                } else if has_more_runnable {
                    SessionState::Ready
                } else {
                    SessionState::WaitingInput
                };
            }
        }

        Ok(CompleteStepResult { next_step_id })
    }

    pub fn block_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        now: &str,
        reason: &str,
    ) -> Result<(), ErrorEnvelope> {
        self.reap_expired(state, now);
        let step = state
            .steps
            .get(step_id)
            .cloned()
            .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;

        if let Some(owner) = step.lease_owner_session_id.as_deref() {
            if owner != session_id && !is_lease_expired(step.lease_expires_at.as_deref(), now) {
                return Err(ErrorEnvelope::conflict(
                    "cannot block a step leased by another session",
                ));
            }
        }

        let step = state
            .steps
            .get_mut(step_id)
            .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;
        step.status = PlanStepStatus::Blocked;
        step.lease_owner_session_id = None;
        step.lease_token = None;
        step.lease_expires_at = None;
        step.blocked_reason = Some(reason.to_string());
        step.updated_at = now.to_string();

        if let Some(task_id) = state.step_task_id(step_id) {
            if let Some(task) = state.tasks.get_mut(&task_id) {
                task.status = TaskStatus::Blocked;
                task.updated_at = now.to_string();
            }
        }
        if let Some(session) = state.sessions.get_mut(session_id) {
            if session.current_step_id.as_deref() == Some(step_id) {
                session.current_step_id = None;
            }
            session.state = SessionState::WaitingInput;
            session.updated_at = now.to_string();
        }

        Ok(())
    }
}

fn validate_step_access(
    state: &OrchestrationState,
    session_id: &str,
    step_id: &str,
    lease_token: Option<&str>,
    now: &str,
) -> Result<(), ErrorEnvelope> {
    let step = state
        .steps
        .get(step_id)
        .ok_or_else(|| ErrorEnvelope::not_found("step not found"))?;

    match step.lease_owner_session_id.as_deref() {
        Some(owner) => {
            if owner != session_id && !is_lease_expired(step.lease_expires_at.as_deref(), now) {
                return Err(ErrorEnvelope::conflict("step is leased by another session"));
            }
            if owner == session_id {
                let expected = step.lease_token.as_deref().unwrap_or_default();
                let provided = lease_token.unwrap_or_default();
                if expected != provided {
                    return Err(ErrorEnvelope::conflict("lease token mismatch"));
                }
                if is_lease_expired(step.lease_expires_at.as_deref(), now) {
                    return Err(ErrorEnvelope::conflict("lease has expired"));
                }
            }
        }
        None => {
            if !is_step_runnable_at(
                state,
                state
                    .sessions
                    .get(session_id)
                    .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?,
                step_id,
                now,
            ) {
                return Err(ErrorEnvelope::conflict("step is not runnable"));
            }
        }
    }

    Ok(())
}

fn next_lease_token(session_id: &str, step_id: &str) -> String {
    let counter = LEASE_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("lease-{session_id}-{step_id}-{counter}")
}

pub(crate) fn parse_timestamp_millis(value: &str) -> Option<i128> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(number) = trimmed.parse::<i128>() {
        return Some(number);
    }
    OffsetDateTime::parse(trimmed, &Rfc3339)
        .ok()
        .map(|time| time.unix_timestamp_nanos() / 1_000_000)
}

pub(crate) fn add_millis_to_timestamp(now: &str, ttl_ms: i64) -> Result<String, ErrorEnvelope> {
    let millis = parse_timestamp_millis(now)
        .ok_or_else(|| ErrorEnvelope::invalid("invalid timestamp for lease calculation"))?;
    let expires = millis + ttl_ms as i128;
    format_timestamp_millis(expires)
}

pub(crate) fn is_lease_expired(expires_at: Option<&str>, now: &str) -> bool {
    let Some(expires_at) = expires_at else {
        return false;
    };
    match (
        parse_timestamp_millis(expires_at),
        parse_timestamp_millis(now),
    ) {
        (Some(expires), Some(now)) => expires <= now,
        _ => false,
    }
}

pub(crate) fn format_timestamp_millis(value: i128) -> Result<String, ErrorEnvelope> {
    let nanos = value
        .checked_mul(1_000_000)
        .ok_or_else(|| ErrorEnvelope::invalid("timestamp overflow"))?;
    let datetime = OffsetDateTime::from_unix_timestamp_nanos(nanos)
        .map_err(|_| ErrorEnvelope::invalid("timestamp out of range"))?;
    datetime
        .format(&Rfc3339)
        .map_err(|_| ErrorEnvelope::invalid("failed to format timestamp"))
}
