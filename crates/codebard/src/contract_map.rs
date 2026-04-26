use crate::contract_enum_map::{
    map_plan_mode_to_contract, map_plan_status_to_contract, map_plan_step_status_to_contract,
    map_session_launch_mode_to_contract, map_session_state_to_contract,
    map_task_status_to_contract, map_worktree_cleanup_policy_to_contract,
    map_worktree_lifecycle_state_to_contract, map_worktree_source_to_contract,
};
use codebar_contracts::domain as contract_domain;
use daemon_core::domain;

pub fn map_task_to_contract(task: domain::Task) -> contract_domain::Task {
    contract_domain::Task {
        id: task.id,
        workspace_id: task.workspace_id,
        title: task.title,
        prompt: task.prompt,
        goal: task.goal,
        constraints: task.constraints,
        requested_provider: task.requested_provider.map(map_provider_kind_to_contract),
        requested_model: task.requested_model,
        status: map_task_status_to_contract(task.status),
        active_plan_id: task.active_plan_id,
        active_skill_profile_id: task.active_skill_profile_id,
        created_at: task.created_at,
        updated_at: task.updated_at,
    }
}

pub fn map_session_to_contract(session: domain::Session) -> contract_domain::Session {
    contract_domain::Session {
        id: session.id,
        task_id: session.task_id,
        workspace_id: session.workspace_id,
        worktree_id: session.worktree_id,
        provider: map_provider_kind_to_contract(session.provider),
        provider_session_id: session.provider_session_id,
        launch_mode: map_session_launch_mode_to_contract(session.launch_mode),
        state: map_session_state_to_contract(session.state),
        current_step_id: session.current_step_id,
        last_activity_at: session.last_activity_at,
        created_at: session.created_at,
        updated_at: session.updated_at,
    }
}

pub fn map_worktree_to_contract(worktree: domain::Worktree) -> contract_domain::Worktree {
    contract_domain::Worktree {
        id: worktree.id,
        workspace_id: worktree.workspace_id,
        path: worktree.path,
        branch_name: worktree.branch_name,
        base_branch: worktree.base_branch,
        source: map_worktree_source_to_contract(worktree.source),
        lifecycle_state: map_worktree_lifecycle_state_to_contract(worktree.lifecycle_state),
        cleanup_policy: map_worktree_cleanup_policy_to_contract(worktree.cleanup_policy),
        created_at: worktree.created_at,
        updated_at: worktree.updated_at,
    }
}

pub fn map_plan_to_contract(plan: domain::Plan) -> contract_domain::Plan {
    contract_domain::Plan {
        id: plan.id,
        task_id: plan.task_id,
        mode: map_plan_mode_to_contract(plan.mode),
        status: map_plan_status_to_contract(plan.status),
        created_at: plan.created_at,
        updated_at: plan.updated_at,
    }
}

pub fn map_plan_step_to_contract(step: domain::PlanStep) -> contract_domain::PlanStep {
    contract_domain::PlanStep {
        id: step.id,
        plan_id: step.plan_id,
        title: step.title,
        description: step.description,
        status: map_plan_step_status_to_contract(step.status),
        depends_on: step.depends_on,
        parallelizable: step.parallelizable,
        required_skills: step.required_skills,
        allowed_providers: step.allowed_providers.map(|providers| providers.into_iter().map(map_provider_kind_to_contract).collect()),
        lease_owner_session_id: step.lease_owner_session_id,
        lease_token: step.lease_token,
        lease_expires_at: step.lease_expires_at,
        progress_summary: step.progress_summary,
        progress_details: step.progress_details,
        outputs: step.outputs,
        blocked_reason: step.blocked_reason,
        created_at: step.created_at,
        updated_at: step.updated_at,
    }
}

pub fn map_run_attempt_to_contract(run: domain::RunAttempt) -> contract_domain::RunAttempt {
    run
}

pub fn map_approval_request_to_contract(request: domain::ApprovalRequest) -> contract_domain::ApprovalRequest {
    contract_domain::ApprovalRequest {
        id: request.id,
        session_id: request.session_id,
        task_id: request.task_id,
        action_type: match request.action_type {
            domain::ApprovalActionType::Write => contract_domain::ApprovalActionType::Write,
            domain::ApprovalActionType::Delete => contract_domain::ApprovalActionType::Delete,
            domain::ApprovalActionType::GitPush => contract_domain::ApprovalActionType::GitPush,
            domain::ApprovalActionType::DangerousBash => contract_domain::ApprovalActionType::DangerousBash,
            domain::ApprovalActionType::ExternalSideEffect => contract_domain::ApprovalActionType::ExternalSideEffect,
        },
        title: request.title,
        description: request.description,
        payload: request.payload.into_iter().collect(),
        status: match request.status {
            domain::ApprovalStatus::Pending => codebar_contracts::rpc::ApprovalStatus::Pending,
            domain::ApprovalStatus::Approved => codebar_contracts::rpc::ApprovalStatus::Approved,
            domain::ApprovalStatus::Rejected => codebar_contracts::rpc::ApprovalStatus::Rejected,
            domain::ApprovalStatus::Expired => codebar_contracts::rpc::ApprovalStatus::Expired,
        },
        created_at: request.created_at,
        resolved_at: request.resolved_at,
    }
}

fn map_provider_kind_to_contract(provider: domain::ProviderKind) -> contract_domain::ProviderKind {
    match provider {
        domain::ProviderKind::Claude => contract_domain::ProviderKind::Claude,
        domain::ProviderKind::Codex => contract_domain::ProviderKind::Codex,
    }
}
