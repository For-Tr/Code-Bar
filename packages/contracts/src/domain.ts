export type VcsType = "git" | "none";
export type TrustLevel = "trusted" | "untrusted";
export type ProviderKind = "claude" | "codex";
export type WorktreeSource = "existing" | "managed";
export type WorktreeLifecycleState = "preparing" | "ready" | "in_use" | "cleanup_pending" | "removed" | "error";
export type WorktreeCleanupPolicy = "manual" | "auto_on_task_done" | "keep";
export type TaskStatus = "draft" | "ready" | "active" | "blocked" | "completed" | "failed" | "cancelled" | "archived";
export type SessionLaunchMode = "new" | "resume";
export type SessionState = "draft" | "preparing_workspace" | "preparing_worktree" | "ready" | "launching" | "running" | "waiting_input" | "approval_required" | "interrupted" | "completed" | "failed" | "cancelled" | "archived";
export type LauncherType = "pty" | "headless";
export type RunExitReason = "completed" | "error" | "killed" | "crash" | "unknown";
export type RunAttemptStatus = "created" | "running" | "exited";
export type PlanMode = "guided" | "open";
export type PlanStatus = "draft" | "active" | "completed" | "cancelled";
export type PlanStepStatus = "pending" | "claimed" | "running" | "blocked" | "completed" | "cancelled";
export type SkillProfileSource = "workspace" | "worktree" | "task" | "step";
export type ApprovalActionType = "write" | "delete" | "git_push" | "dangerous_bash" | "external_side_effect";

export interface Workspace {
  id: string;
  displayName: string;
  rootPath: string;
  vcsType: VcsType;
  repoIdentity?: string;
  trustLevel: TrustLevel;
  defaultProvider?: ProviderKind;
  createdAt: string;
  updatedAt: string;
}

export interface Worktree {
  id: string;
  workspaceId: string;
  path: string;
  branchName?: string;
  baseBranch?: string;
  source: WorktreeSource;
  lifecycleState: WorktreeLifecycleState;
  cleanupPolicy: WorktreeCleanupPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  goal?: string;
  constraints?: string[];
  requestedProvider?: ProviderKind;
  requestedModel?: string;
  status: TaskStatus;
  activePlanId?: string;
  activeSkillProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  taskId: string;
  workspaceId: string;
  worktreeId?: string;
  provider: ProviderKind;
  providerSessionId?: string;
  launchMode: SessionLaunchMode;
  state: SessionState;
  currentStepId?: string;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunAttempt {
  id: string;
  sessionId: string;
  attemptNo: number;
  launcherType: LauncherType;
  command: string;
  args: string[];
  cwd: string;
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  exitReason?: RunExitReason;
  status: RunAttemptStatus;
}

export interface Plan {
  id: string;
  taskId: string;
  mode: PlanMode;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStep {
  id: string;
  planId: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  dependsOn: string[];
  parallelizable: boolean;
  requiredSkills: string[];
  allowedProviders?: ProviderKind[];
  leaseOwnerSessionId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  progressSummary?: string;
  progressDetails?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillProfile {
  id: string;
  name: string;
  source: SkillProfileSource;
  workspaceId?: string;
  worktreeId?: string;
  taskId?: string;
  stepId?: string;
  allowedSkills: string[];
  preferredSkills?: string[];
  forbiddenSkills?: string[];
  createdAt: string;
  updatedAt: string;
}
