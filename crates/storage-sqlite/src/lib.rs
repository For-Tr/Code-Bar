use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{
    ApprovalRequest, DomainResult, EventEntityType, EventEnvelope, Plan, PlanStatus, PlanStep,
    RecoveryBinding, RunAttempt, Session, SkillProfile, Task, Workspace, Worktree,
};
use daemon_core::ports::{
    ApprovalFilter, ApprovalRepository, ArtifactStore, AuditEventRepository, EventFilter,
    PlanRepository, PlanStepRepository, RecoveryBindingRepository, RunAttemptRepository,
    SessionFilter, SkillProfileRepository, StorageIntrospection, TaskFilter, TaskRepository,
    WorkspaceRepository, WorktreeRepository,
};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const APP_DATA_DIR: &str = "app-data";
pub const STATE_DB_FILE: &str = "state.db";
pub const LOGS_DIR: &str = "logs";
pub const TRANSCRIPTS_DIR: &str = "transcripts";
pub const ARTIFACTS_DIR: &str = "artifacts";
pub const DIAGNOSTICS_DIR: &str = "diagnostics";
pub const MIGRATIONS_DIR: &str = "migrations";

pub const INITIAL_MIGRATION_FILE: &str = "0001_initial.sql";
pub const INITIAL_MIGRATION_SQL: &str = include_str!("../migrations/0001_initial.sql");

pub struct StorageSqlite {
    app_data: PathBuf,
    db_path: PathBuf,
    migration_path: PathBuf,
    conn: Mutex<Connection>,
}

impl StorageSqlite {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;

        let app_data = root.join(APP_DATA_DIR);
        fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;
        fs::create_dir_all(app_data.join(LOGS_DIR)).map_err(|error| error.to_string())?;
        fs::create_dir_all(app_data.join(TRANSCRIPTS_DIR)).map_err(|error| error.to_string())?;
        fs::create_dir_all(app_data.join(ARTIFACTS_DIR)).map_err(|error| error.to_string())?;
        fs::create_dir_all(app_data.join(DIAGNOSTICS_DIR)).map_err(|error| error.to_string())?;

        let migrations_dir = app_data.join(MIGRATIONS_DIR);
        fs::create_dir_all(&migrations_dir).map_err(|error| error.to_string())?;
        let migration_path = migrations_dir.join(INITIAL_MIGRATION_FILE);
        if !migration_path.exists() {
            fs::write(&migration_path, INITIAL_MIGRATION_SQL).map_err(|error| error.to_string())?;
        }

        let db_path = app_data.join(STATE_DB_FILE);
        let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;
        conn.execute_batch(INITIAL_MIGRATION_SQL)
            .map_err(|error| error.to_string())?;

        Ok(Self {
            app_data,
            db_path,
            migration_path,
            conn: Mutex::new(conn),
        })
    }

    pub fn app_data_dir(&self) -> &PathBuf {
        &self.app_data
    }

    pub fn migration_files(&self) -> Vec<PathBuf> {
        vec![self.migration_path.clone()]
    }

    pub fn with_conn<T>(
        &self,
        action: impl FnOnce(&Connection) -> DomainResult<T>,
    ) -> DomainResult<T> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| internal_error("sqlite mutex poisoned", true))?;
        action(&conn)
    }

    fn resolve_artifact_path(&self, relative_path: &str) -> DomainResult<PathBuf> {
        let path = Path::new(relative_path);
        if path.is_absolute() {
            return Err(ErrorEnvelope::new(
                ErrorCode::InvalidArgument,
                "artifact path must be relative",
                false,
            ));
        }
        if path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(ErrorEnvelope::new(
                ErrorCode::InvalidArgument,
                "artifact path cannot traverse parent directories",
                false,
            ));
        }
        Ok(self.app_data.join(ARTIFACTS_DIR).join(path))
    }
}

impl WorkspaceRepository for StorageSqlite {
    fn put_workspace(&self, workspace: Workspace) -> DomainResult<()> {
        let vcs_type = enum_to_text(workspace.vcs_type)?;
        let trust_level = enum_to_text(workspace.trust_level)?;
        let default_provider = workspace.default_provider.map(enum_to_text).transpose()?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (
                    id, display_name, root_path, vcs_type, repo_identity,
                    trust_level, default_provider, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    root_path = excluded.root_path,
                    vcs_type = excluded.vcs_type,
                    repo_identity = excluded.repo_identity,
                    trust_level = excluded.trust_level,
                    default_provider = excluded.default_provider,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    workspace.id,
                    workspace.display_name,
                    workspace.root_path,
                    vcs_type,
                    workspace.repo_identity,
                    trust_level,
                    default_provider,
                    workspace.created_at,
                    workspace.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_workspace(&self, workspace_id: &str) -> DomainResult<Option<Workspace>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM workspaces WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![workspace_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(workspace_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_workspaces(&self) -> DomainResult<Vec<Workspace>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM workspaces ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut workspaces = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                workspaces.push(workspace_from_row(row)?);
            }
            Ok(workspaces)
        })
    }
}

