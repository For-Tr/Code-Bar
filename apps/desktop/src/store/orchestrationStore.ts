import { create } from 'zustand'

export interface ApprovalRequestRecord {
  id: string
  sessionId: string
  taskId: string
  actionType: string
  title: string
  description: string
  status: string
}

export interface SessionNextAction {
  taskId: string
  mode: string
  step?: {
    id?: string
    title?: string
    description?: string
  } | null
  activeSkills: string[]
  recommendedNextCalls: string[]
}

export interface SessionDiagnostics {
  summary: string
  files: string[]
  lastExecutionMessage?: string
  recoveryDetail?: string
}

interface OrchestrationStore {
  approvalsBySessionId: Record<string, ApprovalRequestRecord[]>
  nextActionBySessionId: Record<string, SessionNextAction>
  diagnosticsBySessionId: Record<string, SessionDiagnostics>
  setApprovals: (sessionId: string, approvals: ApprovalRequestRecord[]) => void
  setNextAction: (sessionId: string, nextAction: SessionNextAction) => void
  setDiagnostics: (sessionId: string, diagnostics: SessionDiagnostics) => void
  clearApprovals: (sessionId: string) => void
}

export const useOrchestrationStore = create<OrchestrationStore>((set) => ({
  approvalsBySessionId: {},
  nextActionBySessionId: {},
  diagnosticsBySessionId: {},
  setApprovals: (sessionId, approvals) =>
    set((state) => ({
      approvalsBySessionId: {
        ...state.approvalsBySessionId,
        [sessionId]: approvals,
      },
    })),
  setNextAction: (sessionId, nextAction) =>
    set((state) => ({
      nextActionBySessionId: {
        ...state.nextActionBySessionId,
        [sessionId]: nextAction,
      },
    })),
  setDiagnostics: (sessionId, diagnostics) =>
    set((state) => ({
      diagnosticsBySessionId: {
        ...state.diagnosticsBySessionId,
        [sessionId]: diagnostics,
      },
    })),
  clearApprovals: (sessionId) =>
    set((state) => ({
      approvalsBySessionId: {
        ...state.approvalsBySessionId,
        [sessionId]: [],
      },
    })),
}))
