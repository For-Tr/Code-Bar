import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type {
  ApprovalRequest,
  EventEnvelope,
  Task,
  Workspace,
  Worktree,
} from "@codebar/contracts"
import { createDaemonRpcClient } from "../services/daemonRpcClient"
import { subscribeDaemonEvents } from "../services/daemonEventClient"
import {
  appendEventTimeline,
  emptyDaemonModelState,
  indexById,
  patchSessionFromEvent,
  type DaemonModelState,
} from "./daemonModel"
import { useWorkspaceStore } from "../store/workspaceStore"

interface DaemonDataContextValue {
  state: DaemonModelState
  refreshSessionViews: (sessionId: string) => Promise<void>
  refreshTaskViews: (taskId: string) => Promise<void>
}

const DaemonDataContext = createContext<DaemonDataContextValue | null>(null)
let latestDaemonState: DaemonModelState = emptyDaemonModelState

export function getLatestDaemonState() {
  return latestDaemonState
}

function defaultApprovals(): ApprovalRequest[] {
  return []
}

function defaultEvents(): EventEnvelope[] {
  return []
}

export function DaemonDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DaemonModelState>(emptyDaemonModelState)

  useEffect(() => {
    latestDaemonState = state
  }, [state])

  const refreshSessionViews = useCallback(async (sessionId: string) => {
    if (!("__TAURI_INTERNALS__" in window)) return
    const rpc = createDaemonRpcClient()
    const sessionResponse = await rpc.getSession(sessionId).catch(() => null)
    const session = sessionResponse?.session
    if (!session) return

    const [nextAction, approvals, diagnostics, eventResult, worktreeResponse, taskResponse] = await Promise.all([
      rpc.getNextAction(sessionId).catch(() => null),
      rpc.listApprovals(sessionId).catch(() => ({ requests: defaultApprovals() })),
      rpc.getDiagnostics(sessionId, session.taskId).catch(() => null),
      rpc.listEvents("session", sessionId, 120).catch(() => ({ events: defaultEvents() })),
      session.worktreeId ? rpc.getWorktree(session.worktreeId).catch(() => null) : Promise.resolve(null),
      rpc.getTask(session.taskId).catch(() => null),
    ])

    setState((current) => {
      const nextState: DaemonModelState = {
        ...current,
        sessionsById: {
          ...current.sessionsById,
          [session.id]: session,
        },
      }

      if (taskResponse?.task) {
        nextState.tasksById = {
          ...nextState.tasksById,
          [taskResponse.task.id]: taskResponse.task,
        }
      }

      if (worktreeResponse?.worktree) {
        nextState.worktreesById = {
          ...nextState.worktreesById,
          [worktreeResponse.worktree.id]: worktreeResponse.worktree,
        }
      }

      if (nextAction) {
        nextState.nextActionBySessionId = {
          ...nextState.nextActionBySessionId,
          [sessionId]: nextAction,
        }
      }

      nextState.approvalsBySessionId = {
        ...nextState.approvalsBySessionId,
        [sessionId]: approvals.requests ?? defaultApprovals(),
      }

      if (diagnostics) {
        nextState.diagnosticsBySessionId = {
          ...nextState.diagnosticsBySessionId,
          [sessionId]: diagnostics,
        }
      }

      nextState.eventsBySessionId = {
        ...nextState.eventsBySessionId,
        [sessionId]: (eventResult.events ?? defaultEvents()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      }

      return nextState
    })
  }, [])

  const refreshTaskViews = useCallback(async (taskId: string) => {
    if (!("__TAURI_INTERNALS__" in window)) return
    const rpc = createDaemonRpcClient()
    const [taskResponse, activePlan, eventResult] = await Promise.all([
      rpc.getTask(taskId).catch(() => null),
      rpc.getActivePlan(taskId).catch(() => null),
      rpc.listEvents("task", taskId, 120).catch(() => ({ events: defaultEvents() })),
    ])

    if (!taskResponse?.task) return

    setState((current) => {
      const nextState: DaemonModelState = {
        ...current,
        tasksById: {
          ...current.tasksById,
          [taskResponse.task.id]: taskResponse.task,
        },
        eventsByTaskId: {
          ...current.eventsByTaskId,
          [taskResponse.task.id]: (eventResult.events ?? defaultEvents()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        },
      }

      if (activePlan) {
        nextState.activePlanByTaskId = {
          ...nextState.activePlanByTaskId,
          [taskId]: {
            plan: activePlan.plan,
            steps: activePlan.steps,
          },
        }
      }

      return nextState
    })
  }, [])

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setState((current) => ({
        ...current,
        bootstrapped: true,
        loading: false,
        error: null,
      }))
      return
    }

    let cancelled = false
    let cleanup: (() => void) | undefined

    const bootstrap = async () => {
      const rpc = createDaemonRpcClient()
      const localWorkspaces = useWorkspaceStore.getState().workspaces

      setState((current) => ({
        ...current,
        loading: true,
        error: null,
      }))

      try {
        await rpc.ensureReady()
        await Promise.all(localWorkspaces.map((workspace) => rpc.syncWorkspace(workspace).catch(() => null)))

        const [workspaceResult, worktreeResult, sessionsResult, tasksResult] = await Promise.all([
          rpc.listWorkspaces(),
          rpc.listWorktrees(),
          rpc.listSessions(),
          rpc.listTasks(),
        ])

        const sessions = sessionsResult.sessions ?? []
        const taskIds = new Set<string>((tasksResult.tasks ?? []).map((task) => task.id))
        sessions.forEach((session) => taskIds.add(session.taskId))

        const taskDetails = await Promise.all([...taskIds].map((taskId) => rpc.getTask(taskId).catch(() => null)))
        const tasks: Task[] = taskDetails
          .map((result) => result?.task)
          .filter((task): task is Task => !!task)

        const uniqueSessions = sessions

        const sessionViews = await Promise.all(uniqueSessions.map(async (session) => {
          const [nextAction, approvals, diagnostics, eventResult] = await Promise.all([
            rpc.getNextAction(session.id).catch(() => null),
            rpc.listApprovals(session.id).catch(() => ({ requests: defaultApprovals() })),
            rpc.getDiagnostics(session.id, session.taskId).catch(() => null),
            rpc.listEvents("session", session.id, 120).catch(() => ({ events: defaultEvents() })),
          ])

          return {
            session,
            nextAction,
            approvals: approvals.requests ?? defaultApprovals(),
            diagnostics,
            events: (eventResult.events ?? defaultEvents()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          }
        }))

        const taskViews = await Promise.all(tasks.map(async (task) => {
          const [activePlan, eventResult] = await Promise.all([
            rpc.getActivePlan(task.id).catch(() => null),
            rpc.listEvents("task", task.id, 120).catch(() => ({ events: defaultEvents() })),
          ])
          return {
            task,
            activePlan,
            events: (eventResult.events ?? defaultEvents()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          }
        }))

        if (cancelled) return

        const sessionsById = indexById(uniqueSessions)
        const tasksById = indexById(tasks)
        const workspacesById = indexById<Workspace>(workspaceResult.workspaces ?? [])
        const worktreesById = indexById<Worktree>(worktreeResult.worktrees ?? [])

        const nextActionBySessionId = Object.fromEntries(
          sessionViews
            .filter((view): view is typeof view & { nextAction: NonNullable<typeof view.nextAction> } => !!view.nextAction)
            .map((view) => [view.session.id, view.nextAction]),
        )

        const approvalsBySessionId = Object.fromEntries(
          sessionViews.map((view) => [view.session.id, view.approvals]),
        )

        const diagnosticsBySessionId = Object.fromEntries(
          sessionViews
            .filter((view): view is typeof view & { diagnostics: NonNullable<typeof view.diagnostics> } => !!view.diagnostics)
            .map((view) => [view.session.id, view.diagnostics]),
        )

        const eventsBySessionId = Object.fromEntries(
          sessionViews.map((view) => [view.session.id, view.events]),
        )

        const activePlanByTaskId = Object.fromEntries(
          taskViews
            .filter((view): view is typeof view & { activePlan: NonNullable<typeof view.activePlan> } => !!view.activePlan)
            .map((view) => [
              view.task.id,
              {
                plan: view.activePlan.plan,
                steps: view.activePlan.steps,
              },
            ]),
        )

        const eventsByTaskId = Object.fromEntries(
          taskViews.map((view) => [view.task.id, view.events]),
        )

        setState({
          loading: false,
          bootstrapped: true,
          error: null,
          tasksById,
          sessionsById,
          workspacesById,
          worktreesById,
          nextActionBySessionId,
          approvalsBySessionId,
          diagnosticsBySessionId,
          activePlanByTaskId,
          eventsBySessionId,
          eventsByTaskId,
        })

        cleanup = await subscribeDaemonEvents((event) => {
          setState((current) => {
            let nextState = current

            if (event.entityType === "session") {
              const sessionId = event.entityId
              const existing = current.sessionsById[sessionId]
              if (existing) {
                nextState = {
                  ...nextState,
                  sessionsById: {
                    ...nextState.sessionsById,
                    [sessionId]: patchSessionFromEvent(existing, event),
                  },
                }
              }
              nextState = {
                ...nextState,
                eventsBySessionId: appendEventTimeline(nextState.eventsBySessionId, sessionId, event),
              }
            }

            if (event.entityType === "task") {
              nextState = {
                ...nextState,
                eventsByTaskId: appendEventTimeline(nextState.eventsByTaskId, event.entityId, event),
              }
            }

            if (event.eventType.startsWith("approval.")) {
              const payload = event.payload as Record<string, unknown>
              const approval = payload.approval as Record<string, unknown> | undefined
              const sessionId = typeof approval?.sessionId === "string" ? approval.sessionId : null
              if (sessionId && nextState.sessionsById[sessionId]) {
                void refreshSessionViews(sessionId)
              }
            }

            if (event.eventType.startsWith("session.")) {
              const sessionId = event.entityId
              const session = nextState.sessionsById[sessionId]
              if (session) {
                void refreshSessionViews(session.id)
                void refreshTaskViews(session.taskId)
              }
            }

            if (event.eventType.startsWith("task.")) {
              void refreshTaskViews(event.entityId)
            }

            return nextState
          })
        })
      } catch (error) {
        if (cancelled) return
        setState((current) => ({
          ...current,
          loading: false,
          bootstrapped: true,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [refreshSessionViews, refreshTaskViews])

  const value = useMemo<DaemonDataContextValue>(() => ({
    state,
    refreshSessionViews,
    refreshTaskViews,
  }), [refreshSessionViews, refreshTaskViews, state])

  return (
    <DaemonDataContext.Provider value={value}>
      {children}
    </DaemonDataContext.Provider>
  )
}

export function useDaemonData() {
  const context = useContext(DaemonDataContext)
  if (!context) {
    throw new Error("useDaemonData must be used inside DaemonDataProvider")
  }
  return context
}
