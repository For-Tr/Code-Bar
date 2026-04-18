import { create } from "zustand";

export type WorkbenchSidebarSection = "sessions" | "explorer" | "scm";
export type WorkbenchCenterSurface = "session" | "editor" | "diff" | "welcome";

interface WorkbenchStore {
  sidebarSection: WorkbenchSidebarSection;
  centerSurface: WorkbenchCenterSurface;
  focusedSessionId: string | null;

  setSidebarSection: (section: WorkbenchSidebarSection) => void;
  setCenterSurface: (surface: WorkbenchCenterSurface) => void;
  focusSession: (sessionId: string | null) => void;
  showSessionSurface: (sessionId: string | null) => void;
  showExplorer: (sessionId: string) => void;
  showScm: (sessionId: string) => void;
  resetWorkbenchMode: () => void;
}

export const useWorkbenchStore = create<WorkbenchStore>()((set) => ({
  sidebarSection: "sessions",
  centerSurface: "session",
  focusedSessionId: null,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setCenterSurface: (surface) => set({ centerSurface: surface }),
  focusSession: (sessionId) => set({ focusedSessionId: sessionId }),
  showSessionSurface: (sessionId) => set({
    sidebarSection: "sessions",
    centerSurface: "session",
    focusedSessionId: sessionId,
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
    centerSurface: "session",
    focusedSessionId: null,
  }),
}));
