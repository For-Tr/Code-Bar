import { useSessionStore } from "../store/sessionStore";
import {
  useWorkbenchStore,
  type SessionObjectTab,
  type WorkflowObjectTab,
} from "../store/workbenchStore";

export function showSessionSurface(sessionId: string | null, tab: SessionObjectTab = "run") {
  useSessionStore.getState().setExpandedSession(sessionId);
  if (sessionId) {
    useSessionStore.getState().setActiveSession(sessionId);
  }
  useWorkbenchStore.getState().showSessionSurface(sessionId, tab);
}

export function showWorkflow(
  sessionId?: string | null,
  taskId?: string | null,
  tab: WorkflowObjectTab = "overview",
) {
  if (sessionId !== undefined) {
    useSessionStore.getState().setActiveSession(sessionId);
    useSessionStore.getState().setExpandedSession(sessionId);
  }

  useWorkbenchStore.getState().showWorkflow(sessionId, taskId ?? null, tab);
}

export function showExplorer(sessionId: string) {
  showSessionSurface(sessionId, "files");
}

export function showScm(sessionId: string) {
  showSessionSurface(sessionId, "changes");
}

export function resetWorkbenchMode() {
  useWorkbenchStore.getState().resetWorkbenchMode();
}
