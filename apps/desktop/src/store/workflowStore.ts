import { create } from "zustand";
import { useSessionStore } from "./sessionStore";
import { useWorkbenchStore } from "./workbenchStore";
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
  taskIdBySessionId: Record<string, string>;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  selectedNodeId: string | null;
  loadingTaskIds: Record<string, boolean>;
  errorByTaskId: Record<string, string | null>;
  activeLeaseByStepId: Record<string, ClaimWorkflowStepResponse>;
  pendingActionByStepId: Record<string, string | null>;
  pendingApprovalIds: Record<string, boolean>;

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
    workspaceId?: string | null;
    workspaceName?: string | null;
    workspacePath?: string | null;
    sessionName?: string | null;
    currentTask?: string | null;
    branchName?: string | null;
    baseBranch?: string | null;
    sessionStatus?: string | null;
  }) => Promise<void>;
  syncSession: (input: {
    provider: "claude_code" | "codex";
    sessionId: string;
    providerSessionId?: string | null;
    cwd?: string | null;
    worktreePath?: string | null;
    workspaceId?: string | null;
    workspaceName?: string | null;
    workspacePath?: string | null;
    sessionName?: string | null;
    currentTask?: string | null;
    branchName?: string | null;
    baseBranch?: string | null;
    sessionStatus?: string | null;
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
  taskIdBySessionId: {},
  selectedTaskId: null,
  selectedSessionId: null,
  selectedNodeId: null,
  loadingTaskIds: {},
  errorByTaskId: {},
  activeLeaseByStepId: {},
  pendingActionByStepId: {},
  pendingApprovalIds: {},

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
    taskIdBySessionId: sessionId ? {
      ...state.taskIdBySessionId,
      [sessionId]: response.document.task.id,
    } : state.taskIdBySessionId,
    selectedTaskId: response.document.task.id,
    selectedSessionId: sessionId ?? state.selectedSessionId,
    selectedNodeId: sessionId && sessionId !== state.selectedSessionId ? null : state.selectedNodeId,
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
    taskIdBySessionId: sessionId ? {
      ...state.taskIdBySessionId,
      [sessionId]: taskId,
    } : state.taskIdBySessionId,
    selectedTaskId: taskId,
    selectedSessionId: sessionId ?? state.selectedSessionId,
    selectedNodeId: sessionId && sessionId !== state.selectedSessionId ? null : state.selectedNodeId,
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
      workspaceId: input.workspaceId ?? undefined,
      workspaceName: input.workspaceName ?? undefined,
      workspacePath: input.workspacePath ?? undefined,
      sessionName: input.sessionName ?? undefined,
      currentTask: input.currentTask ?? undefined,
      branchName: input.branchName ?? undefined,
      baseBranch: input.baseBranch ?? undefined,
      sessionStatus: input.sessionStatus ?? undefined,
    }) as { taskId: string; sessionId?: string | null; document: TaskDagDocument };
    get().applySnapshotDocument(response.taskId, response.document, response.sessionId ?? undefined);
    await get().refreshWorkflow(response.taskId, response.sessionId ?? undefined);
  },

  syncSession: async (input) => {
    await get().attachSessionAndLoad(input);
  },

  claimStep: async (sessionId, stepId) => {
    const optimisticStepId = stepId ?? "__next__";
    set((state) => ({
      pendingActionByStepId: {
        ...state.pendingActionByStepId,
        [optimisticStepId]: "claim",
      },
    }));
    const currentDocument = (() => {
      const taskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
      return taskId ? get().snapshotsByTaskId[taskId] : undefined;
    })();
    const currentNode = stepId && currentDocument
      ? currentDocument.nodes.find((node) => node.kind === "step" && node.stepId === stepId)
      : undefined;
    useSessionStore.getState().updateSession(sessionId, {
      status: "running",
      currentTask: currentNode && currentNode.kind === "step" ? currentNode.label : undefined,
    });
    useWorkbenchStore.getState().focusSession(sessionId);
    try {
      const result = await claimWorkflowStep({ sessionId, stepId });
      set((state) => ({
        activeLeaseByStepId: {
          ...state.activeLeaseByStepId,
          [result.stepId]: result,
        },
      }));
      const taskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
      if (taskId) {
        await get().refreshWorkflow(taskId, sessionId);
      }
    } finally {
      set((state) => ({
        pendingActionByStepId: {
          ...state.pendingActionByStepId,
          [optimisticStepId]: null,
        },
      }));
    }
  },

  completeStep: async (sessionId, stepId) => {
    set((state) => ({
      pendingActionByStepId: {
        ...state.pendingActionByStepId,
        [stepId]: "complete",
      },
    }));
    const lease = get().activeLeaseByStepId[stepId];
    useSessionStore.getState().updateSession(sessionId, {
      status: "waiting",
      currentTask: "Completed workflow step",
    });
    try {
      await completeWorkflowStep({
        sessionId,
        stepId,
        leaseToken: lease?.leaseToken,
      });
      const taskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
      if (taskId) {
        await get().refreshWorkflow(taskId, sessionId);
      }
    } finally {
      set((state) => ({
        pendingActionByStepId: {
          ...state.pendingActionByStepId,
          [stepId]: null,
        },
      }));
    }
  },

  blockStep: async (sessionId, stepId, reason) => {
    set((state) => ({
      pendingActionByStepId: {
        ...state.pendingActionByStepId,
        [stepId]: "block",
      },
    }));
    useSessionStore.getState().updateSession(sessionId, {
      status: "suspended",
      currentTask: reason,
    });
    try {
      await blockWorkflowStep({ sessionId, stepId, reason });
      const taskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
      if (taskId) {
        await get().refreshWorkflow(taskId, sessionId);
      }
    } finally {
      set((state) => ({
        pendingActionByStepId: {
          ...state.pendingActionByStepId,
          [stepId]: null,
        },
      }));
    }
  },

  resolveApproval: async (approvalId, sessionId) => {
    set((state) => ({
      pendingApprovalIds: {
        ...state.pendingApprovalIds,
        [approvalId]: true,
      },
    }));
    if (sessionId) {
      useSessionStore.getState().updateSession(sessionId, {
        status: "running",
      });
      useWorkbenchStore.getState().focusSession(sessionId);
    }
    try {
      await resolveWorkflowApproval({ approvalId, decision: "approve", sessionId });
      const taskId = sessionId ? get().taskIdBySessionId[sessionId] ?? get().selectedTaskId : get().selectedTaskId;
      if (taskId) {
        await get().refreshWorkflow(taskId, sessionId);
      }
    } finally {
      set((state) => ({
        pendingApprovalIds: {
          ...state.pendingApprovalIds,
          [approvalId]: false,
        },
      }));
    }
  },

  refreshNextActionProgress: async (sessionId, stepId) => {
    const nextAction = await getWorkflowNextAction(sessionId);
    await updateWorkflowProgress({
      sessionId,
      stepId,
      summary: nextAction.nextAction.label ?? "Updated from workflow surface",
    });
    const taskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
    if (taskId) {
      await get().refreshWorkflow(taskId, sessionId);
    }
  },
}));

export function selectWorkflowNodeById(document: TaskDagDocument | undefined, nodeId: string | null): TaskDagNode | null {
  if (!document || !nodeId) return null;
  return document.nodes.find((node: TaskDagNode) => node.id === nodeId) ?? null;
}
