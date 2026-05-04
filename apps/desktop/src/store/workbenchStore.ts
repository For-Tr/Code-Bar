import { create } from "zustand";
import {
  DEFAULT_WORKBENCH_NAVIGATION_STATE,
  showSessionObject,
  showWorkflowObject,
  type SessionObjectTab,
  type WorkflowObjectTab,
  type WorkbenchCenterSurface,
  type WorkbenchNavigationState,
  type WorkbenchPrimaryObject,
} from "../workbench/workbenchNavigation.ts";

type WorkbenchSidebarSection = "sessions" | "workflow" | "explorer" | "scm";

type WorkbenchNavigationUpdate = WorkbenchNavigationState & {
  sidebarSection: WorkbenchSidebarSection;
};

interface WorkbenchStore extends WorkbenchNavigationState {
  sidebarSection: WorkbenchSidebarSection;
  setPrimaryObject: (value: WorkbenchPrimaryObject) => void;
  setCenterSurface: (surface: WorkbenchCenterSurface | "editor" | "diff") => void;
  setSessionTab: (tab: SessionObjectTab) => void;
  setWorkflowTab: (tab: WorkflowObjectTab) => void;
  focusSession: (sessionId: string | null) => void;
  focusWorkflowTask: (taskId: string | null) => void;
  showSessionSurface: (sessionId: string | null, tab?: SessionObjectTab) => void;
  showWorkflow: (sessionId?: string | null, taskId?: string | null, tab?: WorkflowObjectTab) => void;
  showExplorer: (sessionId: string) => void;
  showScm: (sessionId: string) => void;
  resetWorkbenchMode: () => void;
}

export type {
  SessionObjectTab,
  WorkflowObjectTab,
  WorkbenchPrimaryObject,
  WorkbenchCenterSurface,
};

const showPrimaryObject = (
  state: WorkbenchNavigationState,
  primaryObject: WorkbenchPrimaryObject,
): WorkbenchNavigationUpdate => {
  if (primaryObject === "workflows") {
    return {
      ...showWorkflowObject(state, {
        taskId: state.focusedWorkflowTaskId,
        tab: state.workflowTab,
      }),
      sidebarSection: "workflow" as const,
    };
  }

  return {
    ...showSessionObject(state, state.focusedSessionId, state.sessionTab),
    sidebarSection: state.sessionTab === "files" ? "explorer" : state.sessionTab === "changes" ? "scm" : "sessions",
  };
};

const showCenterSurface = (
  state: WorkbenchNavigationState,
  centerSurface: WorkbenchCenterSurface | "editor" | "diff",
): WorkbenchNavigationUpdate => {
  if (centerSurface === "editor") {
    return {
      ...showSessionObject(state, state.focusedSessionId, "files"),
      sidebarSection: "explorer" as const,
    };
  }

  if (centerSurface === "diff") {
    return {
      ...showSessionObject(state, state.focusedSessionId, "changes"),
      sidebarSection: "scm" as const,
    };
  }

  if (centerSurface === "workflow") {
    return {
      ...showWorkflowObject(state, {
        taskId: state.focusedWorkflowTaskId,
        tab: state.workflowTab,
      }),
      sidebarSection: "workflow" as const,
    };
  }

  if (centerSurface === "session") {
    return {
      ...showSessionObject(state, state.focusedSessionId, state.sessionTab),
      sidebarSection: state.sessionTab === "files" ? "explorer" : state.sessionTab === "changes" ? "scm" : "sessions",
    };
  }

  if (centerSurface === "welcome") {
    return state.primaryObject === "workflows"
      ? {
          ...showWorkflowObject(state, {
            taskId: state.focusedWorkflowTaskId,
            tab: state.workflowTab,
          }),
          focusedWorkflowTaskId: null,
          sidebarSection: "workflow" as const,
        }
      : {
          ...showSessionObject(state, null, state.sessionTab),
          sidebarSection: state.sessionTab === "files" ? "explorer" : state.sessionTab === "changes" ? "scm" : "sessions",
        };
  }

  return {
    ...showSessionObject(state, state.focusedSessionId, state.sessionTab),
    sidebarSection: state.sessionTab === "files" ? "explorer" : state.sessionTab === "changes" ? "scm" : "sessions",
  };
};

export const useWorkbenchStore = create<WorkbenchStore>()((set) => ({
  ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
  sidebarSection: "sessions",

  setPrimaryObject: (primaryObject) => set((state) => showPrimaryObject(state, primaryObject)),
  setCenterSurface: (centerSurface) => set((state) => showCenterSurface(state, centerSurface)),
  setSessionTab: (sessionTab) => set((state) => ({
    ...showSessionObject(
      {
        ...state,
        centerSurface: "session",
      },
      state.focusedSessionId,
      sessionTab,
    ),
    sidebarSection: sessionTab === "files" ? "explorer" : sessionTab === "changes" ? "scm" : "sessions",
  })),
  setWorkflowTab: (workflowTab) => set((state) => ({
    ...showWorkflowObject(state, {
      sessionId: state.focusedSessionId,
      taskId: state.focusedWorkflowTaskId,
      tab: workflowTab,
    }),
    sidebarSection: "workflow",
  })),
  focusSession: (focusedSessionId) => set({ focusedSessionId }),
  focusWorkflowTask: (focusedWorkflowTaskId) => set({ focusedWorkflowTaskId }),
  showSessionSurface: (sessionId, tab = "run") =>
    set((state) => ({
      ...showSessionObject(state, sessionId, tab),
      sidebarSection: tab === "files" ? "explorer" : tab === "changes" ? "scm" : "sessions",
    })),
  showWorkflow: (sessionId, taskId = null, tab = "overview") =>
    set((state) => ({
      ...showWorkflowObject(
        state,
        sessionId === undefined
          ? { taskId, tab }
          : { sessionId, taskId, tab },
      ),
      sidebarSection: "workflow",
    })),
  showExplorer: (sessionId) =>
    set((state) => ({
      ...showSessionObject(state, sessionId, "files"),
      sidebarSection: "explorer",
    })),
  showScm: (sessionId) =>
    set((state) => ({
      ...showSessionObject(state, sessionId, "changes"),
      sidebarSection: "scm",
    })),
  resetWorkbenchMode: () => set({
    ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
    sidebarSection: "sessions",
  }),
}));
