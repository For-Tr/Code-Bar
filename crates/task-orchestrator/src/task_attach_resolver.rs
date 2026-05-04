use crate::model::{
    ErrorEnvelope, OrchestrationState, PlanMode, SessionAttachment, SessionAttachmentInput,
    SessionState,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct TaskAttachResolver;

impl TaskAttachResolver {
    pub fn resolve(
        &self,
        state: &OrchestrationState,
        input: &SessionAttachmentInput,
    ) -> Result<SessionAttachment, ErrorEnvelope> {
        let session = if let Some(session_id) = input.session_id.as_deref() {
            let session = state
                .sessions
                .get(session_id)
                .ok_or_else(|| ErrorEnvelope::not_found("session not found"))?;
            if session.provider != input.provider {
                return Err(ErrorEnvelope::conflict("provider does not match session"));
            }
            session
        } else if let Some(session) = self.match_provider_binding(state, input)? {
            session
        } else {
            self.match_unique_path(state, input)?
                .ok_or_else(|| ErrorEnvelope::not_found("no session matched attachment input"))?
        };

        let mode = state
            .active_plan_for_task(&session.task_id)
            .map(|plan| plan.mode)
            .unwrap_or(PlanMode::Open);

        let active_skill_profile_id = state
            .tasks
            .get(&session.task_id)
            .and_then(|task| task.active_skill_profile_id.clone());

        Ok(SessionAttachment {
            session_id: session.id.clone(),
            task_id: session.task_id.clone(),
            mode,
            active_step_id: session.current_step_id.clone(),
            active_skill_profile_id,
            recommended_next_calls: vec!["task.get_next_action".to_string()],
        })
    }

    fn match_provider_binding<'a>(
        &self,
        state: &'a OrchestrationState,
        input: &SessionAttachmentInput,
    ) -> Result<Option<&'a crate::model::Session>, ErrorEnvelope> {
        let Some(provider_session_id) = input
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(None);
        };
        let worktree_path = normalized_path(input.worktree_path.as_deref());

        let mut matches = state
            .sessions
            .values()
            .filter(|session| is_attachable_state(session.state))
            .filter(|session| session.provider == input.provider)
            .filter(|session| session.provider_session_id.as_deref() == Some(provider_session_id))
            .filter(|session| {
                if let Some(worktree_path) = worktree_path.as_deref() {
                    session_worktree_path(state, session.id.as_str()).as_deref()
                        == Some(worktree_path)
                } else {
                    true
                }
            })
            .collect::<Vec<_>>();

        if matches.len() > 1 {
            return Err(ErrorEnvelope::conflict(
                "attachment matched multiple sessions by provider session id",
            ));
        }

        Ok(matches.pop())
    }

    fn match_unique_path<'a>(
        &self,
        state: &'a OrchestrationState,
        input: &SessionAttachmentInput,
    ) -> Result<Option<&'a crate::model::Session>, ErrorEnvelope> {
        let target = normalized_path(input.worktree_path.as_deref())
            .or_else(|| normalized_path(input.cwd.as_deref()));
        let Some(target) = target else {
            return Ok(None);
        };

        let matches = state
            .sessions
            .values()
            .filter(|session| is_attachable_state(session.state))
            .filter(|session| session.provider == input.provider)
            .filter(|session| {
                session_worktree_path(state, session.id.as_str())
                    .or_else(|| session_workspace_root(state, session.id.as_str()))
                    .as_deref()
                    == Some(target.as_str())
            })
            .collect::<Vec<_>>();

        match matches.as_slice() {
            [] => Ok(None),
            [session] => Ok(Some(*session)),
            _ => Err(ErrorEnvelope::conflict(
                "attachment matched multiple sessions by path",
            )),
        }
    }
}

fn is_attachable_state(state: SessionState) -> bool {
    !matches!(
        state,
        SessionState::Completed
            | SessionState::Failed
            | SessionState::Cancelled
            | SessionState::Archived
    )
}

fn session_worktree_path(state: &OrchestrationState, session_id: &str) -> Option<String> {
    let session = state.sessions.get(session_id)?;
    let worktree_id = session.worktree_id.as_deref()?;
    let worktree = state.worktrees.get(worktree_id)?;
    normalized_path(Some(worktree.path.as_str()))
}

fn session_workspace_root(state: &OrchestrationState, session_id: &str) -> Option<String> {
    let session = state.sessions.get(session_id)?;
    let workspace = state.workspaces.get(&session.workspace_id)?;
    normalized_path(Some(workspace.root_path.as_str()))
}

fn normalized_path(value: Option<&str>) -> Option<String> {
    let mut path = value?.trim().replace('\\', "/");
    if path.is_empty() {
        return None;
    }
    while path.ends_with('/') && path.len() > 1 {
        path.pop();
    }
    Some(path)
}
