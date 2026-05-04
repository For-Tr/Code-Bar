-- Module 04 initial schema

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  vcs_type TEXT NOT NULL,
  repo_identity TEXT,
  trust_level TEXT NOT NULL,
  default_provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  branch_name TEXT,
  base_branch TEXT,
  source TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  cleanup_policy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  goal TEXT,
  constraints_json TEXT,
  requested_provider TEXT,
  requested_model TEXT,
  status TEXT NOT NULL,
  active_plan_id TEXT,
  active_skill_profile_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  worktree_id TEXT,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  launch_mode TEXT NOT NULL,
  state TEXT NOT NULL,
  current_step_id TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  launcher_type TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  cwd TEXT NOT NULL,
  pid INTEGER,
  started_at TEXT,
  ended_at TEXT,
  exit_reason TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  parallelizable INTEGER NOT NULL,
  required_skills_json TEXT NOT NULL,
  allowed_providers_json TEXT,
  lease_owner_session_id TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  progress_summary TEXT,
  progress_details_json TEXT,
  outputs_json TEXT,
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace_id TEXT,
  worktree_id TEXT,
  task_id TEXT,
  step_id TEXT,
  allowed_skills_json TEXT NOT NULL,
  preferred_skills_json TEXT,
  forbidden_skills_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  correlation_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_bindings (
  session_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  worktree_path TEXT,
  run_attempt_id TEXT,
  updated_at TEXT NOT NULL
);
