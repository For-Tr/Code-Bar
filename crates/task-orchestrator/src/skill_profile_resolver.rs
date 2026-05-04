use std::collections::BTreeSet;

use crate::model::{OrchestrationState, ResolvedSkills, SkillProfile};

#[derive(Debug, Default, Clone, Copy)]
pub struct SkillProfileResolver;

impl SkillProfileResolver {
    pub fn resolve(
        &self,
        state: &OrchestrationState,
        workspace_id: &str,
        worktree_id: Option<&str>,
        task_id: &str,
        step_id: Option<&str>,
    ) -> ResolvedSkills {
        let workspace_profile = state
            .skill_profiles
            .values()
            .find(|profile| profile.workspace_id.as_deref() == Some(workspace_id));
        let worktree_profile = worktree_id.and_then(|value| {
            state
                .skill_profiles
                .values()
                .find(|profile| profile.worktree_id.as_deref() == Some(value))
        });
        let task_profile = state
            .skill_profiles
            .values()
            .find(|profile| profile.task_id.as_deref() == Some(task_id));
        let step_profile = step_id.and_then(|value| {
            state
                .skill_profiles
                .values()
                .find(|profile| profile.step_id.as_deref() == Some(value))
        });

        let precedence = [
            workspace_profile,
            worktree_profile,
            task_profile,
            step_profile,
        ];

        let active_profile = precedence.iter().rev().copied().flatten().next();
        let allowed_source = precedence
            .iter()
            .rev()
            .copied()
            .flatten()
            .find(|profile| !profile.allowed_skills.is_empty());
        let preferred_source = precedence.iter().rev().copied().flatten().find(|profile| {
            profile
                .preferred_skills
                .as_ref()
                .map(|v| !v.is_empty())
                .unwrap_or(false)
        });

        let forbidden = precedence
            .into_iter()
            .flatten()
            .flat_map(|profile| profile.forbidden_skills.clone().unwrap_or_default())
            .collect::<Vec<_>>();
        let forbidden = OrchestrationState::normalize_skill_list(&forbidden);
        let forbidden_set = forbidden.iter().cloned().collect::<BTreeSet<_>>();

        let active_skills = allowed_source
            .map(|profile| OrchestrationState::normalize_skill_list(&profile.allowed_skills))
            .unwrap_or_else(|| collect_required_skills(state, task_id, step_id));
        let active_skills = active_skills
            .into_iter()
            .filter(|skill| !forbidden_set.contains(skill))
            .collect::<Vec<_>>();

        let preferred = preferred_source
            .and_then(|profile| profile.preferred_skills.clone())
            .map(|skills| OrchestrationState::normalize_skill_list(&skills))
            .map(|skills| {
                skills
                    .into_iter()
                    .filter(|skill| active_skills.iter().any(|active| active == skill))
                    .collect::<Vec<_>>()
            })
            .filter(|skills| !skills.is_empty());

        ResolvedSkills {
            active_skill_profile_id: active_profile.map(|profile| profile.id.clone()),
            active_skills,
            preferred_skills: preferred,
            forbidden_skills: if forbidden.is_empty() {
                None
            } else {
                Some(forbidden)
            },
        }
    }
}

fn collect_required_skills(
    state: &OrchestrationState,
    task_id: &str,
    step_id: Option<&str>,
) -> Vec<String> {
    if let Some(step_id) = step_id {
        if let Some(step) = state.steps.get(step_id) {
            return OrchestrationState::normalize_skill_list(&step.required_skills);
        }
    }

    let Some(plan) = state.active_plan_for_task(task_id) else {
        return Vec::new();
    };

    let combined = state
        .steps_for_plan(&plan.id)
        .into_iter()
        .flat_map(|step| step.required_skills.clone())
        .collect::<Vec<_>>();

    OrchestrationState::normalize_skill_list(&combined)
}

#[allow(dead_code)]
fn _profile_id(profile: Option<&SkillProfile>) -> Option<&str> {
    profile.map(|profile| profile.id.as_str())
}