impl TaskRepository for StorageSqlite {
    fn put_task(&self, task: Task) -> DomainResult<()> {
        let requested_provider = task.requested_provider.map(enum_to_text).transpose()?;
        let status = enum_to_text(task.status)?;
        let constraints_json = task.constraints.as_ref().map(to_json).transpose()?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO tasks (
                    id, workspace_id, title, prompt, goal, constraints_json,
                    requested_provider, requested_model, status,
                    active_plan_id, active_skill_profile_id,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    title = excluded.title,
                    prompt = excluded.prompt,
                    goal = excluded.goal,
                    constraints_json = excluded.constraints_json,
                    requested_provider = excluded.requested_provider,
                    requested_model = excluded.requested_model,
                    status = excluded.status,
                    active_plan_id = excluded.active_plan_id,
                    active_skill_profile_id = excluded.active_skill_profile_id,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    task.id,
                    task.workspace_id,
                    task.title,
                    task.prompt,
                    task.goal,
                    constraints_json,
                    requested_provider,
                    task.requested_model,
                    status,
                    task.active_plan_id,
                    task.active_skill_profile_id,
                    task.created_at,
                    task.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_task(&self, task_id: &str) -> DomainResult<Option<Task>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM tasks WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![task_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(task_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_tasks(&self, filter: &TaskFilter) -> DomainResult<Vec<Task>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM tasks ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut tasks = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                let task = task_from_row(row)?;
                if filter
                    .workspace_id
                    .as_ref()
                    .map(|workspace_id| &task.workspace_id == workspace_id)
                    .unwrap_or(true)
                    && filter
                        .status
                        .as_ref()
                        .map(|statuses| statuses.contains(&task.status))
                        .unwrap_or(true)
                {
                    tasks.push(task);
                }
            }
            Ok(tasks)
        })
    }
}

impl daemon_core::ports::SessionRepository for StorageSqlite {
    fn put_session(&self, session: Session) -> DomainResult<()> {
        let provider = enum_to_text(session.provider)?;
        let launch_mode = enum_to_text(session.launch_mode)?;
        let state = enum_to_text(session.state)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, task_id, workspace_id, worktree_id,
                    provider, provider_session_id,
                    launch_mode, state,
                    current_step_id, last_activity_at,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    task_id = excluded.task_id,
                    workspace_id = excluded.workspace_id,
                    worktree_id = excluded.worktree_id,
                    provider = excluded.provider,
                    provider_session_id = excluded.provider_session_id,
                    launch_mode = excluded.launch_mode,
                    state = excluded.state,
                    current_step_id = excluded.current_step_id,
                    last_activity_at = excluded.last_activity_at,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    session.id,
                    session.task_id,
                    session.workspace_id,
                    session.worktree_id,
                    provider,
                    session.provider_session_id,
                    launch_mode,
                    state,
                    session.current_step_id,
                    session.last_activity_at,
                    session.created_at,
                    session.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_session(&self, session_id: &str) -> DomainResult<Option<Session>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM sessions WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![session_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(session_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_sessions(&self, filter: &SessionFilter) -> DomainResult<Vec<Session>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM sessions ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut sessions = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                let session = session_from_row(row)?;
                if filter
                    .task_id
                    .as_ref()
                    .map(|task_id| &session.task_id == task_id)
                    .unwrap_or(true)
                    && filter
                        .workspace_id
                        .as_ref()
                        .map(|workspace_id| &session.workspace_id == workspace_id)
                        .unwrap_or(true)
                    && filter
                        .session_id
                        .as_ref()
                        .map(|session_id| &session.id == session_id)
                        .unwrap_or(true)
                {
                    sessions.push(session);
                }
            }
            Ok(sessions)
        })
    }
}

impl WorktreeRepository for StorageSqlite {
    fn put_worktree(&self, worktree: Worktree) -> DomainResult<()> {
        let source = enum_to_text(worktree.source)?;
        let lifecycle_state = enum_to_text(worktree.lifecycle_state)?;
        let cleanup_policy = enum_to_text(worktree.cleanup_policy)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO worktrees (
                    id, workspace_id, path, branch_name, base_branch,
                    source, lifecycle_state, cleanup_policy,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    path = excluded.path,
                    branch_name = excluded.branch_name,
                    base_branch = excluded.base_branch,
                    source = excluded.source,
                    lifecycle_state = excluded.lifecycle_state,
                    cleanup_policy = excluded.cleanup_policy,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    worktree.id,
                    worktree.workspace_id,
                    worktree.path,
                    worktree.branch_name,
                    worktree.base_branch,
                    source,
                    lifecycle_state,
                    cleanup_policy,
                    worktree.created_at,
                    worktree.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_worktree(&self, worktree_id: &str) -> DomainResult<Option<Worktree>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM worktrees WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![worktree_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(worktree_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_worktrees(&self, workspace_id: Option<&str>) -> DomainResult<Vec<Worktree>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM worktrees ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut worktrees = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                let worktree = worktree_from_row(row)?;
                if workspace_id
                    .map(|workspace| worktree.workspace_id == workspace)
                    .unwrap_or(true)
                {
                    worktrees.push(worktree);
                }
            }
            Ok(worktrees)
        })
    }
}

