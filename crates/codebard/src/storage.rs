use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{
    ApprovalRequest, DomainResult, Plan, PlanStatus, PlanStep, RecoveryBinding, RunAttempt,
    Session, SkillProfile, Task, Worktree, Workspace,
};
use daemon_core::ports::{
    ApprovalFilter, ApprovalRepository, ArtifactStore, PlanRepository, PlanStepRepository,
    RecoveryBindingRepository, RunAttemptRepository, SessionFilter, SkillProfileRepository,
    StorageIntrospection, TaskFilter, TaskRepository, WorktreeRepository, WorkspaceRepository,
};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub const TASKS_FILE: &str = "tasks.json";
pub const SESSIONS_FILE: &str = "sessions.json";
pub const WORKSPACES_FILE: &str = "workspaces.json";
pub const WORKTREES_FILE: &str = "worktrees.json";
pub const RUN_ATTEMPTS_FILE: &str = "run_attempts.json";
pub const PLANS_FILE: &str = "plans.json";
pub const PLAN_STEPS_FILE: &str = "plan_steps.json";
pub const SKILL_PROFILES_FILE: &str = "skill_profiles.json";
pub const APPROVALS_FILE: &str = "approvals.json";
pub const RECOVERY_BINDINGS_FILE: &str = "recovery_bindings.json";
pub const EVENTS_FILE: &str = "events.jsonl";

pub struct FileStore {
    root: PathBuf,
    workspaces: Mutex<HashMap<String, Workspace>>,
    tasks: Mutex<HashMap<String, Task>>,
    sessions: Mutex<HashMap<String, Session>>,
    worktrees: Mutex<HashMap<String, Worktree>>,
    run_attempts: Mutex<Vec<RunAttempt>>,
    plans: Mutex<HashMap<String, Plan>>,
    plan_steps: Mutex<HashMap<String, Vec<PlanStep>>>,
    skill_profiles: Mutex<HashMap<String, SkillProfile>>,
    approvals: Mutex<HashMap<String, ApprovalRequest>>,
    recovery_bindings: Mutex<HashMap<String, RecoveryBinding>>,
}

impl FileStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        Ok(Self {
            workspaces: Mutex::new(load_map(root.join(WORKSPACES_FILE))?),
            tasks: Mutex::new(load_map(root.join(TASKS_FILE))?),
            sessions: Mutex::new(load_map(root.join(SESSIONS_FILE))?),
            worktrees: Mutex::new(load_map(root.join(WORKTREES_FILE))?),
            run_attempts: Mutex::new(load_vec(root.join(RUN_ATTEMPTS_FILE))?),
            plans: Mutex::new(load_map(root.join(PLANS_FILE))?),
            plan_steps: Mutex::new(load_grouped(root.join(PLAN_STEPS_FILE))?),
            skill_profiles: Mutex::new(load_map(root.join(SKILL_PROFILES_FILE))?),
            approvals: Mutex::new(load_map(root.join(APPROVALS_FILE))?),
            recovery_bindings: Mutex::new(load_map(root.join(RECOVERY_BINDINGS_FILE))?),
            root,
        })
    }

    pub fn events_path(&self) -> PathBuf {
        self.root.join(EVENTS_FILE)
    }

    fn write_map<T: Serialize>(&self, file_name: &str, value: &HashMap<String, T>) -> DomainResult<()> {
        write_json(self.root.join(file_name), value)
    }

    fn write_vec<T: Serialize>(&self, file_name: &str, value: &[T]) -> DomainResult<()> {
        write_json(self.root.join(file_name), value)
    }
}

impl WorkspaceRepository for FileStore {
    fn put_workspace(&self, workspace: Workspace) -> DomainResult<()> {
        let mut workspaces = self.workspaces.lock().unwrap();
        workspaces.insert(workspace.id.clone(), workspace);
        self.write_map(WORKSPACES_FILE, &workspaces)
    }

    fn get_workspace(&self, workspace_id: &str) -> DomainResult<Option<Workspace>> {
        Ok(self.workspaces.lock().unwrap().get(workspace_id).cloned())
    }

    fn list_workspaces(&self) -> DomainResult<Vec<Workspace>> {
        Ok(self.workspaces.lock().unwrap().values().cloned().collect())
    }
}

impl TaskRepository for FileStore {
    fn put_task(&self, task: Task) -> DomainResult<()> {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.insert(task.id.clone(), task);
        self.write_map(TASKS_FILE, &tasks)
    }

