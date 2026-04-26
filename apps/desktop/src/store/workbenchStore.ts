import { create } from "zustand";

export type WorkbenchSidebarSection = "sessions" | "workflow" | "explorer" | "scm";
export type WorkbenchCenterSurface = "session" | "workflow" | "editor" | "diff" | "welcome";

interface WorkbenchStore {
  sidebarSection: WorkbenchSidebarSection;
  centerSurface: WorkbenchCenterSurface;
  focusedSessionId: string | null;
  focusedWorkflowTaskId: string | null;

  setSidebarSection: (section: WorkbenchSidebarSection) => void;
  setCenterSurface: (surface: WorkbenchCenterSurface) => void;
  focusSession: (sessionId: string | null) => void;
  focusWorkflowTask: (taskId: string | null) => void;
  showSessionSurface: (sessionId: string | null) => void;
  showWorkflow: (sessionId: string | null, taskId?: string | null) => void;
  showExplorer: (sessionId: string) => void;
  showScm: (sessionId: string) => void;
  resetWorkbenchMode: () => void;
}

export const useWorkbenchStore = create<WorkbenchStore>()((set) => ({
  sidebarSection: "sessions",
  centerSurface: "welcome",
  focusedSessionId: null,
  focusedWorkflowTaskId: null,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setCenterSurface: (surface) => set({ centerSurface: surface }),
  focusSession: (sessionId) => set({ focusedSessionId: sessionId }),
  focusWorkflowTask: (taskId) => set({ focusedWorkflowTaskId: taskId }),
  showSessionSurface: (sessionId) => set({
    sidebarSection: "sessions",
    centerSurface: "session",
    focusedSessionId: sessionId,
  }),
  showWorkflow: (sessionId, taskId = null) => set({
    sidebarSection: "workflow",
    centerSurface: "workflow",
    focusedSessionId: sessionId,
    focusedWorkflowTaskId: taskId,
  }),
  showExplorer: (sessionId) => set({
    sidebarSection: "explorer",
    centerSurface: "editor",
    focusedSessionId: sessionId,
  }),
  showScm: (sessionId) => set({
    sidebarSection: "scm",
    centerSurface: "diff",
    focusedSessionId: sessionId,
  }),
  resetWorkbenchMode: () => set({
    sidebarSection: "sessions",
    centerSurface: "welcome",
    focusedSessionId: null,
    focusedWorkflowTaskId: null,
  }),
}));