impl RunAttemptRepository for StorageSqlite {
    fn put_run_attempt(&self, run_attempt: RunAttempt) -> DomainResult<()> {
        let launcher_type = enum_to_text(run_attempt.launcher_type)?;
        let args_json = to_json(&run_attempt.args)?;
        let exit_reason = run_attempt.exit_reason.map(enum_to_text).transpose()?;
        let status = enum_to_text(run_attempt.status)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO run_attempts (
                    id, session_id, attempt_no, launcher_type,
                    command, args_json, cwd, pid,
                    started_at, ended_at, exit_reason, status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    session_id = excluded.session_id,
                    attempt_no = excluded.attempt_no,
                    launcher_type = excluded.launcher_type,
                    command = excluded.command,
                    args_json = excluded.args_json,
                    cwd = excluded.cwd,
                    pid = excluded.pid,
                    started_at = excluded.started_at,
                    ended_at = excluded.ended_at,
                    exit_reason = excluded.exit_reason,
                    status = excluded.status",
                params![
                    run_attempt.id,
                    run_attempt.session_id,
                    run_attempt.attempt_no,
                    launcher_type,
                    run_attempt.command,
                    args_json,
                    run_attempt.cwd,
                    run_attempt.pid,
                    run_attempt.started_at,
                    run_attempt.ended_at,
                    exit_reason,
                    status,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn list_run_attempts(&self, session_id: &str) -> DomainResult<Vec<RunAttempt>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM run_attempts WHERE session_id = ?1 ORDER BY attempt_no ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![session_id]).map_err(sql_error)?;
            let mut run_attempts = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                run_attempts.push(run_attempt_from_row(row)?);
            }
            Ok(run_attempts)
        })
    }
}

impl PlanRepository for StorageSqlite {
    fn put_plan(&self, plan: Plan) -> DomainResult<()> {
        let mode = enum_to_text(plan.mode)?;
        let status = enum_to_text(plan.status)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO plans (id, task_id, mode, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    task_id = excluded.task_id,
                    mode = excluded.mode,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    plan.id,
                    plan.task_id,
                    mode,
                    status,
                    plan.created_at,
                    plan.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_plan(&self, plan_id: &str) -> DomainResult<Option<Plan>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM plans WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![plan_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(plan_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn get_active_plan_for_task(&self, task_id: &str) -> DomainResult<Option<Plan>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM plans WHERE task_id = ?1 ORDER BY updated_at DESC, created_at DESC",
                )
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![task_id]).map_err(sql_error)?;
            while let Some(row) = rows.next().map_err(sql_error)? {
                let plan = plan_from_row(row)?;
                if matches!(plan.status, PlanStatus::Active) {
                    return Ok(Some(plan));
                }
            }
            Ok(None)
        })
    }
}

impl PlanStepRepository for StorageSqlite {
    fn put_plan_step(&self, step: PlanStep) -> DomainResult<()> {
        let status = enum_to_text(step.status)?;
        let depends_on_json = to_json(&step.depends_on)?;
        let required_skills_json = to_json(&step.required_skills)?;
        let allowed_providers_json = step.allowed_providers.as_ref().map(to_json).transpose()?;
        let progress_details_json = step.progress_details.as_ref().map(to_json).transpose()?;
        let outputs_json = step.outputs.as_ref().map(to_json).transpose()?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO plan_steps (
                    id, plan_id, title, description, status,
                    depends_on_json, parallelizable, required_skills_json,
                    allowed_providers_json,
                    lease_owner_session_id, lease_token, lease_expires_at,
                    progress_summary, progress_details_json, outputs_json,
                    blocked_reason, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                 ON CONFLICT(id) DO UPDATE SET
                    plan_id = excluded.plan_id,
                    title = excluded.title,
                    description = excluded.description,
                    status = excluded.status,
                    depends_on_json = excluded.depends_on_json,
                    parallelizable = excluded.parallelizable,
                    required_skills_json = excluded.required_skills_json,
                    allowed_providers_json = excluded.allowed_providers_json,
                    lease_owner_session_id = excluded.lease_owner_session_id,
                    lease_token = excluded.lease_token,
                    lease_expires_at = excluded.lease_expires_at,
                    progress_summary = excluded.progress_summary,
                    progress_details_json = excluded.progress_details_json,
                    outputs_json = excluded.outputs_json,
                    blocked_reason = excluded.blocked_reason,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    step.id,
                    step.plan_id,
                    step.title,
                    step.description,
                    status,
                    depends_on_json,
                    if step.parallelizable { 1 } else { 0 },
                    required_skills_json,
                    allowed_providers_json,
                    step.lease_owner_session_id,
                    step.lease_token,
                    step.lease_expires_at,
                    step.progress_summary,
                    progress_details_json,
                    outputs_json,
                    step.blocked_reason,
                    step.created_at,
                    step.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn list_plan_steps(&self, plan_id: &str) -> DomainResult<Vec<PlanStep>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM plan_steps WHERE plan_id = ?1 ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![plan_id]).map_err(sql_error)?;
            let mut steps = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                steps.push(plan_step_from_row(row)?);
            }
            Ok(steps)
        })
    }
}