    fn get_task(&self, task_id: &str) -> DomainResult<Option<Task>> {
        Ok(self.tasks.lock().unwrap().get(task_id).cloned())
    }

    fn list_tasks(&self, filter: &TaskFilter) -> DomainResult<Vec<Task>> {
        Ok(self.tasks.lock().unwrap().values().filter(|task| {
            filter.workspace_id.as_ref().map(|workspace_id| &task.workspace_id == workspace_id).unwrap_or(true)
                && filter.status.as_ref().map(|statuses| statuses.contains(&task.status)).unwrap_or(true)
        }).cloned().collect())
    }
}

impl daemon_core::ports::SessionRepository for FileStore {
    fn put_session(&self, session: Session) -> DomainResult<()> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(session.id.clone(), session);
        self.write_map(SESSIONS_FILE, &sessions)
    }

    fn get_session(&self, session_id: &str) -> DomainResult<Option<Session>> {
        Ok(self.sessions.lock().unwrap().get(session_id).cloned())
    }

    fn list_sessions(&self, filter: &SessionFilter) -> DomainResult<Vec<Session>> {
        Ok(self.sessions.lock().unwrap().values().filter(|session| {
            filter.task_id.as_ref().map(|task_id| &session.task_id == task_id).unwrap_or(true)
                && filter.workspace_id.as_ref().map(|workspace_id| &session.workspace_id == workspace_id).unwrap_or(true)
                && filter.session_id.as_ref().map(|session_id| &session.id == session_id).unwrap_or(true)
        }).cloned().collect())
    }
}

impl WorktreeRepository for FileStore {
    fn put_worktree(&self, worktree: Worktree) -> DomainResult<()> {
        let mut worktrees = self.worktrees.lock().unwrap();
        worktrees.insert(worktree.id.clone(), worktree);
        self.write_map(WORKTREES_FILE, &worktrees)
    }

    fn get_worktree(&self, worktree_id: &str) -> DomainResult<Option<Worktree>> {
        Ok(self.worktrees.lock().unwrap().get(worktree_id).cloned())
    }

    fn list_worktrees(&self, workspace_id: Option<&str>) -> DomainResult<Vec<Worktree>> {
        Ok(self.worktrees.lock().unwrap().values().filter(|worktree| {
            workspace_id.map(|workspace_id| worktree.workspace_id == workspace_id).unwrap_or(true)
        }).cloned().collect())
    }
}

impl RunAttemptRepository for FileStore {
    fn put_run_attempt(&self, run_attempt: RunAttempt) -> DomainResult<()> {
        let mut run_attempts = self.run_attempts.lock().unwrap();
        run_attempts.push(run_attempt);
        self.write_vec(RUN_ATTEMPTS_FILE, &run_attempts)
    }

    fn list_run_attempts(&self, session_id: &str) -> DomainResult<Vec<RunAttempt>> {
        Ok(self.run_attempts.lock().unwrap().iter().filter(|run| run.session_id == session_id).cloned().collect())
    }
}

impl PlanRepository for FileStore {
    fn put_plan(&self, plan: Plan) -> DomainResult<()> {
        let mut plans = self.plans.lock().unwrap();
        plans.insert(plan.id.clone(), plan);
        self.write_map(PLANS_FILE, &plans)
    }

    fn get_plan(&self, plan_id: &str) -> DomainResult<Option<Plan>> {
        Ok(self.plans.lock().unwrap().get(plan_id).cloned())
    }

    fn get_active_plan_for_task(&self, task_id: &str) -> DomainResult<Option<Plan>> {
        Ok(self.plans.lock().unwrap().values().find(|plan| plan.task_id == task_id && matches!(plan.status, PlanStatus::Active)).cloned())
    }
}

impl PlanStepRepository for FileStore {
    fn put_plan_step(&self, step: PlanStep) -> DomainResult<()> {
        let mut plan_steps = self.plan_steps.lock().unwrap();
        plan_steps.entry(step.plan_id.clone()).or_default().retain(|current| current.id != step.id);
        plan_steps.entry(step.plan_id.clone()).or_default().push(step);
        self.write_map(PLAN_STEPS_FILE, &plan_steps)
    }

    fn list_plan_steps(&self, plan_id: &str) -> DomainResult<Vec<PlanStep>> {
        Ok(self.plan_steps.lock().unwrap().get(plan_id).cloned().unwrap_or_default())
    }
}

