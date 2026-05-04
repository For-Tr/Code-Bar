import type { ApprovalRequest, EventEnvelope, Session, Task, Worktree } from "@codebar/contracts"
import type { RunnerType } from "../store/settingsStore"
import type { ClaudeSession, SessionStatus } from "../store/sessionStore"
import type { Workspace as UiWorkspace } from "../store/workspaceStore"
import type { DaemonModelState } from "./daemonModel"

export interface DaemonSessionView {
  session: Session
  task?: Task
  worktree?: Worktree
  runnerType: RunnerType
  uiStatus: SessionStatus
}

export function mapDaemonStateToUiStatus(state: Session["state"]): SessionStatus {
  switch (state) {
    case "running":
    case "launching":
      return "running"
    case "waiting_input":
      return "waiting"
    case "approval_required":
    case "interrupted":
      return "suspended"
    case "completed":
      return "done"
    case "failed":
    case "cancelled":
      return "error"
    default:
      return "idle"
  }
}

export function runnerTypeFromProvider(provider: Session["provider"]): RunnerType {
  return provider === "codex" ? "codex" : "claude-code"
}

export function selectSessionView(state: DaemonModelState, sessionId: string): DaemonSessionView | null {
  const session = state.sessionsById[sessionId]
  if (!session) return null
  return {
    session,
    task: state.tasksById[session.taskId],
    worktree: session.worktreeId ? state.worktreesById[session.worktreeId] : undefined,
    runnerType: runnerTypeFromProvider(session.provider),
    uiStatus: mapDaemonStateToUiStatus(session.state),
  }
}

export function resolveEffectiveSessionWorkdir(
  state: DaemonModelState,
  sessionId: string,
  uiSession?: Pick<ClaudeSession, "worktreePath" | "workdir"> | null,
  workspace?: Pick<UiWorkspace, "path"> | null,
): string {
  const sessionView = selectSessionView(state, sessionId)
  const daemonWorkdir = sessionView?.worktree?.path?.trim()
  if (daemonWorkdir) return daemonWorkdir

  const persistedWorktreePath = uiSession?.worktreePath?.trim()
  if (persistedWorktreePath) return persistedWorktreePath

  const workspacePath = workspace?.path?.trim()
  if (workspacePath) return workspacePath

  const persistedWorkdir = uiSession?.workdir?.trim()
  if (persistedWorkdir) return persistedWorkdir

  return ""
}

export function selectApprovals(state: DaemonModelState, sessionId: string): ApprovalRequest[] {
  return state.approvalsBySessionId[sessionId] ?? []
}

export function selectDiagnosticsSummary(state: DaemonModelState, sessionId: string): string {
  return state.diagnosticsBySessionId[sessionId]?.summary ?? ""
}

export function selectSessionTimeline(state: DaemonModelState, sessionId: string): EventEnvelope[] {
  return state.eventsBySessionId[sessionId] ?? []
}

export function selectTaskTimeline(state: DaemonModelState, taskId: string): EventEnvelope[] {
  return state.eventsByTaskId[taskId] ?? []
}

export function selectTaskSessions(state: DaemonModelState, taskId: string): Session[] {
  return Object.values(state.sessionsById)
    .filter((session) => session.taskId === taskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function selectWorkspaceSessions(state: DaemonModelState, workspaceId: string): Session[] {
  return Object.values(state.sessionsById)
    .filter((session) => session.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