impl SkillProfileRepository for StorageSqlite {
    fn put_skill_profile(&self, profile: SkillProfile) -> DomainResult<()> {
        let source = enum_to_text(profile.source)?;
        let allowed_skills_json = to_json(&profile.allowed_skills)?;
        let preferred_skills_json = profile.preferred_skills.as_ref().map(to_json).transpose()?;
        let forbidden_skills_json = profile.forbidden_skills.as_ref().map(to_json).transpose()?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO skill_profiles (
                    id, name, source,
                    workspace_id, worktree_id, task_id, step_id,
                    allowed_skills_json, preferred_skills_json, forbidden_skills_json,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    source = excluded.source,
                    workspace_id = excluded.workspace_id,
                    worktree_id = excluded.worktree_id,
                    task_id = excluded.task_id,
                    step_id = excluded.step_id,
                    allowed_skills_json = excluded.allowed_skills_json,
                    preferred_skills_json = excluded.preferred_skills_json,
                    forbidden_skills_json = excluded.forbidden_skills_json,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    profile.id,
                    profile.name,
                    source,
                    profile.workspace_id,
                    profile.worktree_id,
                    profile.task_id,
                    profile.step_id,
                    allowed_skills_json,
                    preferred_skills_json,
                    forbidden_skills_json,
                    profile.created_at,
                    profile.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_skill_profile(&self, skill_profile_id: &str) -> DomainResult<Option<SkillProfile>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM skill_profiles WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![skill_profile_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(skill_profile_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_skill_profiles(&self) -> DomainResult<Vec<SkillProfile>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM skill_profiles ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut profiles = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                profiles.push(skill_profile_from_row(row)?);
            }
            Ok(profiles)
        })
    }
}

impl ApprovalRepository for StorageSqlite {
    fn put_approval_request(&self, request: ApprovalRequest) -> DomainResult<()> {
        let action_type = enum_to_text(request.action_type)?;
        let payload_json = to_json(&request.payload)?;
        let status = enum_to_text(request.status)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO approval_requests (
                    id, session_id, task_id,
                    action_type, title, description,
                    payload_json, status,
                    created_at, resolved_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                    session_id = excluded.session_id,
                    task_id = excluded.task_id,
                    action_type = excluded.action_type,
                    title = excluded.title,
                    description = excluded.description,
                    payload_json = excluded.payload_json,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    resolved_at = excluded.resolved_at",
                params![
                    request.id,
                    request.session_id,
                    request.task_id,
                    action_type,
                    request.title,
                    request.description,
                    payload_json,
                    status,
                    request.created_at,
                    request.resolved_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_approval_request(
        &self,
        approval_request_id: &str,
    ) -> DomainResult<Option<ApprovalRequest>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM approval_requests WHERE id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt
                .query(params![approval_request_id])
                .map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(approval_request_from_row(row)?)),
                None => Ok(None),
            }
        })
    }

    fn list_approval_requests(
        &self,
        filter: &ApprovalFilter,
    ) -> DomainResult<Vec<ApprovalRequest>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM approval_requests ORDER BY created_at ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut approvals = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                let approval = approval_request_from_row(row)?;
                if filter
                    .session_id
                    .as_ref()
                    .map(|session_id| &approval.session_id == session_id)
                    .unwrap_or(true)
                    && filter
                        .task_id
                        .as_ref()
                        .map(|task_id| &approval.task_id == task_id)
                        .unwrap_or(true)
                    && filter
                        .status
                        .as_ref()
                        .map(|statuses| statuses.contains(&approval.status))
                        .unwrap_or(true)
                {
                    approvals.push(approval);
                }
            }
            Ok(approvals)
        })
    }
}

impl RecoveryBindingRepository for StorageSqlite {
    fn put_recovery_binding(&self, binding: RecoveryBinding) -> DomainResult<()> {
        let provider = enum_to_text(binding.provider)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO recovery_bindings (
                    session_id, provider, provider_session_id,
                    worktree_path, run_attempt_id, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(session_id) DO UPDATE SET
                    provider = excluded.provider,
                    provider_session_id = excluded.provider_session_id,
                    worktree_path = excluded.worktree_path,
                    run_attempt_id = excluded.run_attempt_id,
                    updated_at = excluded.updated_at",
                params![
                    binding.session_id,
                    provider,
                    binding.provider_session_id,
                    binding.worktree_path,
                    binding.run_attempt_id,
                    binding.updated_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn get_recovery_binding(&self, session_id: &str) -> DomainResult<Option<RecoveryBinding>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM recovery_bindings WHERE session_id = ?1")
                .map_err(sql_error)?;
            let mut rows = stmt.query(params![session_id]).map_err(sql_error)?;
            match rows.next().map_err(sql_error)? {
                Some(row) => Ok(Some(recovery_binding_from_row(row)?)),
                None => Ok(None),
            }
        })
    }
}

