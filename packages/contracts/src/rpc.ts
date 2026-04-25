import type { ApprovalActionType, Plan, PlanMode, PlanStep, ProviderKind, RunAttempt, Session, Task, TaskStatus, Worktree } from "./domain";
import type { EventEntityType, EventEnvelope } from "./events";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type WorktreeStrategy = "reuse" | "new_managed" | "ask";
export type ApprovalDecision = "approved" | "rejected";

export interface SessionFileReadResult {
  path: string;
  content: string;
  versionToken: string | null;
  isBinary: boolean;
  missing: boolean;
}

export interface SessionFileWriteResult {
  path: string;
  versionToken: string | null;
}

export type SessionDirectoryEntryKind = "file" | "dir";

export interface SessionDirectoryEntry {
  name: string;
  path: string;
  kind: SessionDirectoryEntryKind;
}

export interface SessionDirectoryListResult {
  path: string;
  entries: SessionDirectoryEntry[];
}

export type ScmStatusKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface ScmStatusEntry {
  path: string;
  kind: ScmStatusKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  oldPath?: string | null;
}

export interface ScmStatusGroups {
  conflicts: ScmStatusEntry[];
  staged: ScmStatusEntry[];
  unstaged: ScmStatusEntry[];
  untracked: ScmStatusEntry[];
}

export type ConflictFileVersionLabel = "base" | "ours" | "theirs" | "working";

export interface ConflictFileVersion {
  label: ConflictFileVersionLabel;
  content: string;
  isBinary: boolean;
  missing: boolean;
}

export interface ConflictFilePayload {
  path: string;
  versions: ConflictFileVersion[];
}

export interface DeletedSessionRef {
  sessionId: string;
  workspaceId?: string | null;
}

export interface DeletedWorkspaceRef {
  workspaceId: string;
  path?: string | null;
}

export interface DeletedUiState {
  sessionIds?: string[];
  workspaceIds?: string[];
  sessions?: DeletedSessionRef[];
  workspaces?: DeletedWorkspaceRef[];
}

export interface SaveRecoveryBindingInput {
  sessionId: string;
  runnerType: string;
  providerSessionId: string;
  worktreePath?: string;
}

export interface BackfillSessionBindingInput {
  sessionId: string;
  runnerType: string;
  worktreePath?: string;
  providerSessionId?: string;
}

export interface BackfilledSessionBinding {
  sessionId: string;
  providerSessionId: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  taskId: string;
  actionType: ApprovalActionType;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateTaskInput {
  workspaceId: string;
  title: string;
  prompt: string;
  goal?: string;
  constraints?: string[];
  requestedProvider?: ProviderKind;
}

export interface CreateTaskOutput { task: Task }
export interface ListTasksInput { workspaceId?: string; status?: TaskStatus[] }
export interface ListTasksOutput { tasks: Task[] }
export interface GetTaskInput { taskId: string }
export interface GetTaskOutput { task: Task }
export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  prompt?: string;
  goal?: string;
  constraints?: string[];
  status?: TaskStatus;
}
export interface UpdateTaskOutput { task: Task }
export interface CreateSessionInput { taskId: string; provider: ProviderKind; worktreeStrategy: WorktreeStrategy }
export interface CreateSessionOutput { session: Session }
export interface LaunchSessionInput { sessionId: string }
export interface LaunchSessionOutput { session: Session; run: RunAttempt }
export interface ResumeSessionInput { sessionId: string }
export interface ResumeSessionOutput { session: Session; run: RunAttempt }
export interface SendSessionInputInput { sessionId: string; text: string }
export interface AcceptedOutput { accepted: true }
export interface StopSessionInput { sessionId: string; reason?: string }
export interface PrepareWorktreeInput { sessionId: string; strategy: Exclude<WorktreeStrategy, "ask"> }
export interface PrepareWorktreeOutput { worktree: Worktree }
export interface CleanupWorktreeInput { worktreeId: string }
export interface GetActivePlanInput { taskId: string }
export interface GetActivePlanOutput { plan?: Plan; steps: PlanStep[] }
export interface GetNextActionInput { sessionId: string }
export interface GetNextActionOutput {
  taskId: string;
  step?: PlanStep;
  mode: PlanMode;
  activeSkills: string[];
  recommendedNextCalls: string[];
}
export interface ListApprovalRequestsInput { sessionId?: string; taskId?: string; status?: ApprovalStatus[] }
export interface ListApprovalRequestsOutput { requests: ApprovalRequest[] }
export interface ResolveApprovalInput { approvalRequestId: string; decision: ApprovalDecision }
export interface ResolveApprovalOutput { request: ApprovalRequest }
export interface ListEventsInput { entityType?: EventEntityType; entityId?: string; since?: string; limit?: number }
export interface ListEventsOutput { events: EventEnvelope[] }
export interface GetDiagnosticsInput { sessionId?: string; taskId?: string }
export interface GetDiagnosticsOutput { summary: string; files: string[] }
