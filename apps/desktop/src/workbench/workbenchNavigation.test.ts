// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import {
  DEFAULT_WORKBENCH_NAVIGATION_STATE,
  showSessionObject,
  showWorkflowObject,
} from "./workbenchNavigation.ts";
import { useWorkbenchStore } from "../store/workbenchStore.ts";

test("showSessionObject opens the chosen session tab while preserving workflow focus", () => {
  const next = showSessionObject(
    {
      ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
      focusedWorkflowTaskId: "task-9",
    },
    "session-1",
    "files",
  );

  assert.deepEqual(next, {
    primaryObject: "sessions",
    centerSurface: "session",
    focusedSessionId: "session-1",
    focusedWorkflowTaskId: "task-9",
    sessionTab: "files",
    workflowTab: "overview",
  });
});

test("showWorkflowObject keeps workflow and session as separate top-level objects", () => {
  const next = showWorkflowObject(
    DEFAULT_WORKBENCH_NAVIGATION_STATE,
    {
      taskId: "task-1",
      sessionId: null,
      tab: "execution",
    },
  );

  assert.deepEqual(next, {
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: null,
    focusedWorkflowTaskId: "task-1",
    sessionTab: "run",
    workflowTab: "execution",
  });
});

test("showWorkflowObject can preserve the calling session without making workflow a child of that session", () => {
  const next = showWorkflowObject(
    DEFAULT_WORKBENCH_NAVIGATION_STATE,
    {
      taskId: "task-2",
      sessionId: "session-5",
      tab: "overview",
    },
  );

  assert.equal(next.primaryObject, "workflows");
  assert.equal(next.centerSurface, "workflow");
  assert.equal(next.focusedSessionId, "session-5");
  assert.equal(next.focusedWorkflowTaskId, "task-2");
  assert.equal(next.workflowTab, "overview");
});

test("showWorkflowObject opens the workflow surface even without a selected task", () => {
  const next = showWorkflowObject(
    {
      ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
      focusedSessionId: "session-2",
      focusedWorkflowTaskId: "task-4",
      workflowTab: "activity",
    },
    {
      taskId: null,
      tab: "graph",
    },
  );

  assert.deepEqual(next, {
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: "session-2",
    focusedWorkflowTaskId: null,
    sessionTab: "run",
    workflowTab: "graph",
  });
});

test("showWorkflowObject clears focusedSessionId when sessionId is explicitly null", () => {
  const next = showWorkflowObject(
    {
      ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
      focusedSessionId: "session-7",
      focusedWorkflowTaskId: "task-4",
    },
    {
      taskId: "task-8",
      sessionId: null,
      tab: "activity",
    },
  );

  assert.deepEqual(next, {
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: null,
    focusedWorkflowTaskId: "task-8",
    sessionTab: "run",
    workflowTab: "activity",
  });
});

test("showWorkflowObject normalizes linked_workflow session tab back to run", () => {
  const next = showWorkflowObject(
    {
      ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
      focusedSessionId: "session-3",
      focusedWorkflowTaskId: "task-2",
      sessionTab: "linked_workflow",
    },
    {
      taskId: "task-2",
      tab: "overview",
    },
  );

  assert.deepEqual(next, {
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: "session-3",
    focusedWorkflowTaskId: "task-2",
    sessionTab: "run",
    workflowTab: "overview",
  });
});

test("showSessionObject defaults to the run tab when no tab is provided", () => {
  const next = showSessionObject(DEFAULT_WORKBENCH_NAVIGATION_STATE, "session-3");

  assert.equal(next.primaryObject, "sessions");
  assert.equal(next.centerSurface, "session");
  assert.equal(next.focusedSessionId, "session-3");
  assert.equal(next.sessionTab, "run");
});

test("setSessionTab escapes legacy editor and diff surfaces back to session", () => {
  useWorkbenchStore.setState({
    ...DEFAULT_WORKBENCH_NAVIGATION_STATE,
    primaryObject: "sessions",
    centerSurface: "editor",
    focusedSessionId: "session-10",
    sessionTab: "files",
  });

  useWorkbenchStore.getState().setSessionTab("run");

  let next = useWorkbenchStore.getState();
  assert.equal(next.centerSurface, "session");
  assert.equal(next.sessionTab, "run");
  assert.equal(next.sidebarSection, "sessions");

  useWorkbenchStore.setState({
    ...next,
    centerSurface: "diff",
    sessionTab: "changes",
  });

  useWorkbenchStore.getState().setSessionTab("linked_workflow");

  next = useWorkbenchStore.getState();
  assert.equal(next.centerSurface, "session");
  assert.equal(next.sessionTab, "linked_workflow");
  assert.equal(next.sidebarSection, "sessions");
});

