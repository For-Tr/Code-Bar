import { create } from "zustand";
import type {
  ClaimWorkflowStepResponse,
  GetWorkflowSnapshotResponse,
  TaskDagDiagnostic,
  TaskDagDocument,
  TaskDagEvent,
  TaskDagNode,
} from "@codebar/contracts";
import {
  attachWorkflowSession,
  blockWorkflowStep,
  claimWorkflowStep,
  completeWorkflowStep,
  getWorkflowNextAction,
  getWorkflowSnapshot,
  resolveWorkflowApproval,
  updateWorkflowProgress,
} from "../services/orchestrationCommands";

interface WorkflowStore {
  snapshotsByTaskId: Record<string, TaskDagDocument>;
  eventsByTaskId: Record<string, TaskDagEvent[]>;
  diagnosticsByTaskId: Record<string, TaskDagDiagnostic[]>;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  selectedNodeId: string | null;
  loadingTaskIds: Record<string, boolean>;
  errorByTaskId: Record<string, string | null>;
  activeLeaseByStepId: Record<string, ClaimWorkflowStepResponse>;

  setSelectedTask: (taskId: string | null, sessionId?: string | null) => void;
  setSelectedNode: (nodeId: string | null) => void;
  applySnapshotResponse: (response: GetWorkflowSnapshotResponse, sessionId?: string | null) => void;
  applySnapshotDocument: (taskId: string, document: TaskDagDocument, sessionId?: string | null) => void;
  applyEvents: (taskId: string, events: TaskDagEvent[]) => void;
  applyDiagnostics: (taskId: string, diagnostics: TaskDagDiagnostic[]) => void;
  refreshWorkflow: (taskId: string, sessionId?: string | null) => Promise<void>;
  attachSessionAndLoad: (input: {
    provider: "claude_code" | "codex";
    sessionId?: string | null;
    providerSessionId?: string | null;
    cwd?: string | null;
    worktreePath?: string | null;
  }) => Promise<void>;
  claimStep: (sessionId: string, stepId?: string) => Promise<void>;
  completeStep: (sessionId: string, stepId: string) => Promise<void>;
  blockStep: (sessionId: string, stepId: string, reason: string) => Promise<void>;
  resolveApproval: (approvalId: string, sessionId?: string) => Promise<void>;
  refreshNextActionProgress: (sessionId: string, stepId: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowStore>()((set, get) => ({
  snapshotsByTaskId: {},
  eventsByTaskId: {},
  diagnosticsByTaskId: {},
  selectedTaskId: null,
  selectedSessionId: null,
  selectedNodeId: null,
  loadingTaskIds: {},
  errorByTaskId: {},
  activeLeaseByStepId: {},

  setSelectedTask: (taskId, sessionId) => set({
    selectedTaskId: taskId,
    selectedSessionId: sessionId ?? null,
    selectedNodeId: null,
  }),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  applySnapshotResponse: (response, sessionId) => set((state) => ({
    snapshotsByTaskId: {
      ...state.snapshotsByTaskId,
      [response.document.task.id]: response.document,
    },
    eventsByTaskId: {
      ...state.eventsByTaskId,
      [response.document.task.id]: response.events,
    },
    diagnosticsByTaskId: {
      ...state.diagnosticsByTaskId,
      [response.document.task.id]: response.diagnostics,
    },
    selectedTaskId: response.document.task.id,
    selectedSessionId: sessionId ?? state.selectedSessionId,
    loadingTaskIds: {
      ...state.loadingTaskIds,
      [response.document.task.id]: false,
    },
    errorByTaskId: {
      ...state.errorByTaskId,
      [response.document.task.id]: null,
    },
  })),

  applySnapshotDocument: (taskId, document, sessionId) => set((state) => ({
    snapshotsByTaskId: {
      ...state.snapshotsByTaskId,
      [taskId]: document,
    },
    selectedTaskId: taskId,
    selectedSessionId: sessionId ?? state.selectedSessionId,
  })),

  applyEvents: (taskId, events) => set((state) => ({
    eventsByTaskId: {
      ...state.eventsByTaskId,
      [taskId]: events,
    },
  })),

  applyDiagnostics: (taskId, diagnostics) => set((state) => ({
    diagnosticsByTaskId: {
      ...state.diagnosticsByTaskId,
      [taskId]: diagnostics,
    },
  })),

  refreshWorkflow: async (taskId, sessionId) => {
    set((state) => ({
      selectedTaskId: taskId,
      selectedSessionId: sessionId ?? state.selectedSessionId,
      loadingTaskIds: { ...state.loadingTaskIds, [taskId]: true },
      errorByTaskId: { ...state.errorByTaskId, [taskId]: null },
    }));
    try {
      const response = await getWorkflowSnapshot({
        taskId,
        sessionId: sessionId ?? undefined,
        includeEvents: true,
        includeDiagnostics: true,
      });
      get().applySnapshotResponse(response, sessionId);
    } catch (error) {
      set((state) => ({
        loadingTaskIds: { ...state.loadingTaskIds, [taskId]: false },
        errorByTaskId: {
          ...state.errorByTaskId,
          [taskId]: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },

  attachSessionAndLoad: async (input) => {
    const response = await attachWorkflowSession({
      provider: input.provider,
      sessionId: input.sessionId ?? undefined,
      providerSessionId: input.providerSessionId ?? undefined,
      cwd: input.cwd ?? undefined,
      worktreePath: input.worktreePath ?? undefined,
    }) as { taskId: string; sessionId?: string | null; document: TaskDagDocument };
    get().applySnapshotDocument(response.taskId, response.document, response.sessionId ?? undefined);
    await get().refreshWorkflow(response.taskId, response.sessionId ?? undefined);
  },

  claimStep: async (sessionId, stepId) => {
    const result = await claimWorkflowStep({ sessionId, stepId });
    set((state) => ({
      activeLeaseByStepId: {
        ...state.activeLeaseByStepId,
        [result.stepId]: result,
      },
    }));
    const taskId = get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },

  completeStep: async (sessionId, stepId) => {
    const lease = get().activeLeaseByStepId[stepId];
    await completeWorkflowStep({
      sessionId,
      stepId,
      leaseToken: lease?.leaseToken,
    });
    const taskId = get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },

  blockStep: async (sessionId, stepId, reason) => {
    await blockWorkflowStep({ sessionId, stepId, reason });
    const taskId = get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },

  resolveApproval: async (approvalId, sessionId) => {
    await resolveWorkflowApproval({ approvalId, decision: "approve", sessionId });
    const taskId = get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },

  refreshNextActionProgress: async (sessionId, stepId) => {
    const nextAction = await getWorkflowNextAction(sessionId);
    await updateWorkflowProgress({
      sessionId,
      stepId,
      summary: nextAction.nextAction.label ?? "Updated from workflow surface",
    });
    const taskId = get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },
}));

export function selectWorkflowNodeById(document: TaskDagDocument | undefined, nodeId: string | null): TaskDagNode | null {
  if (!document || !nodeId) return null;
  return document.nodes.find((node: TaskDagNode) => node.id === nodeId) ?? null;
}
