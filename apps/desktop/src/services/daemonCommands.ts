import { invoke } from '@tauri-apps/api/core'
import type {
  BindProviderSessionOutput,
  CreateSessionOutput,
  CreateTaskOutput,
  GetDiagnosticsOutput,
  GetNextActionOutput,
  HealthCheckOutput,
  LaunchSessionOutput,
  ListApprovalRequestsOutput,
  ListSessionsOutput,
  PrepareWorktreeOutput,
  RecordRuntimeLifecycleOutput,
  RequestApprovalOutput,
  ResolveApprovalOutput,
  Session,
} from '@codebar/contracts'
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
  return invoke<CreateSessionOutput>('daemon_request', {
    method: 'createSession',
    params: input,
  })
}

export async function prepareWorktree(input: {
  sessionId: string
  strategy: 'reuse' | 'new_managed'
}) {
  return invoke<PrepareWorktreeOutput>('daemon_request', {
    method: 'prepareWorktree',
    params: input,
  })
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
  const title = input.title?.trim() || `Session ${Date.now()}`
  const prompt = input.prompt?.trim() || 'Awaiting first prompt'
  const taskResponse = await invoke<CreateTaskOutput>('daemon_request', {
    method: 'createTask',
    params: {
      workspaceId: input.workspace.id,
      title,
      prompt,
      requestedProvider: mapRunnerTypeToProvider(input.runnerType),
    },
  })
  const sessionResponse = await invoke<CreateSessionOutput>('daemon_request', {
    method: 'createSession',
    params: {
      taskId: taskResponse.task.id,
      provider: mapRunnerTypeToProvider(input.runnerType),
      worktreeStrategy: 'new_managed',
    },
  })
  const worktreeResponse = await invoke<PrepareWorktreeOutput>('daemon_request', {
    method: 'prepareWorktree',
    params: {
      sessionId: sessionResponse.session.id,
      strategy: 'new_managed',
    },
  })

  return {
    taskId: taskResponse.task.id,
    sessionId: sessionResponse.session.id,
    worktree: worktreeResponse.worktree ?? null,
  }
}

export async function launchDaemonSession(sessionId: string) {
  return invoke<LaunchSessionOutput>('daemon_request', {
    method: 'launchSession',
    params: { sessionId },
  })
}

export async function resumeDaemonSession(sessionId: string) {
  return invoke<LaunchSessionOutput>('daemon_request', {
    method: 'resumeSession',
    params: { sessionId },
  })
}

export async function sendDaemonSessionInput(sessionId: string, text: string) {
  return invoke<Record<string, unknown>>('daemon_request', {
    method: 'sendSessionInput',
    params: { sessionId, text },
  })
}

export async function recordDaemonRuntimeLifecycle(
  sessionId: string,
  eventType: 'running' | 'waiting' | 'error' | 'exit',
  message?: string
) {
  return invoke<RecordRuntimeLifecycleOutput>('daemon_request', {
    method: 'recordRuntimeLifecycle',
    params: { sessionId, eventType, message: message ?? null },
  })
}

export async function stopDaemonSession(sessionId: string) {
  return invoke<Record<string, unknown>>('daemon_request', {
    method: 'stopSession',
    params: { sessionId },
  })
}

export async function listDaemonSessions() {
  return invoke<ListSessionsOutput>('daemon_request', {
    method: 'listSessions',
    params: {},
  })
}

export async function getDaemonNextAction(sessionId: string) {
  return invoke<GetNextActionOutput>('daemon_request', {
    method: 'getNextAction',
    params: { sessionId },
  })
}

export async function listDaemonApprovals(sessionId: string) {
  return invoke<ListApprovalRequestsOutput>('daemon_request', {
    method: 'listApprovalRequests',
    params: { sessionId, status: ['pending'] },
  })
}

export async function resolveDaemonApproval(approvalRequestId: string, decision: 'approved' | 'rejected') {
  return invoke<ResolveApprovalOutput>('daemon_request', {
    method: 'resolveApproval',
    params: { approvalRequestId, decision },
  })
}

export async function requestDangerousSessionAction(input: {
  sessionId: string
  actionType: 'write' | 'delete' | 'git_push' | 'dangerous_bash' | 'external_side_effect'
  title: string
  description: string
  payload?: Record<string, unknown>
}) {
  return invoke<RequestApprovalOutput>('daemon_request', {
    method: 'requestApproval',
    params: {
      sessionId: input.sessionId,
      actionType: input.actionType,
      title: input.title,
      description: input.description,
      payload: input.payload ?? {},
    },
  })
}

export async function getDaemonDiagnostics(sessionId: string, taskId?: string) {
  return invoke<GetDiagnosticsOutput>('daemon_request', {
    method: 'getDiagnostics',
    params: { sessionId, taskId: taskId ?? null },
  })
}

export async function bindProviderSession(sessionId: string, providerSessionId: string) {
  return invoke<BindProviderSessionOutput>('daemon_bind_provider_session', {
    sessionId,
    providerSessionId,
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
