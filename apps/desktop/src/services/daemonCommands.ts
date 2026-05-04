import { invoke } from '@tauri-apps/api/core'
import type {
  BindProviderSessionOutput,
  BootstrapSessionOutput,
  CreateSessionOutput,
  CreateTaskOutput,
  GetDiagnosticsOutput,
  GetNextActionOutput,
  GetWorkspaceOutput,
  GetWorktreeOutput,
  HealthCheckOutput,
  LaunchSessionOutput,
  ListApprovalRequestsOutput,
  ListSessionsOutput,
  ListWorkspacesOutput,
  ListWorktreesOutput,
  PrepareWorktreeOutput,
  RecordRuntimeLifecycleOutput,
  RequestApprovalOutput,
  ResolveApprovalOutput,
  Session,
  UpdateTaskOutput,
} from '@codebar/contracts'
import { daemonRequest } from './tauriDaemonRequest'
import { getI18n } from '../i18n'
import type { RunnerType } from '../store/settingsStore'
import type { ClaudeSession, SessionStatus } from '../store/sessionStore'
import type { Workspace as UiWorkspace } from '../store/workspaceStore'

function nowIsoString() {
  return new Date().toISOString()
}

function mapRunnerTypeToProvider(runnerType: RunnerType): 'claude' | 'codex' {
  return runnerType === 'claude-code' ? 'claude' : 'codex'
}

export type DaemonSessionSummary = Session

export async function createSession(input: {
  taskId: string
  provider: 'claude' | 'codex'
  worktreeStrategy: 'reuse' | 'new_managed' | 'ask'
}) {
  return daemonRequest<CreateSessionOutput>('createSession', input)
}

export async function prepareWorktree(input: {
  sessionId: string
  strategy: 'reuse' | 'new_managed'
}) {
  return daemonRequest<PrepareWorktreeOutput>('prepareWorktree', input)
}

function mapDaemonStateToSessionStatus(state: string | undefined): SessionStatus {
  switch (state) {
    case 'running':
    case 'launching':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'approval_required':
    case 'interrupted':
      return 'suspended'
    case 'completed':
      return 'done'
    case 'failed':
    case 'cancelled':
      return 'error'
    default:
      return 'idle'
  }
}

export async function ensureDaemonReady() {
  return invoke<void>('ensure_daemon_ready')
}

export async function daemonHealthCheck() {
  return invoke<HealthCheckOutput>('daemon_health_check')
}

export async function syncWorkspaceToDaemon(workspace: UiWorkspace) {
  const now = nowIsoString()
  return invoke<void>('daemon_upsert_workspace', {
    workspace: {
      id: workspace.id,
      displayName: workspace.name,
      rootPath: workspace.path,
      vcsType: 'git',
      repoIdentity: null,
      trustLevel: 'trusted',
      defaultProvider: null,
      createdAt: new Date(workspace.createdAt).toISOString(),
      updatedAt: now,
    },
  })
}

export async function createDaemonSession(input: {
  workspace: UiWorkspace
  runnerType: RunnerType
  title?: string
  prompt?: string
}) {
  await syncWorkspaceToDaemon(input.workspace)
  const prompt = input.prompt?.trim() || ''
  const fallbackTitle = getI18n().t('session.defaultName', { id: '' }).trim() || 'Session'
  const title = input.title?.trim() || (prompt ? prompt.slice(0, 48) : fallbackTitle)
  const taskResponse = await daemonRequest<CreateTaskOutput>('createTask', {
    workspaceId: input.workspace.id,
    title,
    prompt: prompt || 'Awaiting first prompt',
    requestedProvider: mapRunnerTypeToProvider(input.runnerType),
  })
  const sessionResponse = await createSession({
    taskId: taskResponse.task.id,
    provider: mapRunnerTypeToProvider(input.runnerType),
    worktreeStrategy: 'new_managed',
  })

  return {
    taskId: taskResponse.task.id,
    sessionId: sessionResponse.session.id,
    worktree: null,
  }
}

export async function updateDaemonTask(input: {
  taskId: string
  title?: string
  prompt?: string
}) {
  return daemonRequest<UpdateTaskOutput>('updateTask', {
    taskId: input.taskId,
    title: input.title,
    prompt: input.prompt,
  })
}

export async function updateDaemonSession(input: {
  sessionId: string
  provider?: 'claude' | 'codex'
}) {
  return daemonRequest<Session>('updateSession', {
    sessionId: input.sessionId,
    provider: input.provider,
  })
}

export async function bootstrapDaemonSession(input: {
  sessionId: string
  strategy: 'reuse' | 'new_managed'
}) {
  return daemonRequest<BootstrapSessionOutput>('bootstrapSession', {
    sessionId: input.sessionId,
    strategy: input.strategy,
  })
}

export async function createDaemonDraftSession(input: {
  workspace: UiWorkspace
  runnerType: RunnerType
  title?: string
  prompt?: string
}) {
  return createDaemonSession(input)
}

