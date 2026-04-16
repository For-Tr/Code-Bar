import { useSessionStore } from "../store/sessionStore";
import { useWorkbenchStore } from "../store/workbenchStore";

export function showSessionSurface(sessionId: string | null) {
  useSessionStore.getState().setActiveSession(sessionId);
  if (sessionId) {
    useSessionStore.getState().setExpandedSession(sessionId);
  }
  useWorkbenchStore.getState().showSessionSurface(sessionId);
}

export function showExplorer(sessionId: string) {
  useSessionStore.getState().setActiveSession(sessionId);
  useSessionStore.getState().setExpandedSession(sessionId);
  useWorkbenchStore.getState().showExplorer(sessionId);
}

export function showScm(sessionId: string) {
  useSessionStore.getState().setActiveSession(sessionId);
  useSessionStore.getState().setExpandedSession(sessionId);
  useWorkbenchStore.getState().showScm(sessionId);
}

export function resetWorkbenchMode() {
  useWorkbenchStore.getState().resetWorkbenchMode();
}
