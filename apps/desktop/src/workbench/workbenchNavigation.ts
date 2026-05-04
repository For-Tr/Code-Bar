export type WorkbenchPrimaryObject = "sessions" | "workflows";
export type WorkbenchCenterSurface = "session" | "workflow" | "welcome" | "editor" | "diff";
export type SessionObjectTab = "run" | "changes" | "files" | "linked_workflow";
export type WorkflowObjectTab = "overview" | "graph" | "activity" | "execution";

export interface WorkbenchNavigationState {
  primaryObject: WorkbenchPrimaryObject;
  centerSurface: WorkbenchCenterSurface;
  focusedSessionId: string | null;
  focusedWorkflowTaskId: string | null;
  sessionTab: SessionObjectTab;
  workflowTab: WorkflowObjectTab;
}

export const DEFAULT_WORKBENCH_NAVIGATION_STATE: WorkbenchNavigationState = {
  primaryObject: "sessions",
  centerSurface: "welcome",
  focusedSessionId: null,
  focusedWorkflowTaskId: null,
  sessionTab: "run",
  workflowTab: "overview",
};

export function showSessionObject(
  state: WorkbenchNavigationState,
  sessionId: string | null,
  tab: SessionObjectTab = "run",
): WorkbenchNavigationState {
  return {
    ...state,
    primaryObject: "sessions",
    centerSurface: sessionId ? "session" : "welcome",
    focusedSessionId: sessionId,
    focusedWorkflowTaskId: state.focusedWorkflowTaskId,
    sessionTab: tab,
  };
}

export function showWorkflowObject(
  state: WorkbenchNavigationState,
  input: {
    taskId?: string | null;
    sessionId?: string | null;
    tab?: WorkflowObjectTab;
  },
): WorkbenchNavigationState {
  const nextTaskId = input.taskId ?? null;
  const nextSessionId = Object.prototype.hasOwnProperty.call(input, "sessionId")
    ? input.sessionId ?? null
    : state.focusedSessionId;
  const nextSessionTab = state.sessionTab === "linked_workflow" ? "run" : state.sessionTab;

  return {
    ...state,
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: nextSessionId,
    focusedWorkflowTaskId: nextTaskId,
    sessionTab: nextSessionTab,
    workflowTab: input.tab ?? "overview",
  };
}
