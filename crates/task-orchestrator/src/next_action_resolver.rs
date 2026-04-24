use std::collections::{BTreeMap, BTreeSet};

use crate::{
    model::{
        ErrorEnvelope, NextActionStepView, NextActionView, OrchestrationState, PlanMode,
        PlanStatus, PlanStep, PlanStepStatus, RecommendedCall, Session,
    },
    skill_profile_resolver::SkillProfileResolver,
    step_lease_manager::is_lease_expired,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct NextActionResolver {
    skill_resolver: SkillProfileResolver,
}

impl NextActionResolver {
    pub fn new() -> Self {
        Self {
            skill_resolver: SkillProfileResolver,
        }
    }

    pub fn resolve(
        &self,
        state: &OrchestrationState,
        session: &Session,
        now: &str,
    ) -> Result<NextActionView, ErrorEnvelope> {
        let task = state
            .tasks
            .get(&session.task_id)
            .ok_or_else(|| ErrorEnvelope::not_found("task not found for session"))?;
        let plan = state.active_plan_for_task(&task.id);
        let mode = plan.map(|plan| plan.mode).unwrap_or(PlanMode::Open);

        let runnable_steps = plan
            .filter(|plan| plan.status == PlanStatus::Active)
            .map(|plan| runnable_steps_for_plan(state, plan.id.as_str(), session, now))
            .unwrap_or_default();

        let selected_step = if state.has_pending_approval(&task.id, &session.id) {
            None
        } else {
            runnable_steps.first().cloned()
        };

        let skills = self.skill_resolver.resolve(
            state,
            &task.workspace_id,
            session.worktree_id.as_deref(),
            &task.id,
            selected_step.as_ref().map(|step| step.id.as_str()),
        );

        let step_view = selected_step.as_ref().map(|step| NextActionStepView {
            id: step.id.clone(),
            title: step.title.clone(),
            description: step.description.clone(),
            success_criteria: Some(build_success_criteria(step)),
            lease_token: step.lease_token.clone(),
        });

        Ok(NextActionView {
            task_id: task.id.clone(),
            mode,
            step: step_view,
            active_skills: skills.active_skills.clone(),
            recommended_sequence: Some(recommended_sequence(
                mode,
                selected_step.as_ref(),
                &skills.active_skills,
            )),
        })
    }
}

pub fn runnable_steps_for_plan(
    state: &OrchestrationState,
    plan_id: &str,
    session: &Session,
    now: &str,
) -> Vec<PlanStep> {
    let steps = state.steps_for_plan(plan_id);
    if steps.is_empty() {
        return Vec::new();
    }

    let by_id = steps
        .iter()
        .map(|step| (step.id.clone(), (*step).clone()))
        .collect::<BTreeMap<_, _>>();
    let blocked = blocked_descendants(&by_id);

    let mut runnable = by_id
        .values()
        .filter(|step| is_step_runnable(state, session, step, &by_id, &blocked, now))
        .cloned()
        .collect::<Vec<_>>();
    runnable.sort_by(|left, right| compare_steps(left, right, &by_id));
    runnable
}

pub fn is_step_runnable_at(
    state: &OrchestrationState,
    session: &Session,
    step_id: &str,
    now: &str,
) -> bool {
    let Some(task_id) = state.step_task_id(step_id) else {
        return false;
    };
    let Some(plan) = state.active_plan_for_task(&task_id) else {
        return false;
    };
    let steps = state.steps_for_plan(&plan.id);
    let by_id = steps
        .iter()
        .map(|step| (step.id.clone(), (*step).clone()))
        .collect::<BTreeMap<_, _>>();
    let blocked = blocked_descendants(&by_id);
    let Some(step) = by_id.get(step_id) else {
        return false;
    };
    is_step_runnable(state, session, step, &by_id, &blocked, now)
}

pub fn has_any_runnable_step(
    state: &OrchestrationState,
    session: &Session,
    task_id: &str,
    now: &str,
) -> bool {
    let Some(plan) = state.active_plan_for_task(task_id) else {
        return false;
    };
    !runnable_steps_for_plan(state, &plan.id, session, now).is_empty()
}

fn is_step_runnable(
    _state: &OrchestrationState,
    session: &Session,
    step: &PlanStep,
    by_id: &BTreeMap<String, PlanStep>,
    blocked: &BTreeSet<String>,
    now: &str,
) -> bool {
    if matches!(
        step.status,
        PlanStepStatus::Completed | PlanStepStatus::Cancelled | PlanStepStatus::Blocked
    ) {
        return false;
    }
    if blocked.contains(&step.id) {
        return false;
    }
    if let Some(allowed) = &step.allowed_providers {
        if !allowed.iter().any(|provider| provider == &session.provider) {
            return false;
        }
    }
    if !step.depends_on.iter().all(|dependency_id| {
        by_id
            .get(dependency_id)
            .map(|dependency| dependency.status == PlanStepStatus::Completed)
            .unwrap_or(false)
    }) {
        return false;
    }

    match step.status {
        PlanStepStatus::Pending => true,
        PlanStepStatus::Claimed | PlanStepStatus::Running => {
            step.lease_owner_session_id.as_deref() == Some(session.id.as_str())
                || is_lease_expired(step.lease_expires_at.as_deref(), now)
        }
        PlanStepStatus::Completed | PlanStepStatus::Blocked | PlanStepStatus::Cancelled => false,
    }
}

fn blocked_descendants(by_id: &BTreeMap<String, PlanStep>) -> BTreeSet<String> {
    let mut reverse_edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for step in by_id.values() {
        for dependency in &step.depends_on {
            reverse_edges
                .entry(dependency.clone())
                .or_default()
                .push(step.id.clone());
        }
    }

    let mut blocked = BTreeSet::new();
    let mut stack = by_id
        .values()
        .filter(|step| step.status == PlanStepStatus::Blocked)
        .map(|step| step.id.clone())
        .collect::<Vec<_>>();

    while let Some(current) = stack.pop() {
        if let Some(children) = reverse_edges.get(&current) {
            for child in children {
                if blocked.insert(child.clone()) {
                    stack.push(child.clone());
                }
            }
        }
    }

    blocked
}

fn compare_steps(
    left: &PlanStep,
    right: &PlanStep,
    by_id: &BTreeMap<String, PlanStep>,
) -> std::cmp::Ordering {
    let left_rank = step_rank(left, by_id, &mut BTreeMap::new());
    let right_rank = step_rank(right, by_id, &mut BTreeMap::new());
    left_rank
        .cmp(&right_rank)
        .then(left.created_at.cmp(&right.created_at))
        .then(left.id.cmp(&right.id))
}

fn step_rank(
    step: &PlanStep,
    by_id: &BTreeMap<String, PlanStep>,
    cache: &mut BTreeMap<String, usize>,
) -> usize {
    if let Some(value) = cache.get(&step.id) {
        return *value;
    }
    let depth = step
        .depends_on
        .iter()
        .filter_map(|id| by_id.get(id))
        .map(|dependency| step_rank(dependency, by_id, cache) + 1)
        .max()
        .unwrap_or(0);
    cache.insert(step.id.clone(), depth);
    depth
}

fn build_success_criteria(step: &PlanStep) -> Vec<String> {
    let mut criteria = vec![format!("Complete step '{}'", step.title)];
    if !step.depends_on.is_empty() {
        criteria.push(format!(
            "Respect dependencies: {}",
            step.depends_on.join(", ")
        ));
    }
    if !step.required_skills.is_empty() {
        criteria.push(format!(
            "Use required skills: {}",
            step.required_skills.join(", ")
        ));
    }
    criteria
}

fn recommended_sequence(
    mode: PlanMode,
    selected_step: Option<&PlanStep>,
    active_skills: &[String],
) -> Vec<RecommendedCall> {
    let mut sequence = vec![RecommendedCall::tool("task.get_next_action")];
    if let Some(step) = selected_step {
        if mode == PlanMode::Guided {
            sequence.push(RecommendedCall::tool("task.update_progress"));
        }
        for skill in active_skills {
            sequence.push(RecommendedCall::skill(skill.clone()));
        }
        sequence.push(RecommendedCall::tool(format!("task.complete_step#{}", step.id)));
    }
    sequence
}
