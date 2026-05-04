import type {
  EventEntityType,
  GetActivePlanOutput,
  GetDiagnosticsOutput,
  GetNextActionOutput,
  GetSessionOutput,
  GetTaskOutput,
  GetWorktreeOutput,
  ListApprovalRequestsOutput,
  ListEventsOutput,
  ListSessionsOutput,
  ListTasksOutput,
  ListWorkspacesOutput,
  ListWorktreesOutput,
} from "@codebar/contracts"
import { daemonRequest } from "./tauriDaemonRequest"
import {
  ensureDaemonReady,
  getDaemonDiagnostics,
  getDaemonNextAction,
  getDaemonWorktree,
  listDaemonApprovals,
  listDaemonSessions,
  listDaemonWorkspaces,
  listDaemonWorktrees,
  syncWorkspaceToDaemon,
} from "./daemonCommands"
import type { Workspace as UiWorkspace } from "../store/workspaceStore"

export interface DaemonRpcClient {
  ensureReady: () => Promise<void>
  syncWorkspace: (workspace: UiWorkspace) => Promise<void>
  listWorkspaces: () => Promise<ListWorkspacesOutput>
  listWorktrees: (workspaceId?: string) => Promise<ListWorktreesOutput>
  listSessions: () => Promise<ListSessionsOutput>
  listTasks: (workspaceId?: string) => Promise<ListTasksOutput>
  getTask: (taskId: string) => Promise<GetTaskOutput>
  getSession: (sessionId: string) => Promise<GetSessionOutput>
  getWorktree: (worktreeId: string) => Promise<GetWorktreeOutput>
  getActivePlan: (taskId: string) => Promise<GetActivePlanOutput>
  getNextAction: (sessionId: string) => Promise<GetNextActionOutput>
  listApprovals: (sessionId: string) => Promise<ListApprovalRequestsOutput>
  getDiagnostics: (sessionId: string, taskId?: string | null) => Promise<GetDiagnosticsOutput>
  listEvents: (entityType: EventEntityType, entityId: string, limit?: number) => Promise<ListEventsOutput>
}

export function createDaemonRpcClient(): DaemonRpcClient {
  return {
    ensureReady: () => ensureDaemonReady(),
    syncWorkspace: (workspace) => syncWorkspaceToDaemon(workspace),
    listWorkspaces: () => listDaemonWorkspaces(),
    listWorktrees: (workspaceId) => listDaemonWorktrees(workspaceId),
    listSessions: () => listDaemonSessions(),
    listTasks: (workspaceId) => daemonRequest<ListTasksOutput>("listTasks", {
      workspaceId: workspaceId ?? null,
      status: null,
    }),
    getTask: (taskId) => daemonRequest<GetTaskOutput>("getTask", { taskId }),
    getSession: (sessionId) => daemonRequest<GetSessionOutput>("getSession", { sessionId }),
    getWorktree: (worktreeId) => getDaemonWorktree(worktreeId),
    getActivePlan: (taskId) => daemonRequest<GetActivePlanOutput>("getActivePlan", { taskId }),
    getNextAction: (sessionId) => getDaemonNextAction(sessionId),
    listApprovals: (sessionId) => listDaemonApprovals(sessionId),
    getDiagnostics: (sessionId, taskId) => getDaemonDiagnostics(sessionId, taskId ?? undefined),
    listEvents: (entityType, entityId, limit = 120) => daemonRequest<ListEventsOutput>("listEvents", {
      entityType,
      entityId,
      limit,
    }),
  }
}