impl AuditEventRepository for StorageSqlite {
    fn append_audit_event(&self, event: EventEnvelope) -> DomainResult<()> {
        let entity_type = enum_to_text(event.entity_type)?;
        let source = enum_to_text(event.source)?;
        let payload_json = to_json(&event.payload)?;

        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO audit_events (
                    id, entity_type, entity_id, event_type,
                    source, correlation_id, payload_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    entity_type = excluded.entity_type,
                    entity_id = excluded.entity_id,
                    event_type = excluded.event_type,
                    source = excluded.source,
                    correlation_id = excluded.correlation_id,
                    payload_json = excluded.payload_json,
                    created_at = excluded.created_at",
                params![
                    event.id,
                    entity_type,
                    event.entity_id,
                    event.event_type,
                    source,
                    event.correlation_id,
                    payload_json,
                    event.created_at,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
    }

    fn list_audit_events(&self, filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM audit_events ORDER BY created_at ASC, id ASC")
                .map_err(sql_error)?;
            let mut rows = stmt.query([]).map_err(sql_error)?;
            let mut events = Vec::new();
            while let Some(row) = rows.next().map_err(sql_error)? {
                let event = audit_event_from_row(row)?;
                if matches_event_filter(&event, filter) {
                    events.push(event);
                }
            }

            if let Some(limit) = filter.limit {
                if events.len() > limit {
                    events = events[events.len() - limit..].to_vec();
                }
            }

            Ok(events)
        })
    }
}

impl ArtifactStore for StorageSqlite {
    fn artifacts_root(&self) -> String {
        self.app_data
            .join(ARTIFACTS_DIR)
            .to_string_lossy()
            .to_string()
    }

    fn write_artifact(&self, relative_path: &str, data: &[u8]) -> DomainResult<String> {
        let full_path = self.resolve_artifact_path(relative_path)?;
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|error| internal_error(error.to_string(), true))?;
        }
        fs::write(&full_path, data).map_err(|error| internal_error(error.to_string(), true))?;
        Ok(full_path.to_string_lossy().to_string())
    }

    fn read_artifact(&self, relative_path: &str) -> DomainResult<Vec<u8>> {
        let full_path = self.resolve_artifact_path(relative_path)?;
        fs::read(&full_path).map_err(|error| internal_error(error.to_string(), true))
    }
}

impl StorageIntrospection for StorageSqlite {
    fn data_files(&self) -> Vec<String> {
        vec![
            self.db_path.to_string_lossy().to_string(),
            self.app_data.join(LOGS_DIR).to_string_lossy().to_string(),
            self.app_data
                .join(TRANSCRIPTS_DIR)
                .to_string_lossy()
                .to_string(),
            self.app_data
                .join(ARTIFACTS_DIR)
                .to_string_lossy()
                .to_string(),
            self.app_data
                .join(DIAGNOSTICS_DIR)
                .to_string_lossy()
                .to_string(),
            self.migration_path.to_string_lossy().to_string(),
        ]
    }
}

