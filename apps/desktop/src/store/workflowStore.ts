import { create } from "zustand";
import { useWorkbenchStore } from "./workbenchStore";
import type {
  ClaimWorkflowStepResponse,
  GetWorkflowSnapshotResponse,
  TaskDagDiagnostic,
  TaskDagDocument,
  TaskDagEvent,
  TaskDagNode,
  WorkflowLifecycle,
  WorkflowTaskSummary,
} from "@codebar/contracts";
import {
  attachWorkflowSession,
  blockWorkflowStep,
  claimWorkflowStep,
  completeWorkflowStep,
  confirmWorkflow,
  createWorkflowDraft,
  getWorkflowNextAction,
  getWorkflowSnapshot,
  listWorkflowTasks,
  resolveWorkflowApproval,
  startWorkflow,
  submitWorkflowReview,
  updateWorkflowProgress,
} from "../services/orchestrationCommands";
import {
  createSession as createTaskSession,
  prepareWorktree,
  type DaemonSessionSummary,
} from "../services/daemonCommands";

interface WorkflowStore {
  snapshotsByTaskId: Record<string, TaskDagDocument>;
  eventsByTaskId: Record<string, TaskDagEvent[]>;
  diagnosticsByTaskId: Record<string, TaskDagDiagnostic[]>;
  taskSummariesByTaskId: Record<string, WorkflowTaskSummary>;
  workflowTaskIdsByWorkspaceId: Record<string, string[]>;
  taskIdBySessionId: Record<string, string>;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  selectedNodeId: string | null;
  loadingTaskIds: Record<string, boolean>;
  loadingWorkspaceIds: Record<string, boolean>;
  errorByTaskId: Record<string, string | null>;
  errorByWorkspaceId: Record<string, string | null>;
  activeLeaseByStepId: Record<string, ClaimWorkflowStepResponse>;
  pendingActionByStepId: Record<string, string | null>;
  pendingApprovalIds: Record<string, boolean>;

  setSelectedTask: (taskId: string | null, sessionId?: string | null) => void;
  setSelectedNode: (nodeId: string | null) => void;
  applySnapshotResponse: (response: GetWorkflowSnapshotResponse, sessionId?: string | null) => void;
  applySnapshotDocument: (taskId: string, document: TaskDagDocument, sessionId?: string | null) => void;
  applyEvents: (taskId: string, events: TaskDagEvent[]) => void;
  applyDiagnostics: (taskId: string, diagnostics: TaskDagDiagnostic[]) => void;
  listWorkspaceTasks: (workspaceId: string) => Promise<void>;
  createDraftTask: (input: {
    workspaceId: string;
    title: string;
    prompt: string;
    goal?: string;
    provider?: "claude_code" | "codex";
  }) => Promise<string>;
  submitForReview: (taskId: string) => Promise<void>;
  confirmTask: (taskId: string) => Promise<void>;
  startTask: (taskId: string, sessionId: string) => Promise<void>;
  ensureSessionForTask: (taskId: string, provider: "claude" | "codex") => Promise<DaemonSessionSummary>;
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
  getTaskLifecycle: (taskId: string) => WorkflowLifecycle;
}

function resolveTaskLifecycle(document: TaskDagDocument | undefined): WorkflowLifecycle {
  const lifecycle = document?.task.lifecycle;
  if (lifecycle === "draft" || lifecycle === "in_review" || lifecycle === "confirmed" || lifecycle === "running") {
    return lifecycle;
  }
  const status = document?.task.status;
  if (status === "draft") return "draft";
  if (status === "ready") return "confirmed";
  if (status === "active") return "running";
  return "in_review";
}

function canRunActions(lifecycle: WorkflowLifecycle) {
  return lifecycle === "running";
}

