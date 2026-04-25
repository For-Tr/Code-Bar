use codebar_contracts::domain as contract_domain;
use daemon_core::domain;

pub fn map_task_status_to_contract(status: domain::TaskStatus) -> contract_domain::TaskStatus {
    match status {
        domain::TaskStatus::Draft => contract_domain::TaskStatus::Draft,
        domain::TaskStatus::Ready => contract_domain::TaskStatus::Ready,
        domain::TaskStatus::Active => contract_domain::TaskStatus::Active,
        domain::TaskStatus::Blocked => contract_domain::TaskStatus::Blocked,
        domain::TaskStatus::Completed => contract_domain::TaskStatus::Completed,
        domain::TaskStatus::Failed => contract_domain::TaskStatus::Failed,
        domain::TaskStatus::Cancelled => contract_domain::TaskStatus::Cancelled,
        domain::TaskStatus::Archived => contract_domain::TaskStatus::Archived,
    }
}

pub fn map_task_status_from_contract(status: contract_domain::TaskStatus) -> domain::TaskStatus {
    match status {
        contract_domain::TaskStatus::Draft => domain::TaskStatus::Draft,
        contract_domain::TaskStatus::Ready => domain::TaskStatus::Ready,
        contract_domain::TaskStatus::Active => domain::TaskStatus::Active,
        contract_domain::TaskStatus::Blocked => domain::TaskStatus::Blocked,
        contract_domain::TaskStatus::Completed => domain::TaskStatus::Completed,
        contract_domain::TaskStatus::Failed => domain::TaskStatus::Failed,
        contract_domain::TaskStatus::Cancelled => domain::TaskStatus::Cancelled,
        contract_domain::TaskStatus::Archived => domain::TaskStatus::Archived,
    }
}

pub fn map_session_launch_mode_to_contract(mode: domain::SessionLaunchMode) -> contract_domain::SessionLaunchMode {
    match mode {
        domain::SessionLaunchMode::New => contract_domain::SessionLaunchMode::New,
        domain::SessionLaunchMode::Resume => contract_domain::SessionLaunchMode::Resume,
    }
}

pub fn map_session_state_to_contract(state: domain::SessionState) -> contract_domain::SessionState {
    match state {
        domain::SessionState::Draft => contract_domain::SessionState::Draft,
        domain::SessionState::PreparingWorkspace => contract_domain::SessionState::PreparingWorkspace,
        domain::SessionState::PreparingWorktree => contract_domain::SessionState::PreparingWorktree,
        domain::SessionState::Ready => contract_domain::SessionState::Ready,
        domain::SessionState::Launching => contract_domain::SessionState::Launching,
        domain::SessionState::Running => contract_domain::SessionState::Running,
        domain::SessionState::WaitingInput => contract_domain::SessionState::WaitingInput,
        domain::SessionState::ApprovalRequired => contract_domain::SessionState::ApprovalRequired,
        domain::SessionState::Interrupted => contract_domain::SessionState::Interrupted,
        domain::SessionState::Completed => contract_domain::SessionState::Completed,
        domain::SessionState::Failed => contract_domain::SessionState::Failed,
        domain::SessionState::Cancelled => contract_domain::SessionState::Cancelled,
        domain::SessionState::Archived => contract_domain::SessionState::Archived,
    }
}

pub fn map_worktree_source_to_contract(source: domain::WorktreeSource) -> contract_domain::WorktreeSource {
    match source {
        domain::WorktreeSource::Existing => contract_domain::WorktreeSource::Existing,
        domain::WorktreeSource::Managed => contract_domain::WorktreeSource::Managed,
    }
}

pub fn map_worktree_lifecycle_state_to_contract(state: domain::WorktreeLifecycleState) -> contract_domain::WorktreeLifecycleState {
    match state {
        domain::WorktreeLifecycleState::Preparing => contract_domain::WorktreeLifecycleState::Preparing,
        domain::WorktreeLifecycleState::Ready => contract_domain::WorktreeLifecycleState::Ready,
        domain::WorktreeLifecycleState::InUse => contract_domain::WorktreeLifecycleState::InUse,
        domain::WorktreeLifecycleState::CleanupPending => contract_domain::WorktreeLifecycleState::CleanupPending,
        domain::WorktreeLifecycleState::Removed => contract_domain::WorktreeLifecycleState::Removed,
        domain::WorktreeLifecycleState::Error => contract_domain::WorktreeLifecycleState::Error,
    }
}

pub fn map_worktree_cleanup_policy_to_contract(policy: domain::WorktreeCleanupPolicy) -> contract_domain::WorktreeCleanupPolicy {
    match policy {
        domain::WorktreeCleanupPolicy::Manual => contract_domain::WorktreeCleanupPolicy::Manual,
        domain::WorktreeCleanupPolicy::AutoOnTaskDone => contract_domain::WorktreeCleanupPolicy::AutoOnTaskDone,
        domain::WorktreeCleanupPolicy::Keep => contract_domain::WorktreeCleanupPolicy::Keep,
    }
}

pub fn map_plan_mode_to_contract(mode: domain::PlanMode) -> contract_domain::PlanMode {
    match mode {
        domain::PlanMode::Guided => contract_domain::PlanMode::Guided,
        domain::PlanMode::Open => contract_domain::PlanMode::Open,
    }
}

pub fn map_plan_status_to_contract(status: domain::PlanStatus) -> contract_domain::PlanStatus {
    match status {
        domain::PlanStatus::Draft => contract_domain::PlanStatus::Draft,
        domain::PlanStatus::Active => contract_domain::PlanStatus::Active,
        domain::PlanStatus::Completed => contract_domain::PlanStatus::Completed,
        domain::PlanStatus::Cancelled => contract_domain::PlanStatus::Cancelled,
    }
}

pub fn map_plan_step_status_to_contract(status: domain::PlanStepStatus) -> contract_domain::PlanStepStatus {
    match status {
        domain::PlanStepStatus::Pending => contract_domain::PlanStepStatus::Pending,
        domain::PlanStepStatus::Claimed => contract_domain::PlanStepStatus::Claimed,
        domain::PlanStepStatus::Running => contract_domain::PlanStepStatus::Running,
        domain::PlanStepStatus::Blocked => contract_domain::PlanStepStatus::Blocked,
        domain::PlanStepStatus::Completed => contract_domain::PlanStepStatus::Completed,
        domain::PlanStepStatus::Cancelled => contract_domain::PlanStepStatus::Cancelled,
    }
}
