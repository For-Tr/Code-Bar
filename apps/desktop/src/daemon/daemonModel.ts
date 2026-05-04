import type {
  GetDiagnosticsOutput,
  GetNextActionOutput,
  Plan,
  PlanStep,
  Session,
  Task,
  Workspace,
  Worktree,
  ApprovalRequest,
  EventEnvelope,
} from "@codebar/contracts"

export interface TaskPlanView {
  plan?: Plan
  steps: PlanStep[]
}

export interface DaemonModelState {
  loading: boolean
  bootstrapped: boolean
  error: string | null
  tasksById: Record<string, Task>
  sessionsById: Record<string, Session>
  workspacesById: Record<string, Workspace>
  worktreesById: Record<string, Worktree>
  nextActionBySessionId: Record<string, GetNextActionOutput>
  approvalsBySessionId: Record<string, ApprovalRequest[]>
  diagnosticsBySessionId: Record<string, GetDiagnosticsOutput>
  activePlanByTaskId: Record<string, TaskPlanView>
  eventsBySessionId: Record<string, EventEnvelope[]>
  eventsByTaskId: Record<string, EventEnvelope[]>
}

export const emptyDaemonModelState: DaemonModelState = {
  loading: false,
  bootstrapped: false,
  error: null,
  tasksById: {},
  sessionsById: {},
  workspacesById: {},
  worktreesById: {},
  nextActionBySessionId: {},
  approvalsBySessionId: {},
  diagnosticsBySessionId: {},
  activePlanByTaskId: {},
  eventsBySessionId: {},
  eventsByTaskId: {},
}

export function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

export function appendEventTimeline(
  timelineById: Record<string, EventEnvelope[]>,
  entityId: string,
  event: EventEnvelope,
  maxItems = 200,
): Record<string, EventEnvelope[]> {
  const current = timelineById[entityId] ?? []
  const deduped = current.filter((item) => item.id !== event.id)
  const next = [...deduped, event]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-maxItems)
  return {
    ...timelineById,
    [entityId]: next,
  }
}

type SessionUpdatedPayload = Partial<Pick<Session, "provider" | "launchMode" | "state" | "updatedAt">> & {
  providerSessionId?: string | null
}

function isSessionUpdatedPayload(value: unknown): value is SessionUpdatedPayload {
  return !!value && typeof value === "object"
}

function isSessionState(value: unknown): value is Session["state"] {
  return value === "draft"
    || value === "preparing_workspace"
    || value === "preparing_worktree"
    || value === "ready"
    || value === "launching"
    || value === "running"
    || value === "waiting_input"
    || value === "approval_required"
    || value === "interrupted"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
    || value === "archived"
}

export function patchSessionFromEvent(session: Session, event: EventEnvelope): Session {
  const payload = event.payload ?? {}
  if (event.eventType === "session.provider_bound") {
    const providerSessionId = typeof payload.providerSessionId === "string"
      ? payload.providerSessionId
      : session.providerSessionId
    if (providerSessionId !== session.providerSessionId) {
      return {
        ...session,
        providerSessionId,
      }
    }
    return session
  }

  if (event.eventType === "session.updated") {
    const nextSession = payload.session
    if (isSessionUpdatedPayload(nextSession)) {
      const provider = nextSession.provider
      const providerSessionId = nextSession.providerSessionId
      const launchMode = nextSession.launchMode
      const state = nextSession.state
      const updatedAt = nextSession.updatedAt
      return {
        ...session,
        ...(provider === "claude" || provider === "codex" ? { provider } : {}),
        ...(providerSessionId === null
          ? { providerSessionId: undefined }
          : typeof providerSessionId === "string"
          ? { providerSessionId }
          : {}),
        ...(launchMode === "new" || launchMode === "resume" ? { launchMode } : {}),
        ...(isSessionState(state) ? { state } : {}),
        ...(typeof updatedAt === "string" ? { updatedAt } : {}),
      }
    }
    return session
  }

  const state = mapEventTypeToSessionState(event.eventType)
  if (!state || state === session.state) {
    return session
  }

  return {
    ...session,
    state,
  }
}

function mapEventTypeToSessionState(eventType: string): Session["state"] | null {
  switch (eventType) {
    case "session.launched":
    case "session.resumed":
    case "session.input_sent":
    case "session.runtime_running":
      return "running"
    case "session.runtime_waiting":
      return "waiting_input"
    case "session.runtime_error":
      return "failed"
    case "session.runtime_exit":
      return "completed"
    case "session.stopped":
      return "cancelled"
    case "session.recovered":
      return "interrupted"
    default:
      return null
  }
}
