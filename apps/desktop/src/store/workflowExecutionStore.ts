import { create } from "zustand";

export type WorkflowExecutionState =
  | "queued"
  | "dispatching"
  | "sent"
  | "running"
  | "waiting"
  | "error";

export type AutoContinueDecisionState = "continued" | "stopped";

export interface WorkflowExecutionIntent {
  sessionId: string;
  stepId?: string;
  action: string;
  prompt: string;
  leaseToken?: string;
  revision?: string;
}

export interface AutoContinueDecision {
  state: AutoContinueDecisionState;
  reason: string;
  detail?: string;
}

export type WorkflowExecutionQueueResult =
  | { accepted: true }
  | { accepted: false; reason: "execution_already_active" | "stale_revision" };

interface WorkflowExecutionStore {
  pendingIntentBySessionId: Record<string, WorkflowExecutionIntent | null>;
  activeIntentBySessionId: Record<string, WorkflowExecutionIntent | null>;
  executionStateBySessionId: Record<string, WorkflowExecutionState | null>;
  lastAcceptedRevisionBySessionId: Record<string, string | null>;
  lastAutoContinueDecisionBySessionId: Record<string, AutoContinueDecision | null>;

  enqueueIntent: (intent: WorkflowExecutionIntent) => WorkflowExecutionQueueResult;
  beginDispatch: (sessionId: string) => WorkflowExecutionIntent | null;
  markSent: (sessionId: string) => void;
  markRunning: (sessionId: string) => void;
  markWaiting: (sessionId: string) => void;
  markError: (sessionId: string) => void;
  clearIntent: (sessionId: string) => void;
  setAutoContinueDecision: (sessionId: string, decision: AutoContinueDecision | null) => void;
}

function isExecutionActive(state: WorkflowExecutionState | null | undefined) {
  return state === "queued" || state === "dispatching" || state === "sent" || state === "running";
}

function isRevisionStale(currentRevision: string | null | undefined, nextRevision: string | undefined) {
  if (!currentRevision || !nextRevision) return false;
  const currentValue = Number(currentRevision.replace(/^rev-/, ""));
  const nextValue = Number(nextRevision.replace(/^rev-/, ""));
  if (Number.isNaN(currentValue) || Number.isNaN(nextValue)) return currentRevision === nextRevision;
  return nextValue <= currentValue;
}

export const useWorkflowExecutionStore = create<WorkflowExecutionStore>()((set, get) => ({
  pendingIntentBySessionId: {},
  activeIntentBySessionId: {},
  executionStateBySessionId: {},
  lastAcceptedRevisionBySessionId: {},
  lastAutoContinueDecisionBySessionId: {},

  enqueueIntent: (intent) => {
    const currentState = get().executionStateBySessionId[intent.sessionId];
    const currentRevision = get().lastAcceptedRevisionBySessionId[intent.sessionId];
    if (isExecutionActive(currentState)) {
      return { accepted: false, reason: "execution_already_active" };
    }
    if (isRevisionStale(currentRevision, intent.revision)) {
      return { accepted: false, reason: "stale_revision" };
    }

    set((state) => ({
      pendingIntentBySessionId: {
        ...state.pendingIntentBySessionId,
        [intent.sessionId]: intent,
      },
      executionStateBySessionId: {
        ...state.executionStateBySessionId,
        [intent.sessionId]: "queued",
      },
      lastAcceptedRevisionBySessionId: {
        ...state.lastAcceptedRevisionBySessionId,
        [intent.sessionId]: intent.revision ?? state.lastAcceptedRevisionBySessionId[intent.sessionId] ?? null,
      },
    }));

    return { accepted: true };
  },

  beginDispatch: (sessionId) => {
    const intent = get().pendingIntentBySessionId[sessionId] ?? null;
    if (!intent) return null;
    set((state) => ({
      pendingIntentBySessionId: {
        ...state.pendingIntentBySessionId,
        [sessionId]: null,
      },
      activeIntentBySessionId: {
        ...state.activeIntentBySessionId,
        [sessionId]: intent,
      },
      executionStateBySessionId: {
        ...state.executionStateBySessionId,
        [sessionId]: "dispatching",
      },
    }));
    return intent;
  },

  markSent: (sessionId) => set((state) => ({
    executionStateBySessionId: {
      ...state.executionStateBySessionId,
      [sessionId]: "sent",
    },
  })),

  markRunning: (sessionId) => set((state) => ({
    executionStateBySessionId: {
      ...state.executionStateBySessionId,
      [sessionId]: "running",
    },
  })),

  markWaiting: (sessionId) => set((state) => ({
    executionStateBySessionId: {
      ...state.executionStateBySessionId,
      [sessionId]: "waiting",
    },
  })),

  markError: (sessionId) => set((state) => ({
    executionStateBySessionId: {
      ...state.executionStateBySessionId,
      [sessionId]: "error",
    },
  })),

  clearIntent: (sessionId) => set((state) => ({
    pendingIntentBySessionId: {
      ...state.pendingIntentBySessionId,
      [sessionId]: null,
    },
    activeIntentBySessionId: {
      ...state.activeIntentBySessionId,
      [sessionId]: null,
    },
    executionStateBySessionId: {
      ...state.executionStateBySessionId,
      [sessionId]: null,
    },
  })),

  setAutoContinueDecision: (sessionId, decision) => set((state) => ({
    lastAutoContinueDecisionBySessionId: {
      ...state.lastAutoContinueDecisionBySessionId,
      [sessionId]: decision,
    },
  })),
}));
