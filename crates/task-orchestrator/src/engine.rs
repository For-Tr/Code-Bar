use crate::{
    events,
    model::{
        ClaimStepResult, CompleteStepResult, ErrorEnvelope, JsonMap, NextActionView,
        OrchestrationState, ResolvedSkills, SessionAttachment,
    },
    next_action_resolver::NextActionResolver,
    skill_profile_resolver::SkillProfileResolver,
    step_lease_manager::{StepLeaseManager, DEFAULT_LEASE_TTL_MS},
    task_attach_resolver::TaskAttachResolver,
};

#[derive(Debug, Clone, Copy)]
pub struct Engine {
    next_action_resolver: NextActionResolver,
    step_lease_manager: StepLeaseManager,
    skill_profile_resolver: SkillProfileResolver,
    task_attach_resolver: TaskAttachResolver,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(DEFAULT_LEASE_TTL_MS)
    }
}

impl Engine {
    pub fn new(lease_ttl_ms: i64) -> Self {
        Self {
            next_action_resolver: NextActionResolver::new(),
            step_lease_manager: StepLeaseManager::new(lease_ttl_ms),
            skill_profile_resolver: SkillProfileResolver,
            task_attach_resolver: TaskAttachResolver,
        }
    }

    pub fn get_next_action(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        now: &str,
    ) -> Result<NextActionView, ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        let session = state
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;
        let next_action = self.next_action_resolver.resolve(state, &session, now)?;
        state.events.push(events::next_action_resolved(
            &session.id,
            now,
            &next_action.task_id,
            next_action.step.as_ref().map(|step| step.id.as_str()),
        ));
        state.events.push(events::skills_resolved(
            &session.id,
            now,
            state
                .tasks
                .get(&next_action.task_id)
                .and_then(|task| task.active_skill_profile_id.as_deref()),
            &next_action.active_skills,
        ));
        Ok(next_action)
    }

    pub fn claim_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: Option<&str>,
        now: &str,
    ) -> Result<ClaimStepResult, ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        let resolved_step_id = match step_id {
            Some(step_id) => step_id.to_string(),
            None => self
                .get_next_action(state, session_id, now)?
                .step
                .map(|step| step.id)
                .ok_or_else(|| ErrorEnvelope::conflict("no runnable step available to claim"))?,
        };
        let claimed = self
            .step_lease_manager
            .claim_step(state, session_id, &resolved_step_id, now)?;
        state.events.push(events::step_claimed(
            session_id,
            &claimed.step_id,
            &claimed.lease_token,
            &claimed.lease_expires_at,
            now,
        ));
        Ok(claimed)
    }

    pub fn update_progress(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        lease_token: Option<&str>,
        summary: &str,
        details: Option<&JsonMap>,
        now: &str,
    ) -> Result<(), ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        self.step_lease_manager.update_progress(
            state,
            session_id,
            step_id,
            lease_token,
            now,
            summary,
            details,
        )?;
        state
            .events
            .push(events::step_progress_updated(session_id, step_id, now, summary, details));
        Ok(())
    }

    pub fn complete_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        lease_token: Option<&str>,
        outputs: Option<&JsonMap>,
        now: &str,
    ) -> Result<CompleteStepResult, ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        state
            .sessions
            .get(session_id)
            .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;
        let provisional = self.step_lease_manager.complete_step(
            state,
            session_id,
            step_id,
            lease_token,
            now,
            outputs,
            None,
        )?;

        let next_step_id = self
            .get_next_action(state, session_id, now)?
            .step
            .map(|step| step.id)
            .filter(|next_step_id| next_step_id != step_id);

        if let Some(session) = state.sessions.get_mut(session_id) {
            session.current_step_id = next_step_id.clone();
        }

        state
            .events
            .push(events::step_completed(session_id, step_id, now, outputs));

        Ok(CompleteStepResult {
            next_step_id: next_step_id.or(provisional.next_step_id),
        })
    }

    pub fn block_step(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: &str,
        reason: &str,
        now: &str,
    ) -> Result<(), ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        self.step_lease_manager
            .block_step(state, session_id, step_id, now, reason)?;
        state
            .events
            .push(events::step_blocked(session_id, step_id, now, reason));
        Ok(())
    }

    pub fn resolve_active_skills(
        &self,
        state: &mut OrchestrationState,
        session_id: &str,
        step_id: Option<&str>,
        now: &str,
    ) -> Result<ResolvedSkills, ErrorEnvelope> {
        self.push_expired_lease_events(state, now);
        let session = state
            .sessions
            .get(session_id)
            .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;
        let task = state
            .tasks
            .get(&session.task_id)
            .ok_or_else(|| ErrorEnvelope::not_found("task not found"))?;

        let resolved = self.skill_profile_resolver.resolve(
            state,
            &task.workspace_id,
            session.worktree_id.as_deref(),
            &task.id,
            step_id,
        );
        state.events.push(events::skills_resolved(
            session_id,
            now,
            resolved.active_skill_profile_id.as_deref(),
            &resolved.active_skills,
        ));
        Ok(resolved)
    }

    pub fn attach_session(
        &self,
        state: &mut OrchestrationState,
        input: &crate::model::SessionAttachmentInput,
        now: &str,
    ) -> Result<SessionAttachment, ErrorEnvelope> {
        let attachment = self.task_attach_resolver.resolve(state, input)?;
        state.events.push(events::task_attached(
            &attachment.session_id,
            &attachment.task_id,
            now,
            input.provider_session_id.as_deref(),
        ));
        Ok(attachment)
    }

    fn push_expired_lease_events(&self, state: &mut OrchestrationState, now: &str) {
        let expired = self.step_lease_manager.reap_expired(state, now);
        for lease in expired {
            state.events.push(events::step_lease_expired(
                &lease.step_id,
                &lease.owner_session_id,
                now,
            ));
        }
    }
}