impl SkillProfileRepository for FileStore {
    fn put_skill_profile(&self, profile: SkillProfile) -> DomainResult<()> {
        let mut profiles = self.skill_profiles.lock().unwrap();
        profiles.insert(profile.id.clone(), profile);
        self.write_map(SKILL_PROFILES_FILE, &profiles)
    }

    fn get_skill_profile(&self, skill_profile_id: &str) -> DomainResult<Option<SkillProfile>> {
        Ok(self.skill_profiles.lock().unwrap().get(skill_profile_id).cloned())
    }

    fn list_skill_profiles(&self) -> DomainResult<Vec<SkillProfile>> {
        Ok(self.skill_profiles.lock().unwrap().values().cloned().collect())
    }
}

impl ApprovalRepository for FileStore {
    fn put_approval_request(&self, request: ApprovalRequest) -> DomainResult<()> {
        let mut approvals = self.approvals.lock().unwrap();
        approvals.insert(request.id.clone(), request);
        self.write_map(APPROVALS_FILE, &approvals)
    }

    fn get_approval_request(&self, approval_request_id: &str) -> DomainResult<Option<ApprovalRequest>> {
        Ok(self.approvals.lock().unwrap().get(approval_request_id).cloned())
    }

    fn list_approval_requests(&self, filter: &ApprovalFilter) -> DomainResult<Vec<ApprovalRequest>> {
        Ok(self.approvals.lock().unwrap().values().filter(|approval| {
            filter.session_id.as_ref().map(|session_id| &approval.session_id == session_id).unwrap_or(true)
                && filter.task_id.as_ref().map(|task_id| &approval.task_id == task_id).unwrap_or(true)
                && filter.status.as_ref().map(|statuses| statuses.contains(&approval.status)).unwrap_or(true)
        }).cloned().collect())
    }
}

impl RecoveryBindingRepository for FileStore {
    fn put_recovery_binding(&self, binding: RecoveryBinding) -> DomainResult<()> {
        let mut bindings = self.recovery_bindings.lock().unwrap();
        bindings.insert(binding.session_id.clone(), binding);
        self.write_map(RECOVERY_BINDINGS_FILE, &bindings)
    }

    fn get_recovery_binding(&self, session_id: &str) -> DomainResult<Option<RecoveryBinding>> {
        Ok(self.recovery_bindings.lock().unwrap().get(session_id).cloned())
    }
}

impl ArtifactStore for FileStore {
    fn artifacts_root(&self) -> String {
        self.root.join("artifacts").to_string_lossy().to_string()
    }

    fn write_artifact(&self, relative_path: &str, data: &[u8]) -> DomainResult<String> {
        let full_path = self.root.join("artifacts").join(relative_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;
        }
        fs::write(&full_path, data)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;
        Ok(full_path.to_string_lossy().to_string())
    }

    fn read_artifact(&self, relative_path: &str) -> DomainResult<Vec<u8>> {
        let full_path = self.root.join("artifacts").join(relative_path);
        fs::read(&full_path)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
    }
}

impl StorageIntrospection for FileStore {
    fn data_files(&self) -> Vec<String> {
        [
            WORKSPACES_FILE,
            TASKS_FILE,
            SESSIONS_FILE,
            WORKTREES_FILE,
            RUN_ATTEMPTS_FILE,
            PLANS_FILE,
            PLAN_STEPS_FILE,
            SKILL_PROFILES_FILE,
            APPROVALS_FILE,
            RECOVERY_BINDINGS_FILE,
            EVENTS_FILE,
        ]
        .into_iter()
        .map(|file_name| self.root.join(file_name).to_string_lossy().to_string())
        .collect()
    }
}

fn load_map<T>(path: PathBuf) -> Result<HashMap<String, T>, String>
where
    T: DeserializeOwned,
{
    load_json(path)
}

fn load_vec<T>(path: PathBuf) -> Result<Vec<T>, String>
where
    T: DeserializeOwned,
{
    load_json(path)
}

fn load_grouped<T>(path: PathBuf) -> Result<HashMap<String, Vec<T>>, String>
where
    T: DeserializeOwned,
{
    load_json(path)
}

fn load_json<T>(path: PathBuf) -> Result<T, String>
where
    T: DeserializeOwned + Default,
{
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_json<T>(path: PathBuf, value: &T) -> DomainResult<()>
where
    T: Serialize + ?Sized,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;
    }
    let payload = serde_json::to_string_pretty(value)
        .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), false))?;
    fs::write(path, payload)
        .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
}
