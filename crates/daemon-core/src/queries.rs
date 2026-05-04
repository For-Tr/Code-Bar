use crate::domain::{PlanMode, PlanStep, Session, SessionState, SkillProfile, Task};
use crate::ports::DaemonStore;

#[derive(Debug, Clone)]
pub struct NextAction {
    pub task_id: String,
    pub step: Option<PlanStep>,
    pub mode: PlanMode,
    pub active_skills: Vec<String>,
    pub recommended_next_calls: Vec<String>,
}

pub fn compute_next_action(task: &Task, session: &Session, store: &dyn DaemonStore) -> NextAction {
    let plan = task
        .active_plan_id
        .as_deref()
        .and_then(|plan_id| store.get_plan(plan_id).ok().flatten())
        .or_else(|| store.get_active_plan_for_task(&task.id).ok().flatten());

    let step = plan
        .as_ref()
        .and_then(|plan| store.list_plan_steps(&plan.id).ok())
        .and_then(|steps| {
            steps.into_iter().find(|step| {
                matches!(
                    step.status,
                    crate::domain::PlanStepStatus::Pending
                        | crate::domain::PlanStepStatus::Claimed
                        | crate::domain::PlanStepStatus::Running
                        | crate::domain::PlanStepStatus::Blocked
                )
            })
        });

    let active_skills = task
        .active_skill_profile_id
        .as_deref()
        .and_then(|skill_profile_id| store.get_skill_profile(skill_profile_id).ok().flatten())
        .map(skill_profile_skills)
        .unwrap_or_default();

    let mut recommended_next_calls = Vec::new();
    match session.state {
        SessionState::Draft
        | SessionState::PreparingWorkspace
        | SessionState::PreparingWorktree => {
            recommended_next_calls.push("bootstrapSession".to_string());
        }
        SessionState::Ready => {
            recommended_next_calls.push("launchSession".to_string());
        }
        SessionState::Running | SessionState::WaitingInput => {
            recommended_next_calls.push("sendSessionInput".to_string());
            recommended_next_calls.push("stopSession".to_string());
        }
        SessionState::ApprovalRequired => {
            recommended_next_calls.push("listApprovalRequests".to_string());
            recommended_next_calls.push("resolveApproval".to_string());
        }
        SessionState::Interrupted => {
            recommended_next_calls.push("resumeSession".to_string());
        }
        SessionState::Completed
        | SessionState::Failed
        | SessionState::Cancelled
        | SessionState::Archived => {}
        SessionState::Launching => {
            recommended_next_calls.push("listEvents".to_string());
        }
    }

    NextAction {
        task_id: task.id.clone(),
        step,
        mode: plan.map(|plan| plan.mode).unwrap_or(PlanMode::Open),
        active_skills,
        recommended_next_calls,
    }
}

fn skill_profile_skills(skill_profile: SkillProfile) -> Vec<String> {
    skill_profile.allowed_skills
}