fn workspace_from_row(row: &rusqlite::Row<'_>) -> DomainResult<Workspace> {
    Ok(Workspace {
        id: row.get("id").map_err(sql_error)?,
        display_name: row.get("display_name").map_err(sql_error)?,
        root_path: row.get("root_path").map_err(sql_error)?,
        vcs_type: enum_from_text(row.get::<_, String>("vcs_type").map_err(sql_error)?)?,
        repo_identity: row.get("repo_identity").map_err(sql_error)?,
        trust_level: enum_from_text(row.get::<_, String>("trust_level").map_err(sql_error)?)?,
        default_provider: row
            .get::<_, Option<String>>("default_provider")
            .map_err(sql_error)?
            .map(enum_from_text)
            .transpose()?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> DomainResult<Task> {
    let constraints_json = row
        .get::<_, Option<String>>("constraints_json")
        .map_err(sql_error)?;

    Ok(Task {
        id: row.get("id").map_err(sql_error)?,
        workspace_id: row.get("workspace_id").map_err(sql_error)?,
        title: row.get("title").map_err(sql_error)?,
        prompt: row.get("prompt").map_err(sql_error)?,
        goal: row.get("goal").map_err(sql_error)?,
        constraints: constraints_json.as_deref().map(from_json).transpose()?,
        requested_provider: row
            .get::<_, Option<String>>("requested_provider")
            .map_err(sql_error)?
            .map(enum_from_text)
            .transpose()?,
        requested_model: row.get("requested_model").map_err(sql_error)?,
        status: enum_from_text(row.get::<_, String>("status").map_err(sql_error)?)?,
        active_plan_id: row.get("active_plan_id").map_err(sql_error)?,
        active_skill_profile_id: row.get("active_skill_profile_id").map_err(sql_error)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn session_from_row(row: &rusqlite::Row<'_>) -> DomainResult<Session> {
    Ok(Session {
        id: row.get("id").map_err(sql_error)?,
        task_id: row.get("task_id").map_err(sql_error)?,
        workspace_id: row.get("workspace_id").map_err(sql_error)?,
        worktree_id: row.get("worktree_id").map_err(sql_error)?,
        provider: enum_from_text(row.get::<_, String>("provider").map_err(sql_error)?)?,
        provider_session_id: row.get("provider_session_id").map_err(sql_error)?,
        launch_mode: enum_from_text(row.get::<_, String>("launch_mode").map_err(sql_error)?)?,
        state: enum_from_text(row.get::<_, String>("state").map_err(sql_error)?)?,
        current_step_id: row.get("current_step_id").map_err(sql_error)?,
        last_activity_at: row.get("last_activity_at").map_err(sql_error)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn worktree_from_row(row: &rusqlite::Row<'_>) -> DomainResult<Worktree> {
    Ok(Worktree {
        id: row.get("id").map_err(sql_error)?,
        workspace_id: row.get("workspace_id").map_err(sql_error)?,
        path: row.get("path").map_err(sql_error)?,
        branch_name: row.get("branch_name").map_err(sql_error)?,
        base_branch: row.get("base_branch").map_err(sql_error)?,
        source: enum_from_text(row.get::<_, String>("source").map_err(sql_error)?)?,
        lifecycle_state: enum_from_text(
            row.get::<_, String>("lifecycle_state").map_err(sql_error)?,
        )?,
        cleanup_policy: enum_from_text(row.get::<_, String>("cleanup_policy").map_err(sql_error)?)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn run_attempt_from_row(row: &rusqlite::Row<'_>) -> DomainResult<RunAttempt> {
    let attempt_no = row.get::<_, i64>("attempt_no").map_err(sql_error)?;
    let pid = row.get::<_, Option<i64>>("pid").map_err(sql_error)?;

    Ok(RunAttempt {
        id: row.get("id").map_err(sql_error)?,
        session_id: row.get("session_id").map_err(sql_error)?,
        attempt_no: u32::try_from(attempt_no)
            .map_err(|error| internal_error(error.to_string(), false))?,
        launcher_type: enum_from_text(row.get::<_, String>("launcher_type").map_err(sql_error)?)?,
        command: row.get("command").map_err(sql_error)?,
        args: from_json(&row.get::<_, String>("args_json").map_err(sql_error)?)?,
        cwd: row.get("cwd").map_err(sql_error)?,
        pid: pid
            .map(u32::try_from)
            .transpose()
            .map_err(|error| internal_error(error.to_string(), false))?,
        started_at: row.get("started_at").map_err(sql_error)?,
        ended_at: row.get("ended_at").map_err(sql_error)?,
        exit_reason: row
            .get::<_, Option<String>>("exit_reason")
            .map_err(sql_error)?
            .map(enum_from_text)
            .transpose()?,
        status: enum_from_text(row.get::<_, String>("status").map_err(sql_error)?)?,
    })
}

fn plan_from_row(row: &rusqlite::Row<'_>) -> DomainResult<Plan> {
    Ok(Plan {
        id: row.get("id").map_err(sql_error)?,
        task_id: row.get("task_id").map_err(sql_error)?,
        mode: enum_from_text(row.get::<_, String>("mode").map_err(sql_error)?)?,
        status: enum_from_text(row.get::<_, String>("status").map_err(sql_error)?)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn plan_step_from_row(row: &rusqlite::Row<'_>) -> DomainResult<PlanStep> {
    let parallelizable = row.get::<_, i64>("parallelizable").map_err(sql_error)?;

    Ok(PlanStep {
        id: row.get("id").map_err(sql_error)?,
        plan_id: row.get("plan_id").map_err(sql_error)?,
        title: row.get("title").map_err(sql_error)?,
        description: row.get("description").map_err(sql_error)?,
        status: enum_from_text(row.get::<_, String>("status").map_err(sql_error)?)?,
        depends_on: from_json(&row.get::<_, String>("depends_on_json").map_err(sql_error)?)?,
        parallelizable: parallelizable != 0,
        required_skills: from_json(
            &row.get::<_, String>("required_skills_json")
                .map_err(sql_error)?,
        )?,
        allowed_providers: row
            .get::<_, Option<String>>("allowed_providers_json")
            .map_err(sql_error)?
            .as_deref()
            .map(from_json)
            .transpose()?,
        lease_owner_session_id: row.get("lease_owner_session_id").map_err(sql_error)?,
        lease_token: row.get("lease_token").map_err(sql_error)?,
        lease_expires_at: row.get("lease_expires_at").map_err(sql_error)?,
        progress_summary: row.get("progress_summary").map_err(sql_error)?,
        progress_details: row
            .get::<_, Option<String>>("progress_details_json")
            .map_err(sql_error)?
            .as_deref()
            .map(from_json)
            .transpose()?,
        outputs: row
            .get::<_, Option<String>>("outputs_json")
            .map_err(sql_error)?
            .as_deref()
            .map(from_json)
            .transpose()?,
        blocked_reason: row.get("blocked_reason").map_err(sql_error)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn skill_profile_from_row(row: &rusqlite::Row<'_>) -> DomainResult<SkillProfile> {
    Ok(SkillProfile {
        id: row.get("id").map_err(sql_error)?,
        name: row.get("name").map_err(sql_error)?,
        source: enum_from_text(row.get::<_, String>("source").map_err(sql_error)?)?,
        workspace_id: row.get("workspace_id").map_err(sql_error)?,
        worktree_id: row.get("worktree_id").map_err(sql_error)?,
        task_id: row.get("task_id").map_err(sql_error)?,
        step_id: row.get("step_id").map_err(sql_error)?,
        allowed_skills: from_json(
            &row.get::<_, String>("allowed_skills_json")
                .map_err(sql_error)?,
        )?,
        preferred_skills: row
            .get::<_, Option<String>>("preferred_skills_json")
            .map_err(sql_error)?
            .as_deref()
            .map(from_json)
            .transpose()?,
        forbidden_skills: row
            .get::<_, Option<String>>("forbidden_skills_json")
            .map_err(sql_error)?
            .as_deref()
            .map(from_json)
            .transpose()?,
        created_at: row.get("created_at").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn approval_request_from_row(row: &rusqlite::Row<'_>) -> DomainResult<ApprovalRequest> {
    Ok(ApprovalRequest {
        id: row.get("id").map_err(sql_error)?,
        session_id: row.get("session_id").map_err(sql_error)?,
        task_id: row.get("task_id").map_err(sql_error)?,
        action_type: enum_from_text(row.get::<_, String>("action_type").map_err(sql_error)?)?,
        title: row.get("title").map_err(sql_error)?,
        description: row.get("description").map_err(sql_error)?,
        payload: from_json(&row.get::<_, String>("payload_json").map_err(sql_error)?)?,
        status: enum_from_text(row.get::<_, String>("status").map_err(sql_error)?)?,
        created_at: row.get("created_at").map_err(sql_error)?,
        resolved_at: row.get("resolved_at").map_err(sql_error)?,
    })
}

fn recovery_binding_from_row(row: &rusqlite::Row<'_>) -> DomainResult<RecoveryBinding> {
    Ok(RecoveryBinding {
        session_id: row.get("session_id").map_err(sql_error)?,
        provider: enum_from_text(row.get::<_, String>("provider").map_err(sql_error)?)?,
        provider_session_id: row.get("provider_session_id").map_err(sql_error)?,
        worktree_path: row.get("worktree_path").map_err(sql_error)?,
        run_attempt_id: row.get("run_attempt_id").map_err(sql_error)?,
        updated_at: row.get("updated_at").map_err(sql_error)?,
    })
}

fn audit_event_from_row(row: &rusqlite::Row<'_>) -> DomainResult<EventEnvelope> {
    Ok(EventEnvelope {
        id: row.get("id").map_err(sql_error)?,
        entity_type: enum_from_text(row.get::<_, String>("entity_type").map_err(sql_error)?)?,
        entity_id: row.get("entity_id").map_err(sql_error)?,
        event_type: row.get("event_type").map_err(sql_error)?,
        source: enum_from_text(row.get::<_, String>("source").map_err(sql_error)?)?,
        correlation_id: row.get("correlation_id").map_err(sql_error)?,
        payload: from_json(&row.get::<_, String>("payload_json").map_err(sql_error)?)?,
        created_at: row.get("created_at").map_err(sql_error)?,
    })
}

fn enum_to_text<T: Serialize>(value: T) -> DomainResult<String> {
    let json = serde_json::to_value(value).map_err(json_error)?;
    json.as_str()
        .map(ToString::to_string)
        .ok_or_else(|| internal_error("enum must serialize to string", false))
}

fn enum_from_text<T: DeserializeOwned>(raw: String) -> DomainResult<T> {
    serde_json::from_value(Value::String(raw)).map_err(json_error)
}

fn to_json<T: Serialize>(value: &T) -> DomainResult<String> {
    serde_json::to_string(value).map_err(json_error)
}

fn from_json<T: DeserializeOwned>(raw: &str) -> DomainResult<T> {
    serde_json::from_str(raw).map_err(json_error)
}

fn internal_error(message: impl Into<String>, retryable: bool) -> ErrorEnvelope {
    ErrorEnvelope::new(ErrorCode::Internal, message, retryable)
}

pub fn sql_error(error: rusqlite::Error) -> ErrorEnvelope {
    internal_error(error.to_string(), true)
}

fn json_error(error: serde_json::Error) -> ErrorEnvelope {
    internal_error(error.to_string(), false)
}

pub fn matches_event_filter(event: &EventEnvelope, filter: &EventFilter) -> bool {
    filter
        .entity_type
        .as_ref()
        .map(|entity_type| {
            normalize_entity_type(entity_type) == normalize_event_entity_type(&event.entity_type)
        })
        .unwrap_or(true)
        && filter
            .entity_id
            .as_ref()
            .map(|entity_id| &event.entity_id == entity_id)
            .unwrap_or(true)
        && filter
            .since
            .as_ref()
            .map(|since| event.created_at >= *since)
            .unwrap_or(true)
}

pub fn normalize_entity_type(entity_type: &str) -> &'static str {
    match entity_type {
        "task" => "task",
        "session" => "session",
        "run" => "run",
        "worktree" => "worktree",
        "approval" => "approval",
        "tool_call" | "toolCall" => "tool_call",
        _ => "unknown",
    }
}

pub fn normalize_event_entity_type(entity_type: &EventEntityType) -> &'static str {
    match entity_type {
        EventEntityType::Task => "task",
        EventEntityType::Session => "session",
        EventEntityType::Run => "run",
        EventEntityType::Worktree => "worktree",
        EventEntityType::Approval => "approval",
        EventEntityType::ToolCall => "tool_call",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use daemon_core::domain::{
        EventSource, ProviderKind, SessionLaunchMode, SessionState, TaskStatus, TrustLevel, VcsType,
    };
    use daemon_core::ports::SessionRepository;

    fn temp_root(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("storage-sqlite-{name}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn creates_app_data_layout_and_migration_placeholder() {
        let root = temp_root("layout");
        let store = StorageSqlite::new(root).unwrap();
        let app_data = store.app_data_dir();
        assert!(app_data.join(STATE_DB_FILE).exists());
        assert!(app_data.join(LOGS_DIR).exists());
        assert!(app_data.join(TRANSCRIPTS_DIR).exists());
        assert!(app_data.join(ARTIFACTS_DIR).exists());
        assert!(app_data.join(DIAGNOSTICS_DIR).exists());
        assert!(store
            .migration_files()
            .iter()
            .any(|path| path.ends_with(INITIAL_MIGRATION_FILE)));
    }

    #[test]
    fn artifact_store_roundtrip() {
        let root = temp_root("artifacts");
        let store = StorageSqlite::new(root).unwrap();
        let path = store
            .write_artifact("session-1/run-1/patch.diff", b"diff")
            .unwrap();
        assert!(path.contains("patch.diff"));
        let data = store.read_artifact("session-1/run-1/patch.diff").unwrap();
        assert_eq!(data, b"diff");
    }

    #[test]
    fn workspace_task_session_roundtrip() {
        let root = temp_root("roundtrip");
        let store = StorageSqlite::new(root).unwrap();

        let workspace = Workspace {
            id: "ws-1".to_string(),
            display_name: "Workspace".to_string(),
            root_path: "/tmp/workspace".to_string(),
            vcs_type: VcsType::Git,
            repo_identity: Some("repo".to_string()),
            trust_level: TrustLevel::Trusted,
            default_provider: Some(ProviderKind::Claude),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        };
        store.put_workspace(workspace.clone()).unwrap();
        assert_eq!(store.get_workspace(&workspace.id).unwrap(), Some(workspace));

        let task = Task {
            id: "task-1".to_string(),
            workspace_id: "ws-1".to_string(),
            title: "Task".to_string(),
            prompt: "Prompt".to_string(),
            goal: Some("Goal".to_string()),
            constraints: Some(vec!["c1".to_string()]),
            requested_provider: Some(ProviderKind::Claude),
            requested_model: Some("claude-opus-4-6".to_string()),
            status: TaskStatus::Ready,
            active_plan_id: None,
            active_skill_profile_id: None,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        };
        store.put_task(task.clone()).unwrap();
        assert_eq!(store.get_task(&task.id).unwrap(), Some(task.clone()));

        let session = Session {
            id: "session-1".to_string(),
            task_id: task.id.clone(),
            workspace_id: "ws-1".to_string(),
            worktree_id: None,
            provider: ProviderKind::Claude,
            provider_session_id: Some("ps-1".to_string()),
            launch_mode: SessionLaunchMode::New,
            state: SessionState::Ready,
            current_step_id: None,
            last_activity_at: Some("1".to_string()),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        };
        store.put_session(session.clone()).unwrap();
        assert_eq!(store.get_session(&session.id).unwrap(), Some(session));
    }

    #[test]
    fn audit_event_roundtrip_and_filter() {
        let root = temp_root("audit");
        let store = StorageSqlite::new(root).unwrap();

        let event = EventEnvelope::new(
            "event-1",
            EventEntityType::Session,
            "session-1",
            "session.created",
            EventSource::Daemon,
            None,
            serde_json::json!({ "ok": true }),
            "10",
        );
        store.append_audit_event(event).unwrap();

        let events = store
            .list_audit_events(&EventFilter {
                entity_type: Some("session".to_string()),
                entity_id: Some("session-1".to_string()),
                since: Some("1".to_string()),
                limit: Some(10),
            })
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "session.created");
    }
}