export async function launchDaemonSession(sessionId: string) {
  return daemonRequest<LaunchSessionOutput>('launchSession', { sessionId })
}

export async function resumeDaemonSession(sessionId: string) {
  return daemonRequest<LaunchSessionOutput>('resumeSession', { sessionId })
}

export async function sendDaemonSessionInput(sessionId: string, text: string) {
  return daemonRequest<Record<string, unknown>>('sendSessionInput', { sessionId, text })
}

export async function recordDaemonRuntimeLifecycle(
  sessionId: string,
  eventType: 'running' | 'waiting' | 'error' | 'exit',
  message?: string
) {
  return daemonRequest<RecordRuntimeLifecycleOutput>('recordRuntimeLifecycle', {
    sessionId,
    eventType,
    message: message ?? null,
  })
}

export async function stopDaemonSession(sessionId: string, reason?: string) {
  return daemonRequest<Record<string, unknown>>('stopSession', {
    sessionId,
    reason: reason ?? null,
  })
}

export async function listDaemonSessions() {
  return daemonRequest<ListSessionsOutput>('listSessions', {})
}

export async function getDaemonNextAction(sessionId: string) {
  return daemonRequest<GetNextActionOutput>('getNextAction', { sessionId })
}

export async function listDaemonApprovals(sessionId: string) {
  return daemonRequest<ListApprovalRequestsOutput>('listApprovalRequests', {
    sessionId,
    status: ['pending'],
  })
}

export async function resolveDaemonApproval(approvalRequestId: string, decision: 'approved' | 'rejected') {
  return daemonRequest<ResolveApprovalOutput>('resolveApproval', { approvalRequestId, decision })
}

export async function requestDangerousSessionAction(input: {
  sessionId: string
  actionType: 'write' | 'delete' | 'git_push' | 'dangerous_bash' | 'external_side_effect'
  title: string
  description: string
  payload?: Record<string, unknown>
}) {
  return daemonRequest<RequestApprovalOutput>('requestApproval', {
    sessionId: input.sessionId,
    actionType: input.actionType,
    title: input.title,
    description: input.description,
    payload: input.payload ?? {},
  })
}

export async function getDaemonDiagnostics(sessionId: string, taskId?: string) {
  return daemonRequest<GetDiagnosticsOutput>('getDiagnostics', {
    sessionId,
    taskId: taskId ?? null,
  })
}

export async function bindProviderSession(sessionId: string, providerSessionId: string) {
  return invoke<BindProviderSessionOutput>('daemon_bind_provider_session', {
    sessionId,
    providerSessionId,
  })
}

export async function getDaemonWorkspace(workspaceId: string) {
  return daemonRequest<GetWorkspaceOutput>('getWorkspace', { workspaceId })
}

export async function listDaemonWorkspaces() {
  return daemonRequest<ListWorkspacesOutput>('listWorkspaces', {})
}

export async function getDaemonWorktree(worktreeId: string) {
  return daemonRequest<GetWorktreeOutput>('getWorktree', { worktreeId })
}

export async function listDaemonWorktrees(workspaceId?: string) {
  return daemonRequest<ListWorktreesOutput>('listWorktrees', {
    workspaceId: workspaceId ?? null,
  })
}

export function mapDaemonSessionToUiSession(input: {
  session: Session
  taskTitle?: string
  worktreeById?: Record<string, Record<string, unknown>>
  workspacePathById: Record<string, string>
  runnerType: RunnerType
}): ClaudeSession {
  const sessionId = String(input.session.id ?? '')
  const workspaceId = String(input.session.workspaceId ?? '')
  const worktreeId = typeof input.session.worktreeId === 'string' ? input.session.worktreeId : undefined
  const worktree = worktreeId ? input.worktreeById?.[worktreeId] : undefined
  const workdir = typeof worktree?.path === 'string'
    ? worktree.path
    : (input.workspacePathById[workspaceId] ?? '')

  return {
    id: sessionId,
    name: input.taskTitle || `Session ${sessionId}`,
    workspaceId,
    workdir,
    status: mapDaemonStateToSessionStatus(typeof input.session.state === 'string' ? input.session.state : undefined),
    currentTask: input.taskTitle || '',
    createdAt: Date.parse(String(input.session.createdAt ?? nowIsoString())) || Date.now(),
    diffFiles: [],
    output: [],
    runner: {
      type: input.runnerType,
    },
    branchName: typeof worktree?.branchName === 'string' ? worktree.branchName : undefined,
    baseBranch: typeof worktree?.baseBranch === 'string' ? worktree.baseBranch : undefined,
    worktreePath: typeof worktree?.path === 'string' ? worktree.path : undefined,
    providerSessionId: typeof input.session.providerSessionId === 'string' ? input.session.providerSessionId : undefined,
    taskId: typeof input.session.taskId === 'string' ? input.session.taskId : undefined,
    daemonWorktreeId: worktreeId,
  }
}