export const useWorkflowStore = create<WorkflowStore>()((set, get) => ({
  snapshotsByTaskId: {},
  eventsByTaskId: {},
  diagnosticsByTaskId: {},
  taskSummariesByTaskId: {},
  workflowTaskIdsByWorkspaceId: {},
  taskIdBySessionId: {},
  selectedTaskId: null,
  selectedSessionId: null,
  selectedNodeId: null,
  loadingTaskIds: {},
  loadingWorkspaceIds: {},
  errorByTaskId: {},
  errorByWorkspaceId: {},
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
    taskSummariesByTaskId: {
      ...state.taskSummariesByTaskId,
      [response.document.task.id]: {
        taskId: response.document.task.id,
        workspaceId: response.document.task.workspaceId,
        title: response.document.task.title,
        status: response.document.task.status,
        lifecycle: resolveTaskLifecycle(response.document),
        activeSessionId: response.document.task.activeSessionId,
      },
    },
    workflowTaskIdsByWorkspaceId: {
      ...state.workflowTaskIdsByWorkspaceId,
      [response.document.task.workspaceId]: Array.from(new Set([
        ...(state.workflowTaskIdsByWorkspaceId[response.document.task.workspaceId] ?? []),
        response.document.task.id,
      ])),
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
    taskSummariesByTaskId: {
      ...state.taskSummariesByTaskId,
      [taskId]: {
        taskId,
        workspaceId: document.task.workspaceId,
        title: document.task.title,
        status: document.task.status,
        lifecycle: resolveTaskLifecycle(document),
        activeSessionId: document.task.activeSessionId,
      },
    },
    workflowTaskIdsByWorkspaceId: {
      ...state.workflowTaskIdsByWorkspaceId,
      [document.task.workspaceId]: Array.from(new Set([
        ...(state.workflowTaskIdsByWorkspaceId[document.task.workspaceId] ?? []),
        taskId,
      ])),
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

  listWorkspaceTasks: async (workspaceId) => {
    set((state) => ({
      loadingWorkspaceIds: {
        ...state.loadingWorkspaceIds,
        [workspaceId]: true,
      },
      errorByWorkspaceId: {
        ...state.errorByWorkspaceId,
        [workspaceId]: null,
      },
    }));
    try {
      const response = await listWorkflowTasks({ workspaceId });
      set((state) => {
        const summaryMap = { ...state.taskSummariesByTaskId };
        for (const task of response.tasks) {
          summaryMap[task.taskId] = task;
        }
        return {
          taskSummariesByTaskId: summaryMap,
          workflowTaskIdsByWorkspaceId: {
            ...state.workflowTaskIdsByWorkspaceId,
            [workspaceId]: response.tasks.map((task) => task.taskId),
          },
          loadingWorkspaceIds: {
            ...state.loadingWorkspaceIds,
            [workspaceId]: false,
          },
          errorByWorkspaceId: {
            ...state.errorByWorkspaceId,
            [workspaceId]: null,
          },
        };
      });
    } catch (error) {
      set((state) => ({
        loadingWorkspaceIds: {
          ...state.loadingWorkspaceIds,
          [workspaceId]: false,
        },
        errorByWorkspaceId: {
          ...state.errorByWorkspaceId,
          [workspaceId]: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },

  createDraftTask: async (input) => {
    const response = await createWorkflowDraft(input);
    get().applySnapshotDocument(response.taskId, response.document);
    return response.taskId;
  },

  submitForReview: async (taskId) => {
    await submitWorkflowReview({ taskId });
    const sessionId = get().selectedSessionId;
    await get().refreshWorkflow(taskId, sessionId);
  },

  confirmTask: async (taskId) => {
    await confirmWorkflow({ taskId });
    const sessionId = get().selectedSessionId;
    await get().refreshWorkflow(taskId, sessionId);
  },

  startTask: async (taskId, sessionId) => {
    await startWorkflow({ taskId, sessionId });
    await get().refreshWorkflow(taskId, sessionId);
  },

  ensureSessionForTask: async (taskId, provider) => {
    const created = await createTaskSession({
      taskId,
      provider,
      worktreeStrategy: "new_managed",
    });
    await prepareWorktree({ sessionId: created.session.id, strategy: "new_managed" });
    return created.session;
  },

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
    });
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
    const currentTaskId = get().taskIdBySessionId[sessionId] ?? get().selectedTaskId;
    const currentDocument = currentTaskId ? get().snapshotsByTaskId[currentTaskId] : undefined;
    if (!canRunActions(resolveTaskLifecycle(currentDocument))) {
      set((state) => ({
        pendingActionByStepId: {
          ...state.pendingActionByStepId,
          [optimisticStepId]: null,
        },
      }));
      return;
    }
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

  getTaskLifecycle: (taskId) => {
    const snapshot = get().snapshotsByTaskId[taskId];
    return resolveTaskLifecycle(snapshot);
  },
}));

export function selectWorkflowNodeById(document: TaskDagDocument | undefined, nodeId: string | null): TaskDagNode | null {
  if (!document || !nodeId) return null;
  return document.nodes.find((node: TaskDagNode) => node.id === nodeId) ?? null;
}
