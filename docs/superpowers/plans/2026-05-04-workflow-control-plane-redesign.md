# Workflow Control-Plane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the desktop workbench from session-adjacent Workflow / Explorer / SCM surfaces into an object-first Sessions + Workflows control plane with explicit object tabs and visible git freshness signals.

**Architecture:** Replace the current `sidebarSection` / `centerSurface` navigation with an object-first state that treats Sessions and Workflows as primary objects, while reusing the existing SessionDetail, Explorer, SCM, workflow graph, event, and diagnostic components behind new object-level tab containers. Keep execution local, add a lightweight Tauri git branch-health command for mainline freshness, and avoid daemon-side workflow redesign in this phase.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri 2, Rust, Node 22 built-in test runner, existing desktop git commands

---

## File map

- `apps/desktop/src/workbench/workbenchNavigation.ts` — pure object-first navigation state reducer for Sessions/Workflows plus session/workflow tabs.
- `apps/desktop/src/workbench/workbenchNavigation.test.ts` — Node regression tests for navigation transitions.
- `apps/desktop/src/store/workbenchStore.ts` — authoritative UI state for primary object selection, active session/workflow, and active tabs.
- `apps/desktop/src/services/workbenchCommands.ts` — public workbench actions; maps old explorer/scm intents into session tabs.
- `apps/desktop/src/components/session/resolveSessionWorkflowLink.ts` — pure helper that derives the linked workflow step for a session from a workflow snapshot.
- `apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts` — Node regression tests for session-to-workflow linkage.
- `apps/desktop/src/components/session/SessionObjectPanel.tsx` — top-level session object view with `Run / Changes / Files / Linked Workflow` tabs.
- `apps/desktop/src/components/session/SessionFilesView.tsx` — local files view for a session; composes explorer tree + editor split.
- `apps/desktop/src/components/session/SessionLinkedWorkflowView.tsx` — lightweight workflow bridge for the current session.
- `apps/desktop/src/components/ExploreMode.tsx` — wrapper props for embedded explorer usage.
- `apps/desktop/src/components/explore/ExplorerPane.tsx` — explorer header behavior for embedded session Files tab.
- `apps/desktop/src/components/scm/ScmSidebar.tsx` — SCM header behavior for embedded session Changes tab.
- `apps/desktop/src/workbench/WorkbenchCenter.tsx` — routes object center surfaces to SessionObjectPanel / WorkflowPanel / Welcome.
- `apps/desktop/src/components/workflow/workflowObjectModel.ts` — pure helper for workflow overview CTA selection and execution-session summaries.
- `apps/desktop/src/components/workflow/workflowObjectModel.test.ts` — Node regression tests for workflow object view-model logic.
- `apps/desktop/src/components/workflow/WorkflowPanel.tsx` — top-level workflow object view with `Overview / Graph / Activity / Execution` tabs.
- `apps/desktop/src/components/workflow/WorkflowOverviewTab.tsx` — spec-first workflow summary and next-step CTA.
- `apps/desktop/src/components/workflow/WorkflowActivityTab.tsx` — diagnostics + event timeline tab.
- `apps/desktop/src/components/workflow/WorkflowExecutionTab.tsx` — session assignment and execution controls tab.
- `apps/desktop/src/workbench/WorkbenchSidebar.tsx` — primary object rail, workspace context placement, object-list sidebar content.
- `apps/desktop/src/components/git/gitFreshness.ts` — pure formatter for git freshness labels/tones.
- `apps/desktop/src/components/git/gitFreshness.test.ts` — Node regression tests for freshness label formatting.
- `apps/desktop/src/components/git/GitFreshnessBadge.tsx` — reusable workspace/session/workflow freshness badge.
- `apps/desktop/src/services/gitCommands.ts` — Tauri wrapper for branch-health queries.
- `apps/desktop/src-tauri/src/git/branch.rs` — git branch-health command and Rust unit tests.
- `apps/desktop/src-tauri/src/lib.rs` — register the new `git_branch_health` command.
- `apps/desktop/src/App.tsx` — remove obsolete explorer/scm workbench reset logic that assumes those are top-level surfaces.

## Implementation notes

- Keep the existing workspace placement near the session list. Do not relocate workspace management in this phase.
- Do not add React testing libraries. Use Node test runner for pure TypeScript helpers and Rust unit tests for the Tauri git command.
- Reuse existing graph / diagnostics / timeline components. Do not rebuild workflow rendering from scratch.
- Do not add daemon-core workflow protocol changes in this phase.

### Task 1: Replace workbench navigation with an object-first state model

**Files:**
- Create: `apps/desktop/src/workbench/workbenchNavigation.ts`
- Create: `apps/desktop/src/workbench/workbenchNavigation.test.ts`
- Modify: `apps/desktop/src/store/workbenchStore.ts`
- Modify: `apps/desktop/src/services/workbenchCommands.ts`
- Test: `apps/desktop/src/workbench/workbenchNavigation.test.ts`

- [ ] **Step 1: Write the failing navigation test**

Create `apps/desktop/src/workbench/workbenchNavigation.test.ts` with this content:

```ts
// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import {
  DEFAULT_WORKBENCH_NAVIGATION_STATE,
  showSessionObject,
  showWorkflowObject,
} from "./workbenchNavigation.ts";

test("showSessionObject opens the chosen session tab and clears workflow focus", () => {
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
    focusedWorkflowTaskId: null,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `apps/desktop/src/workbench/workbenchNavigation.ts` does not exist yet.

- [ ] **Step 3: Write the pure navigation helper**

Create `apps/desktop/src/workbench/workbenchNavigation.ts` with this content:

```ts
export type WorkbenchPrimaryObject = "sessions" | "workflows";
export type WorkbenchCenterSurface = "session" | "workflow" | "welcome";
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
    focusedWorkflowTaskId: sessionId ? null : state.focusedWorkflowTaskId,
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
  return {
    ...state,
    primaryObject: "workflows",
    centerSurface: "workflow",
    focusedSessionId: input.sessionId ?? state.focusedSessionId,
    focusedWorkflowTaskId: nextTaskId,
    workflowTab: input.tab ?? "overview",
  };
}
```

- [ ] **Step 4: Replace the workbench store with tab-aware object-first state**

Replace `apps/desktop/src/store/workbenchStore.ts` with this content:

```ts
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
} from "../workbench/workbenchNavigation";

interface WorkbenchStore extends WorkbenchNavigationState {
  setPrimaryObject: (value: WorkbenchPrimaryObject) => void;
  setCenterSurface: (surface: WorkbenchCenterSurface) => void;
  setSessionTab: (tab: SessionObjectTab) => void;
  setWorkflowTab: (tab: WorkflowObjectTab) => void;
  focusSession: (sessionId: string | null) => void;
  focusWorkflowTask: (taskId: string | null) => void;
  showSessionSurface: (sessionId: string | null, tab?: SessionObjectTab) => void;
  showWorkflow: (sessionId: string | null, taskId?: string | null, tab?: WorkflowObjectTab) => void;
  resetWorkbenchMode: () => void;
}

export type {
  SessionObjectTab,
  WorkflowObjectTab,
  WorkbenchPrimaryObject,
  WorkbenchCenterSurface,
};

export const useWorkbenchStore = create<WorkbenchStore>()((set) => ({
  ...DEFAULT_WORKBENCH_NAVIGATION_STATE,

  setPrimaryObject: (primaryObject) => set({ primaryObject }),
  setCenterSurface: (centerSurface) => set({ centerSurface }),
  setSessionTab: (sessionTab) => set({
    primaryObject: "sessions",
    centerSurface: "session",
    sessionTab,
  }),
  setWorkflowTab: (workflowTab) => set({
    primaryObject: "workflows",
    centerSurface: "workflow",
    workflowTab,
  }),
  focusSession: (focusedSessionId) => set({ focusedSessionId }),
  focusWorkflowTask: (focusedWorkflowTaskId) => set({ focusedWorkflowTaskId }),
  showSessionSurface: (sessionId, tab = "run") =>
    set((state) => showSessionObject(state, sessionId, tab)),
  showWorkflow: (sessionId, taskId = null, tab = "overview") =>
    set((state) => showWorkflowObject(state, { sessionId, taskId, tab })),
  resetWorkbenchMode: () => set(DEFAULT_WORKBENCH_NAVIGATION_STATE),
}));
```

- [ ] **Step 5: Replace workbench commands so explorer/scm route into session tabs**

Replace `apps/desktop/src/services/workbenchCommands.ts` with this content:

```ts
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
  const nextSessionId = sessionId ?? null;
  const resolvedTaskId = taskId ?? (
    nextSessionId
      ? useSessionStore.getState().sessions.find((item) => item.id === nextSessionId)?.taskId ?? null
      : null
  );

  if (nextSessionId) {
    useSessionStore.getState().setActiveSession(nextSessionId);
    useSessionStore.getState().setExpandedSession(nextSessionId);
  }

  useWorkbenchStore.getState().showWorkflow(nextSessionId, resolvedTaskId, tab);
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
```

- [ ] **Step 6: Run the test and the TypeScript check**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- Node test runner reports `3` passing tests
- `tsc --noEmit` exits without diagnostics

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/workbench/workbenchNavigation.ts apps/desktop/src/workbench/workbenchNavigation.test.ts apps/desktop/src/store/workbenchStore.ts apps/desktop/src/services/workbenchCommands.ts
git commit -m "feat: add object-first workbench navigation"
```

### Task 2: Make session-local Explorer / SCM embeddable and derive linked workflow state

**Files:**
- Create: `apps/desktop/src/components/session/resolveSessionWorkflowLink.ts`
- Create: `apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts`
- Modify: `apps/desktop/src/components/ExploreMode.tsx`
- Modify: `apps/desktop/src/components/explore/ExplorerPane.tsx`
- Modify: `apps/desktop/src/components/scm/ScmSidebar.tsx`
- Test: `apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts`

- [ ] **Step 1: Write the failing linkage test**

Create `apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts` with this content:

```ts
// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import type { TaskDagDocument } from "@codebar/contracts";
import { resolveSessionWorkflowLink } from "./resolveSessionWorkflowLink.ts";

function makeDocument(): TaskDagDocument {
  return {
    graphId: "task-1",
    revision: "rev-1",
    layoutVersion: 1,
    capabilities: {
      canRefresh: true,
      canClaimStep: true,
      canCompleteStep: true,
      canBlockStep: true,
      canResolveApproval: false,
      canAttachSession: true,
      canLaunchSession: true,
      canSendSessionInput: true,
      canSubmitForReview: false,
      canConfirm: false,
      canCreateSession: false,
      canStartWorkflow: false,
    },
    task: {
      id: "task-1",
      title: "Ship workflow redesign",
      prompt: "Redesign workflow",
      status: "active",
      lifecycle: "running",
      workspaceId: "workspace-1",
    },
    plan: {
      id: "plan-1",
      mode: "guided",
      status: "active",
      stepIds: ["step-1"],
    },
    nodes: [
      {
        kind: "step",
        id: "node-step-1",
        stepId: "step-1",
        label: "Implement object-first navigation",
        status: "running",
        dependsOn: [],
        requiredSkills: [],
        allowedProviders: ["claude_code"],
        parallelizable: false,
        x: 0,
        y: 0,
        runtime: {
          currentSession: {
            id: "session-1",
            provider: "claude_code",
            state: "running",
          },
          recommendedNextActions: [],
        },
      },
    ],
    edges: [],
  };
}

test("resolveSessionWorkflowLink returns the linked step for the current session", () => {
  const link = resolveSessionWorkflowLink({
    sessionId: "session-1",
    taskId: "task-1",
    document: makeDocument(),
  });

  assert.deepEqual(link, {
    taskId: "task-1",
    taskTitle: "Ship workflow redesign",
    lifecycle: "running",
    stepId: "step-1",
    stepLabel: "Implement object-first navigation",
    stepStatus: "running",
  });
});

test("resolveSessionWorkflowLink still returns the workflow even when no step is currently assigned", () => {
  const document = makeDocument();
  const link = resolveSessionWorkflowLink({
    sessionId: "session-9",
    taskId: "task-1",
    document,
  });

  assert.equal(link.taskId, "task-1");
  assert.equal(link.taskTitle, "Ship workflow redesign");
  assert.equal(link.lifecycle, "running");
  assert.equal(link.stepId, null);
  assert.equal(link.stepLabel, null);
  assert.equal(link.stepStatus, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `apps/desktop/src/components/session/resolveSessionWorkflowLink.ts` does not exist yet.

- [ ] **Step 3: Add the pure session-to-workflow helper**

Create `apps/desktop/src/components/session/resolveSessionWorkflowLink.ts` with this content:

```ts
import type { TaskDagDocument, TaskDagStepNode, WorkflowLifecycle } from "@codebar/contracts";

export interface SessionWorkflowLink {
  taskId: string | null;
  taskTitle: string | null;
  lifecycle: WorkflowLifecycle | null;
  stepId: string | null;
  stepLabel: string | null;
  stepStatus: string | null;
}

function resolveLifecycle(document: TaskDagDocument | undefined): WorkflowLifecycle | null {
  const lifecycle = document?.task.lifecycle;
  if (lifecycle === "draft" || lifecycle === "in_review" || lifecycle === "confirmed" || lifecycle === "running") {
    return lifecycle;
  }
  const status = document?.task.status;
  if (status === "draft") return "draft";
  if (status === "ready") return "confirmed";
  if (status === "active") return "running";
  return document ? "in_review" : null;
}

export function resolveSessionWorkflowLink(input: {
  sessionId: string;
  taskId?: string | null;
  document?: TaskDagDocument;
}): SessionWorkflowLink {
  const taskId = input.taskId ?? input.document?.task.id ?? null;
  const taskTitle = input.document?.task.title ?? null;
  const lifecycle = resolveLifecycle(input.document);
  const stepNode = input.document?.nodes.find((node): node is TaskDagStepNode => {
    return node.kind === "step" && node.runtime?.currentSession?.id === input.sessionId;
  }) ?? null;

  return {
    taskId,
    taskTitle,
    lifecycle,
    stepId: stepNode?.stepId ?? null,
    stepLabel: stepNode?.label ?? null,
    stepStatus: stepNode?.status ?? null,
  };
}
```

- [ ] **Step 4: Make the explorer wrapper usable inside a session Files tab**

Replace `apps/desktop/src/components/ExploreMode.tsx` with this content:

```ts
import { Component, type ReactNode } from "react";
import { useAppI18n } from "../i18n";
import { type ClaudeSession } from "../store/sessionStore";
import { ExplorerPane } from "./explore/ExplorerPane";
import { EditorSplitHost } from "./editor/EditorSplitHost";

class ExploreErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    console.error("[explore-mode] render crash", error);
    window.dispatchEvent(new CustomEvent("explore-boundary-error", {
      detail: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack ?? null : null,
      },
    }));
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: "100%",
          height: "100%",
          padding: 16,
          boxSizing: "border-box",
          overflow: "auto",
          background: "var(--ci-surface)",
          color: "var(--ci-deleted-text)",
          fontSize: 12,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}>
          {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}

function EmptyEditorState({ message }: { message: string }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 280,
        padding: "22px 24px",
        borderRadius: 18,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-surface)",
        color: "var(--ci-text-dim)",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.7,
      }}>
        {message}
      </div>
    </div>
  );
}

export function ExploreSidebar({
  session,
  onRefreshDiff,
  showBackButton = true,
  onBack,
  onOpenScm,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
  showBackButton?: boolean;
  onBack?: () => void;
  onOpenScm?: () => void;
}) {
  const { t } = useAppI18n();
  return (
    <ExploreErrorBoundary>
      <div style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        background: "transparent",
        borderInlineEnd: "1px solid var(--ci-toolbar-border)",
      }}>
        {session ? (
          <ExplorerPane
            session={session}
            onRefreshDiff={onRefreshDiff}
            showBackButton={showBackButton}
            onBack={onBack}
            onOpenScm={onOpenScm}
          />
        ) : (
          <EmptyEditorState message={t("explorer.enterExplorer")} />
        )}
      </div>
    </ExploreErrorBoundary>
  );
}

export function ExploreEditor({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  return (
    <ExploreErrorBoundary>
      <div style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "transparent",
      }}>
        <EditorSplitHost session={session} onRefreshDiff={onRefreshDiff} />
      </div>
    </ExploreErrorBoundary>
  );
}
```

- [ ] **Step 5: Update the explorer pane header to support embedded Files usage**

In `apps/desktop/src/components/explore/ExplorerPane.tsx`, replace the function signature and top action row with this code:

```ts
export function ExplorerPane({
  session,
  onRefreshDiff,
  showBackButton = true,
  onBack,
  onOpenScm,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
  showBackButton?: boolean;
  onBack?: () => void;
  onOpenScm?: () => void;
}) {
```

```tsx
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 6,
        padding: "6px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onRefreshDiff(session.id, { reloadExplorer: true })}
            style={{ background: "none", border: "none", color: rootLoading ? "var(--ci-text)" : "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", opacity: rootLoading ? 1 : 0.85 }}
            title={t("explorer.refreshChanges")}
          >
            <RefreshCw size={13} strokeWidth={1.8} />
          </button>
          {showBackButton ? (
            <button
              onClick={onBack ?? resetWorkbenchMode}
              style={{ background: "none", border: "none", color: "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title={t("explorer.backToSession")}
            >
              <ChevronLeftGlyph />
            </button>
          ) : null}
        </div>
      </div>
```

```tsx
          <button
            onClick={onOpenScm ?? (() => showScm(session.id))}
            style={{
              background: "none",
              border: "none",
              color: "var(--ci-text-dim)",
              padding: 0,
              fontSize: 10,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("explorer.open")}
          </button>
```

- [ ] **Step 6: Update SCM sidebar to support embedded Changes usage**

In `apps/desktop/src/components/scm/ScmSidebar.tsx`, replace the function signature and the top back row with this code:

```ts
export function ScmSidebar({
  session,
  showBackButton = true,
  onBack,
}: {
  session: ClaudeSession | null;
  showBackButton?: boolean;
  onBack?: () => void;
}) {
```

```tsx
      {showBackButton ? (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--ci-toolbar-border)",
        }}>
          <button
            onClick={onBack ?? resetWorkbenchMode}
            style={{
              background: "none",
              border: "none",
              color: "var(--ci-text-muted)",
              cursor: "pointer",
              padding: 0,
              fontSize: 12,
            }}
            title={t("scm.backToSession")}
          >
            ←
          </button>
        </div>
      ) : null}
```

- [ ] **Step 7: Run the test and the TypeScript check**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- Node test runner reports `2` passing tests
- `tsc --noEmit` exits without diagnostics

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/components/session/resolveSessionWorkflowLink.ts apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts apps/desktop/src/components/ExploreMode.tsx apps/desktop/src/components/explore/ExplorerPane.tsx apps/desktop/src/components/scm/ScmSidebar.tsx
git commit -m "refactor: prepare embedded session object views"
```

### Task 3: Build the Session object panel with Run / Changes / Files / Linked Workflow tabs

**Files:**
- Create: `apps/desktop/src/components/session/SessionFilesView.tsx`
- Create: `apps/desktop/src/components/session/SessionLinkedWorkflowView.tsx`
- Create: `apps/desktop/src/components/session/SessionObjectPanel.tsx`
- Modify: `apps/desktop/src/workbench/WorkbenchCenter.tsx`
- Test: `apps/desktop/src/workbench/workbenchNavigation.test.ts`

- [ ] **Step 1: Extend the navigation test with session-tab defaults**

Append this test to `apps/desktop/src/workbench/workbenchNavigation.test.ts`:

```ts
test("showSessionObject defaults to the run tab when no tab is provided", () => {
  const next = showSessionObject(DEFAULT_WORKBENCH_NAVIGATION_STATE, "session-3");

  assert.equal(next.primaryObject, "sessions");
  assert.equal(next.centerSurface, "session");
  assert.equal(next.focusedSessionId, "session-3");
  assert.equal(next.sessionTab, "run");
});
```

- [ ] **Step 2: Run the test to verify the current navigation helper still passes before UI work**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts
```

Expected: PASS with `4` passing tests. Do not continue until this stays green.

- [ ] **Step 3: Add the reusable session Files view**

Create `apps/desktop/src/components/session/SessionFilesView.tsx` with this content:

```ts
import { ExploreEditor, ExploreSidebar } from "../ExploreMode";
import { type ClaudeSession } from "../../store/sessionStore";

export function SessionFilesView({
  session,
  onRefreshDiff,
  onOpenChanges,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
  onOpenChanges: () => void;
}) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minHeight: 0 }}>
      <div style={{ width: 320, minWidth: 260, maxWidth: 420, minHeight: 0 }}>
        <ExploreSidebar
          session={session}
          onRefreshDiff={onRefreshDiff}
          showBackButton={false}
          onOpenScm={onOpenChanges}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <ExploreEditor session={session} onRefreshDiff={onRefreshDiff} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the lightweight linked-workflow tab**

Create `apps/desktop/src/components/session/SessionLinkedWorkflowView.tsx` with this content:

```ts
import { useEffect } from "react";
import { type ClaudeSession } from "../../store/sessionStore";
import { useWorkflowStore } from "../../store/workflowStore";
import { showWorkflow } from "../../services/workbenchCommands";
import { resolveSessionWorkflowLink } from "./resolveSessionWorkflowLink";

function lifecycleLabel(value: string | null) {
  return value === "in_review" ? "in review" : value;
}

export function SessionLinkedWorkflowView({ session }: { session: ClaudeSession }) {
  const snapshotsByTaskId = useWorkflowStore((s) => s.snapshotsByTaskId);
  const refreshWorkflow = useWorkflowStore((s) => s.refreshWorkflow);

  const taskId = session.taskId ?? null;
  const document = taskId ? snapshotsByTaskId[taskId] : undefined;

  useEffect(() => {
    if (!taskId || document) return;
    void refreshWorkflow(taskId, session.id);
  }, [document, refreshWorkflow, session.id, taskId]);

  if (!taskId) {
    return (
      <div style={{ padding: 20, color: "var(--ci-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
        This session is not linked to a workflow yet.
      </div>
    );
  }

  const link = resolveSessionWorkflowLink({
    sessionId: session.id,
    taskId,
    document,
  });

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Workflow
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {link.taskTitle ?? taskId}
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Lifecycle: {lifecycleLabel(link.lifecycle)}
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Current step: {link.stepLabel ?? "No step currently assigned to this session"}
        </div>
        {link.stepStatus ? (
          <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
            Step status: {link.stepStatus}
          </div>
        ) : null}
        <div>
          <button
            onClick={() => showWorkflow(session.id, taskId, "overview")}
            style={{
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              fontWeight: 600,
              background: "var(--ci-accent-bg)",
              color: "var(--ci-accent)",
              border: "1px solid var(--ci-accent-bdr)",
              cursor: "pointer",
            }}
          >
            Open workflow
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the session object panel and swap the center surface over to it**

Create `apps/desktop/src/components/session/SessionObjectPanel.tsx` with this content:

```ts
import { useMemo } from "react";
import { type ClaudeSession } from "../../store/sessionStore";
import { useWorkbenchStore, type SessionObjectTab } from "../../store/workbenchStore";
import { useDaemonData } from "../../daemon/DaemonDataProvider";
import { selectSessionView } from "../../daemon/selectors";
import { SessionDetail } from "../SessionDetail";
import { ScmSidebar } from "../scm/ScmSidebar";
import { SessionFilesView } from "./SessionFilesView";
import { SessionLinkedWorkflowView } from "./SessionLinkedWorkflowView";

const SESSION_TABS: Array<{ id: SessionObjectTab; label: string }> = [
  { id: "run", label: "Run" },
  { id: "changes", label: "Changes" },
  { id: "files", label: "Files" },
  { id: "linked_workflow", label: "Linked Workflow" },
];

function tabButtonStyle(active: boolean) {
  return {
    borderRadius: 999,
    border: active ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-toolbar-border)",
    background: active ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
    color: active ? "var(--ci-accent)" : "var(--ci-text-dim)",
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  } as const;
}

export function SessionObjectPanel({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const sessionTab = useWorkbenchStore((s) => s.sessionTab);
  const setSessionTab = useWorkbenchStore((s) => s.setSessionTab);
  const daemon = useDaemonData();

  const sessionView = useMemo(
    () => (session ? selectSessionView(daemon.state, session.id) : null),
    [daemon.state, session],
  );

  if (!session) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ci-text-dim)",
        fontSize: 12,
      }}>
        Select a session to continue.
      </div>
    );
  }

  const branchName = sessionView?.worktree?.branchName ?? session.branchName ?? null;
  const baseBranch = sessionView?.worktree?.baseBranch ?? session.baseBranch ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, background: "var(--ci-bg)" }}>
      <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Session
            </div>
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sessionView?.task?.title ?? session.name}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {branchName ? (
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--ci-text-dim)" }}>
                {branchName}
              </span>
            ) : null}
            {baseBranch ? (
              <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>
                base {baseBranch}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SESSION_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSessionTab(tab.id)}
              style={tabButtonStyle(sessionTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {sessionTab === "run" ? (
          <SessionDetail mode="embedded" openSessionId={session.id} showPanelHeader={false} />
        ) : sessionTab === "changes" ? (
          <ScmSidebar session={session} showBackButton={false} />
        ) : sessionTab === "files" ? (
          <SessionFilesView session={session} onRefreshDiff={onRefreshDiff} onOpenChanges={() => setSessionTab("changes")} />
        ) : (
          <SessionLinkedWorkflowView session={session} />
        )}
      </div>
    </div>
  );
}
```

In `apps/desktop/src/workbench/WorkbenchCenter.tsx`, replace the import section and the render branches with this code:

```ts
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppI18n } from "../i18n";
import { showSessionSurface, showExplorer, showScm, showWorkflow } from "../services/workbenchCommands";
import { WorkflowPanel } from "../components/workflow/WorkflowPanel";
import { SessionObjectPanel } from "../components/session/SessionObjectPanel";
import { sanitizeRunnerConfig, useSettingsStore } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { createDaemonSession, syncWorkspaceToDaemon } from "../services/daemonCommands";
import { useSessionStore, type ClaudeSession } from "../store/sessionStore";
import { useDaemonData } from "../daemon/DaemonDataProvider";
```

```ts
export function WorkbenchCenter({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const centerSurface = useWorkbenchStore((s) => s.centerSurface);

  if (centerSurface === "welcome") {
    return <WorkbenchWelcome session={session} />;
  }

  if (centerSurface === "workflow") {
    return <WorkflowPanel session={session} />;
  }

  if (centerSurface === "session") {
    return <SessionObjectPanel session={session} onRefreshDiff={onRefreshDiff} />;
  }

  return <WorkbenchWelcome session={session} />;
}
```

- [ ] **Step 6: Run the test and the desktop typecheck**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- Node test runner reports `6` passing tests
- `tsc --noEmit` exits without diagnostics

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/session/SessionFilesView.tsx apps/desktop/src/components/session/SessionLinkedWorkflowView.tsx apps/desktop/src/components/session/SessionObjectPanel.tsx apps/desktop/src/workbench/WorkbenchCenter.tsx apps/desktop/src/workbench/workbenchNavigation.test.ts
git commit -m "feat: add session object tabs"
```

### Task 4: Turn workflow into an Overview / Graph / Activity / Execution object view

**Files:**
- Create: `apps/desktop/src/components/workflow/workflowObjectModel.ts`
- Create: `apps/desktop/src/components/workflow/workflowObjectModel.test.ts`
- Create: `apps/desktop/src/components/workflow/WorkflowOverviewTab.tsx`
- Create: `apps/desktop/src/components/workflow/WorkflowActivityTab.tsx`
- Create: `apps/desktop/src/components/workflow/WorkflowExecutionTab.tsx`
- Modify: `apps/desktop/src/components/workflow/WorkflowPanel.tsx`
- Modify: `apps/desktop/src/workbench/WorkbenchSidebar.tsx`
- Test: `apps/desktop/src/components/workflow/workflowObjectModel.test.ts`

- [ ] **Step 1: Write the failing workflow object-model test**

Create `apps/desktop/src/components/workflow/workflowObjectModel.test.ts` with this content:

```ts
// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import type { TaskDagDocument } from "@codebar/contracts";
import {
  collectWorkflowExecutionSessions,
  resolveWorkflowOverviewCta,
} from "./workflowObjectModel.ts";

function makeDocument(): TaskDagDocument {
  return {
    graphId: "task-1",
    revision: "rev-1",
    layoutVersion: 1,
    capabilities: {
      canRefresh: true,
      canClaimStep: true,
      canCompleteStep: true,
      canBlockStep: true,
      canResolveApproval: true,
      canAttachSession: true,
      canLaunchSession: true,
      canSendSessionInput: true,
      canSubmitForReview: true,
      canConfirm: true,
      canCreateSession: true,
      canStartWorkflow: true,
    },
    task: {
      id: "task-1",
      title: "Ship workflow control plane",
      prompt: "Redesign workflow",
      status: "active",
      lifecycle: "running",
      workspaceId: "workspace-1",
      activeSessionId: "session-1",
    },
    nodes: [
      {
        kind: "step",
        id: "step-node-1",
        stepId: "step-1",
        label: "Refactor sidebar",
        status: "running",
        dependsOn: [],
        requiredSkills: [],
        allowedProviders: ["claude_code"],
        parallelizable: false,
        x: 0,
        y: 0,
        runtime: {
          currentSession: {
            id: "session-1",
            provider: "claude_code",
            state: "running",
          },
          recommendedNextActions: [],
        },
      },
      {
        kind: "step",
        id: "step-node-2",
        stepId: "step-2",
        label: "Refactor workflow view",
        status: "ready",
        dependsOn: ["step-1"],
        requiredSkills: [],
        allowedProviders: ["claude_code"],
        parallelizable: false,
        x: 0,
        y: 0,
        runtime: {
          currentSession: {
            id: "session-2",
            provider: "codex",
            state: "waiting_input",
          },
          recommendedNextActions: [],
        },
      },
    ],
    edges: [],
  };
}

test("collectWorkflowExecutionSessions returns one summary per session-bound step", () => {
  const sessions = collectWorkflowExecutionSessions(makeDocument());

  assert.deepEqual(sessions, [
    {
      sessionId: "session-1",
      provider: "claude_code",
      state: "running",
      stepId: "step-1",
      stepLabel: "Refactor sidebar",
    },
    {
      sessionId: "session-2",
      provider: "codex",
      state: "waiting_input",
      stepId: "step-2",
      stepLabel: "Refactor workflow view",
    },
  ]);
});

test("resolveWorkflowOverviewCta directs confirmed workflows toward execution", () => {
  const cta = resolveWorkflowOverviewCta("confirmed");

  assert.deepEqual(cta, {
    title: "Prepare execution",
    detail: "Attach or create sessions before starting the workflow.",
    buttonLabel: "Open Execution",
    targetTab: "execution",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/workflow/workflowObjectModel.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `apps/desktop/src/components/workflow/workflowObjectModel.ts` does not exist yet.

- [ ] **Step 3: Add the workflow object-model helper**

Create `apps/desktop/src/components/workflow/workflowObjectModel.ts` with this content:

```ts
import type { TaskDagDocument, TaskDagStepNode, WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowObjectTab } from "../../store/workbenchStore";

export interface WorkflowExecutionSessionSummary {
  sessionId: string;
  provider: string;
  state: string;
  stepId: string;
  stepLabel: string;
}

export function collectWorkflowExecutionSessions(document: TaskDagDocument | undefined): WorkflowExecutionSessionSummary[] {
  if (!document) return [];

  return document.nodes.flatMap((node) => {
    if (node.kind !== "step") return [];
    const step = node as TaskDagStepNode;
    const currentSession = step.runtime?.currentSession;
    if (!currentSession) return [];
    return [{
      sessionId: currentSession.id,
      provider: currentSession.provider,
      state: currentSession.state,
      stepId: step.stepId,
      stepLabel: step.label,
    }];
  });
}

export function resolveWorkflowOverviewCta(lifecycle: WorkflowLifecycle): {
  title: string;
  detail: string;
  buttonLabel: string;
  targetTab: WorkflowObjectTab;
} {
  switch (lifecycle) {
    case "draft":
      return {
        title: "Draft the workflow",
        detail: "Refine scope and decomposition before sending it for review.",
        buttonLabel: "Review Graph",
        targetTab: "graph",
      };
    case "in_review":
      return {
        title: "Confirm the workflow",
        detail: "Inspect the graph and blockers before confirming the plan.",
        buttonLabel: "Open Graph",
        targetTab: "graph",
      };
    case "confirmed":
      return {
        title: "Prepare execution",
        detail: "Attach or create sessions before starting the workflow.",
        buttonLabel: "Open Execution",
        targetTab: "execution",
      };
    case "running":
      return {
        title: "Monitor execution",
        detail: "Track sessions, blockers, approvals, and progress from the control plane.",
        buttonLabel: "Open Activity",
        targetTab: "activity",
      };
  }
}
```

- [ ] **Step 4: Add dedicated workflow tabs and refactor WorkflowPanel to use them**

Create `apps/desktop/src/components/workflow/WorkflowOverviewTab.tsx` with this content:

```ts
import type { TaskDagDocument, WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowObjectTab } from "../../store/workbenchStore";
import { resolveWorkflowOverviewCta } from "./workflowObjectModel";

export function WorkflowOverviewTab({
  document,
  lifecycle,
  onSubmitForReview,
  onConfirmTask,
  onOpenTab,
}: {
  document: TaskDagDocument;
  lifecycle: WorkflowLifecycle;
  onSubmitForReview: () => void;
  onConfirmTask: () => void;
  onOpenTab: (tab: WorkflowObjectTab) => void;
}) {
  const cta = resolveWorkflowOverviewCta(lifecycle);

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Goal
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {document.task.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--ci-text-dim)" }}>
          {document.task.goal ?? document.task.prompt}
        </div>
      </div>

      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Next action
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {cta.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--ci-text-dim)" }}>
          {cta.detail}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {lifecycle === "draft" ? (
            <button onClick={onSubmitForReview} style={primaryButtonStyle(false)}>Submit for review</button>
          ) : lifecycle === "in_review" ? (
            <button onClick={onConfirmTask} style={primaryButtonStyle(false)}>Confirm workflow</button>
          ) : null}
          <button onClick={() => onOpenTab(cta.targetTab)} style={secondaryButtonStyle(false)}>{cta.buttonLabel}</button>
        </div>
      </div>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-accent-bg)",
    color: "var(--ci-accent)",
    border: "1px solid var(--ci-accent-bdr)",
  } as const;
}

function secondaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}
```

Create `apps/desktop/src/components/workflow/WorkflowActivityTab.tsx` with this content:

```ts
import type { TaskDagDiagnostic, TaskDagEvent, WorkflowLifecycle } from "@codebar/contracts";
import { WorkflowDiagnosticsPanel } from "./WorkflowDiagnosticsPanel";
import { WorkflowEventTimeline } from "./WorkflowEventTimeline";

export function WorkflowActivityTab({
  lifecycle,
  diagnostics,
  events,
}: {
  lifecycle: WorkflowLifecycle;
  diagnostics: TaskDagDiagnostic[];
  events: TaskDagEvent[];
}) {
  return (
    <div style={{ padding: 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, minHeight: 0 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Diagnostics · {lifecycle}
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>
          <WorkflowDiagnosticsPanel diagnostics={diagnostics} />
        </div>
      </div>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Events
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>
          <WorkflowEventTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
```

Create `apps/desktop/src/components/workflow/WorkflowExecutionTab.tsx` with this content:

```ts
import type { WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowExecutionSessionSummary } from "./workflowObjectModel";

export function WorkflowExecutionTab({
  lifecycle,
  workflowSessionId,
  sessions,
  canAttachCurrentSession,
  canCreateSession,
  canStartWorkflow,
  attachingSession,
  creatingSession,
  startingWorkflow,
  onAttachCurrentSession,
  onCreateSession,
  onStartWorkflow,
}: {
  lifecycle: WorkflowLifecycle;
  workflowSessionId: string | null;
  sessions: WorkflowExecutionSessionSummary[];
  canAttachCurrentSession: boolean;
  canCreateSession: boolean;
  canStartWorkflow: boolean;
  attachingSession: boolean;
  creatingSession: boolean;
  startingWorkflow: boolean;
  onAttachCurrentSession: () => void;
  onCreateSession: () => void;
  onStartWorkflow: () => void;
}) {
  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Execution controls
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!canAttachCurrentSession || attachingSession} onClick={onAttachCurrentSession} style={secondaryButtonStyle(!canAttachCurrentSession || attachingSession)}>
            {attachingSession ? "Attaching…" : "Attach current session"}
          </button>
          <button disabled={!canCreateSession || creatingSession} onClick={onCreateSession} style={secondaryButtonStyle(!canCreateSession || creatingSession)}>
            {creatingSession ? "Creating…" : "Create session"}
          </button>
          <button disabled={!workflowSessionId || !canStartWorkflow || startingWorkflow} onClick={onStartWorkflow} style={primaryButtonStyle(!workflowSessionId || !canStartWorkflow || startingWorkflow)}>
            {startingWorkflow ? "Starting…" : "Start workflow"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Lifecycle: {lifecycle}. Use this tab to bind sessions before starting execution.
        </div>
      </div>

      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Participating sessions
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            No workflow steps are currently attached to a session.
          </div>
        ) : (
          sessions.map((item) => (
            <div key={`${item.sessionId}:${item.stepId}`} style={{
              borderRadius: 10,
              border: "1px solid var(--ci-toolbar-border)",
              background: "var(--ci-card-bg)",
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ci-text)" }}>
                  s-{item.sessionId}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--ci-text-dim)" }}>
                  {item.stepLabel}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--ci-text-dim)" }}>
                <div>{item.provider}</div>
                <div style={{ marginTop: 4 }}>{item.state}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-accent-bg)",
    color: "var(--ci-accent)",
    border: "1px solid var(--ci-accent-bdr)",
  } as const;
}

function secondaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}
```

In `apps/desktop/src/components/workflow/WorkflowPanel.tsx`, replace the component body with this final structure:

```ts
import { useEffect, useMemo, useState } from "react";
import type { TaskDagDocument, WorkflowLifecycle, WorkflowTaskSummary } from "@codebar/contracts";
import type { ClaudeSession } from "../../store/sessionStore";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSessionStore } from "../../store/sessionStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useWorkflowExecutionStore } from "../../store/workflowExecutionStore";
import { useWorkflowStore, selectWorkflowNodeById } from "../../store/workflowStore";
import { WorkflowDetailSheet } from "./WorkflowDetailSheet";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowOverviewTab } from "./WorkflowOverviewTab";
import { WorkflowActivityTab } from "./WorkflowActivityTab";
import { WorkflowExecutionTab } from "./WorkflowExecutionTab";
import { collectWorkflowExecutionSessions } from "./workflowObjectModel";
```

```tsx
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-panel-bg)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {document.task.title}
                  </div>
                  <span style={lifecycleBadgeStyle(lifecycle)}>{lifecycleLabel(lifecycle)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--ci-text-dim)" }}>
                  {lifecycleHint(lifecycle)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {executionState ? <span style={executionBadgeStyle(executionState)}>{executionState}</span> : null}
                {activeExecutionIntent ? <span style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>{activeExecutionIntent.action}</span> : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-panel-bg)" }}>
              {([
                ["overview", "Overview"],
                ["graph", "Graph"],
                ["activity", "Activity"],
                ["execution", "Execution"],
              ] as const).map(([tabId, label]) => (
                <button
                  key={tabId}
                  onClick={() => useWorkbenchStore.getState().setWorkflowTab(tabId)}
                  style={{
                    borderRadius: 999,
                    border: workflowTab === tabId ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-toolbar-border)",
                    background: workflowTab === tabId ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
                    color: workflowTab === tabId ? "var(--ci-accent)" : "var(--ci-text-dim)",
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              {workflowTab === "overview" ? (
                <WorkflowOverviewTab
                  document={document}
                  lifecycle={lifecycle}
                  onSubmitForReview={() => void handleSubmitForReview()}
                  onConfirmTask={() => void handleConfirmTask()}
                  onOpenTab={(tab) => useWorkbenchStore.getState().setWorkflowTab(tab)}
                />
              ) : workflowTab === "activity" ? (
                <WorkflowActivityTab lifecycle={lifecycle} diagnostics={diagnostics} events={events} />
              ) : workflowTab === "execution" ? (
                <WorkflowExecutionTab
                  lifecycle={lifecycle}
                  workflowSessionId={workflowSessionId}
                  sessions={collectWorkflowExecutionSessions(document)}
                  canAttachCurrentSession={!!session && !attachingSession}
                  canCreateSession={!!document.capabilities.canCreateSession}
                  canStartWorkflow={!!document.capabilities.canStartWorkflow}
                  attachingSession={attachingSession}
                  creatingSession={creatingSession}
                  startingWorkflow={startingWorkflow}
                  onAttachCurrentSession={() => void handleAttachCurrentSession()}
                  onCreateSession={() => void handleCreateSession()}
                  onStartWorkflow={() => void handleStartWorkflow()}
                />
              ) : (
                <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <WorkflowGraph document={documentWithExecutionState ?? document} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNode} />
                  </div>
                  <WorkflowDetailSheet
                    lifecycle={lifecycle}
                    node={node}
                    onClose={() => setSelectedNode(null)}
                    onClaim={(stepId) => {
                      if (!workflowSessionId) return;
                      void claimStep(workflowSessionId, stepId);
                    }}
                    onComplete={(stepId) => {
                      if (!workflowSessionId) return;
                      void completeStep(workflowSessionId, stepId);
                    }}
                    onBlock={(stepId) => {
                      if (!workflowSessionId) return;
                      void blockStep(workflowSessionId, stepId, `Blocked ${stepId} from workflow surface`);
                    }}
                    onResolveApproval={(approvalId) => void resolveApproval(approvalId, workflowSessionId ?? undefined)}
                    diagnostics={filteredDiagnostics}
                    events={filteredEvents}
                    capabilities={{
                      canClaimStep: !!document.capabilities.canClaimStep && canRunNodeActions,
                      canCompleteStep: !!document.capabilities.canCompleteStep && canRunNodeActions,
                      canBlockStep: !!document.capabilities.canBlockStep && canRunNodeActions,
                      canResolveApproval: !!document.capabilities.canResolveApproval && canRunNodeActions,
                    }}
                    pendingAction={node && node.kind === "step" ? pendingActionByStepId[node.stepId] ?? null : null}
                    approvalPending={node && node.kind === "approval_gate" ? pendingApprovalIds[node.approvalRequest.id] ?? false : false}
                    executionState={executionState}
                    activeExecutionAction={activeExecutionIntent?.action ?? null}
                    autoContinueDecision={autoContinueDecision}
                  />
                </div>
              )}
            </div>
```

In `apps/desktop/src/workbench/WorkbenchSidebar.tsx`, change the workflow task selection handler inside `WorkflowSidebarTasks` to stop defaulting to the currently open session:

```ts
  const handleSelectTask = (taskId: string, activeSessionId?: string) => {
    const sessionId = activeSessionId ?? null;
    focusWorkflowTask(taskId);
    setSelectedTask(taskId, sessionId);
    void refreshWorkflow(taskId, sessionId);
  };
```

- [ ] **Step 5: Run the test and the desktop typecheck**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/workflow/workflowObjectModel.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- Node test runner reports `2` passing tests
- `tsc --noEmit` exits without diagnostics

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/workflow/workflowObjectModel.ts apps/desktop/src/components/workflow/workflowObjectModel.test.ts apps/desktop/src/components/workflow/WorkflowOverviewTab.tsx apps/desktop/src/components/workflow/WorkflowActivityTab.tsx apps/desktop/src/components/workflow/WorkflowExecutionTab.tsx apps/desktop/src/components/workflow/WorkflowPanel.tsx apps/desktop/src/workbench/WorkbenchSidebar.tsx
git commit -m "feat: add workflow object tabs"
```

### Task 5: Add git/mainline freshness signals for workspace, session, and workflow headers

**Files:**
- Create: `apps/desktop/src/components/git/gitFreshness.ts`
- Create: `apps/desktop/src/components/git/gitFreshness.test.ts`
- Create: `apps/desktop/src/components/git/GitFreshnessBadge.tsx`
- Create: `apps/desktop/src/services/gitCommands.ts`
- Modify: `apps/desktop/src-tauri/src/git/branch.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src/components/git/gitFreshness.test.ts`
- Test: `apps/desktop/src-tauri/src/git/branch.rs`

- [ ] **Step 1: Write the failing freshness formatter test**

Create `apps/desktop/src/components/git/gitFreshness.test.ts` with this content:

```ts
// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import { formatGitFreshness } from "./gitFreshness.ts";

test("formatGitFreshness reports behind-base branches as danger", () => {
  const vm = formatGitFreshness({
    currentBranch: "feature/workflow",
    baseBranch: "main",
    aheadCount: 2,
    behindCount: 3,
    dirty: false,
    conflicted: false,
  });

  assert.deepEqual(vm, {
    label: "Behind main by 3",
    detail: "Sync this branch with main before continuing larger workflow work.",
    tone: "danger",
  });
});

test("formatGitFreshness reports clean synchronized branches as success", () => {
  const vm = formatGitFreshness({
    currentBranch: "main",
    baseBranch: "main",
    aheadCount: 0,
    behindCount: 0,
    dirty: false,
    conflicted: false,
  });

  assert.deepEqual(vm, {
    label: "Synced to main",
    detail: "Mainline freshness looks good.",
    tone: "success",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/git/gitFreshness.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `apps/desktop/src/components/git/gitFreshness.ts` does not exist yet.

- [ ] **Step 3: Add the TypeScript formatter, Tauri wrapper, and reusable badge**

Create `apps/desktop/src/components/git/gitFreshness.ts` with this content:

```ts
export interface GitBranchHealth {
  currentBranch: string | null;
  baseBranch: string | null;
  aheadCount: number;
  behindCount: number;
  dirty: boolean;
  conflicted: boolean;
}

export function formatGitFreshness(health: GitBranchHealth): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  const base = health.baseBranch ?? "main";

  if (health.conflicted) {
    return {
      label: "Conflicts",
      detail: "Resolve conflicts before continuing workflow execution.",
      tone: "danger",
    };
  }

  if (health.behindCount > 0) {
    return {
      label: `Behind ${base} by ${health.behindCount}`,
      detail: `Sync this branch with ${base} before continuing larger workflow work.`,
      tone: "danger",
    };
  }

  if (health.dirty) {
    return {
      label: "Uncommitted changes",
      detail: "This context has local changes that are not yet committed.",
      tone: "warning",
    };
  }

  if (health.aheadCount > 0) {
    return {
      label: `Ahead of ${base} by ${health.aheadCount}`,
      detail: `This branch has diverged from ${base}. Review before merging workflow output.`,
      tone: "warning",
    };
  }

  return {
    label: `Synced to ${base}`,
    detail: "Mainline freshness looks good.",
    tone: "success",
  };
}
```

Create `apps/desktop/src/services/gitCommands.ts` with this content:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { GitBranchHealth } from "../components/git/gitFreshness";

export function getGitBranchHealth(workdir: string, baseBranch?: string | null) {
  return invoke<GitBranchHealth>("git_branch_health", {
    workdir,
    baseBranch: baseBranch ?? null,
  });
}
```

Create `apps/desktop/src/components/git/GitFreshnessBadge.tsx` with this content:

```ts
import { useEffect, useState } from "react";
import { getGitBranchHealth } from "../../services/gitCommands";
import { formatGitFreshness, type GitBranchHealth } from "./gitFreshness";

function badgeStyle(tone: "success" | "warning" | "danger" | "neutral") {
  if (tone === "success") {
    return {
      background: "var(--ci-green-bg)",
      color: "var(--ci-green-dark)",
      border: "1px solid var(--ci-green-bdr)",
    } as const;
  }
  if (tone === "warning") {
    return {
      background: "var(--ci-yellow-bg)",
      color: "var(--ci-yellow-dark)",
      border: "1px solid var(--ci-yellow-bdr)",
    } as const;
  }
  if (tone === "danger") {
    return {
      background: "var(--ci-deleted-bg)",
      color: "var(--ci-deleted-text)",
      border: "1px solid var(--ci-border-med)",
    } as const;
  }
  return {
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text-dim)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}

export function GitFreshnessBadge({
  workdir,
  baseBranch,
}: {
  workdir: string | null | undefined;
  baseBranch?: string | null;
}) {
  const [health, setHealth] = useState<GitBranchHealth | null>(null);

  useEffect(() => {
    if (!workdir || !("__TAURI_INTERNALS__" in window)) {
      setHealth(null);
      return;
    }

    let cancelled = false;
    void getGitBranchHealth(workdir, baseBranch)
      .then((next) => {
        if (!cancelled) setHealth(next);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });

    return () => {
      cancelled = true;
    };
  }, [baseBranch, workdir]);

  if (!health) return null;

  const vm = formatGitFreshness(health);
  const style = badgeStyle(vm.tone);

  return (
    <span
      title={vm.detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        ...style,
      }}
    >
      {vm.label}
    </span>
  );
}
```

- [ ] **Step 4: Add the Rust branch-health command and its unit tests**

In `apps/desktop/src-tauri/src/git/branch.rs`, replace the file with this content:

```rust
use serde::Serialize;

use crate::git::status::get_git_status_raw;
use crate::util::{background_command, expand_path};

fn git_run(workdir: &str, args: &[&str]) -> Result<String, String> {
    let out = background_command("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn ref_exists(workdir: &str, reference: &str) -> bool {
    background_command("git")
        .current_dir(workdir)
        .args(["rev-parse", "--verify", "--quiet", reference])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_base_branch(workdir: &str, requested: Option<&str>) -> Option<String> {
    if let Some(branch) = requested.filter(|value| !value.trim().is_empty()) {
        if ref_exists(workdir, branch) {
            return Some(branch.to_string());
        }
    }

    for candidate in ["main", "master"] {
        if ref_exists(workdir, candidate) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn rev_list_counts(workdir: &str, base_branch: &str) -> Result<(u32, u32), String> {
    let range = format!("{base_branch}...HEAD");
    let output = git_run(workdir, &["rev-list", "--left-right", "--count", &range])?;
    let parts = output.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(format!("unexpected rev-list output: {output}"));
    }

    let behind_count = parts[0].parse::<u32>().map_err(|e| e.to_string())?;
    let ahead_count = parts[1].parse::<u32>().map_err(|e| e.to_string())?;
    Ok((ahead_count, behind_count))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchHealth {
    current_branch: Option<String>,
    base_branch: Option<String>,
    ahead_count: u32,
    behind_count: u32,
    dirty: bool,
    conflicted: bool,
}

fn git_branch_health_sync(workdir: &str, requested_base_branch: Option<&str>) -> Result<GitBranchHealth, String> {
    let current_branch = git_run(workdir, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let base_branch = resolve_base_branch(workdir, requested_base_branch);
    let (ahead_count, behind_count) = if let Some(base_branch) = base_branch.as_deref() {
        rev_list_counts(workdir, base_branch)?
    } else {
        (0, 0)
    };
    let status = get_git_status_raw(workdir)?;
    let dirty = !status.conflicts.is_empty()
        || !status.staged.is_empty()
        || !status.unstaged.is_empty()
        || !status.untracked.is_empty();
    let conflicted = !status.conflicts.is_empty();

    Ok(GitBranchHealth {
        current_branch,
        base_branch,
        ahead_count,
        behind_count,
        dirty,
        conflicted,
    })
}

#[tauri::command]
pub async fn git_current_branch(workdir: String) -> Result<String, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["rev-parse", "--abbrev-ref", "HEAD"]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_create(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["checkout", "-b", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_switch(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["checkout", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_delete(workdir: String, branch: String) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || git_run(&expanded, &["branch", "-D", &branch]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_merge(
    workdir: String,
    target_branch: String,
    session_branch: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        git_run(&expanded, &["checkout", &target_branch])
            .map_err(|e| format!("切换到 {target_branch} 失败: {e}"))?;
        git_run(&expanded, &["merge", "--no-ff", &session_branch])
            .map_err(|e| format!("merge 失败: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_repo_info(workdir: String) -> Result<Option<String>, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        let out = background_command("git")
            .current_dir(&expanded)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branch_health(
    workdir: String,
    base_branch: Option<String>,
) -> Result<GitBranchHealth, String> {
    let expanded = expand_path(&workdir);
    tokio::task::spawn_blocking(move || {
        git_branch_health_sync(&expanded, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::git_branch_health_sync;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("code-bar-branch-health-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.email", "codebar@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.name", "CodeBar"])
            .output()
            .unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["add", "README.md"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        root
    }

    #[test]
    fn git_branch_health_reports_ahead_counts_against_main() {
        let repo = temp_repo("ahead");
        Command::new("git")
            .current_dir(&repo)
            .args(["checkout", "-b", "feature/workflow"])
            .output()
            .unwrap();
        fs::write(repo.join("workflow.txt"), "next\n").unwrap();
        Command::new("git")
            .current_dir(&repo)
            .args(["add", "workflow.txt"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&repo)
            .args(["commit", "-m", "feature"])
            .output()
            .unwrap();

        let health = git_branch_health_sync(repo.to_string_lossy().as_ref(), Some("main")).unwrap();
        assert_eq!(health.current_branch.as_deref(), Some("feature/workflow"));
        assert_eq!(health.base_branch.as_deref(), Some("main"));
        assert_eq!(health.ahead_count, 1);
        assert_eq!(health.behind_count, 0);
        assert!(!health.dirty);
        assert!(!health.conflicted);
    }

    #[test]
    fn git_branch_health_marks_dirty_worktrees() {
        let repo = temp_repo("dirty");
        fs::write(repo.join("README.md"), "hello\ndirty\n").unwrap();

        let health = git_branch_health_sync(repo.to_string_lossy().as_ref(), Some("main")).unwrap();
        assert_eq!(health.base_branch.as_deref(), Some("main"));
        assert!(health.dirty);
    }
}
```

In `apps/desktop/src-tauri/src/lib.rs`, add the new command beside the existing branch commands:

```rust
            git::branch::git_current_branch,
            git::branch::git_branch_create,
            git::branch::git_branch_switch,
            git::branch::git_branch_delete,
            git::branch::git_branch_merge,
            git::branch::git_repo_info,
            git::branch::git_branch_health,
```

- [ ] **Step 5: Run the tests and typecheck**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/components/git/gitFreshness.test.ts && cargo test -p code-bar git_branch_health && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- Node test runner reports `2` passing tests
- `cargo test -p code-bar git_branch_health` reports the branch-health tests as `ok`
- `tsc --noEmit` exits without diagnostics

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/git/gitFreshness.ts apps/desktop/src/components/git/gitFreshness.test.ts apps/desktop/src/components/git/GitFreshnessBadge.tsx apps/desktop/src/services/gitCommands.ts apps/desktop/src-tauri/src/git/branch.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add git freshness signals"
```

### Task 6: Rebuild the left sidebar around Sessions / Workflows and wire git freshness into object headers

**Files:**
- Modify: `apps/desktop/src/workbench/WorkbenchSidebar.tsx`
- Modify: `apps/desktop/src/components/session/SessionObjectPanel.tsx`
- Modify: `apps/desktop/src/components/workflow/WorkflowPanel.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/workbench/workbenchNavigation.test.ts`

- [ ] **Step 1: Extend the navigation test with the workflow-first selection case**

Append this test to `apps/desktop/src/workbench/workbenchNavigation.test.ts`:

```ts
test("showWorkflowObject leaves the center on the workflow surface even without a focused session", () => {
  const next = showWorkflowObject(DEFAULT_WORKBENCH_NAVIGATION_STATE, {
    taskId: "task-99",
    sessionId: null,
    tab: "overview",
  });

  assert.equal(next.centerSurface, "workflow");
  assert.equal(next.primaryObject, "workflows");
  assert.equal(next.focusedSessionId, null);
  assert.equal(next.focusedWorkflowTaskId, "task-99");
});
```

- [ ] **Step 2: Run the navigation test before the integration edits**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts
```

Expected: PASS with `5` passing tests.

- [ ] **Step 3: Replace the sidebar rail so Sessions and Workflows are the only top-level objects**

In `apps/desktop/src/workbench/WorkbenchSidebar.tsx`, replace the icon imports and the main render branch with this code:

```ts
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Files, MessageSquareCode, Workflow } from "lucide-react";
import { TitleBar } from "../components/TitleBar";
import { StatusBar } from "../components/StatusBar";
import { useAppI18n } from "../i18n";
import { useWorkflowStore } from "../store/workflowStore";
import { useDaemonData } from "../daemon/DaemonDataProvider";
import { selectSessionView } from "../daemon/selectors";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { resetWorkbenchMode, showSessionSurface, showWorkflow } from "../services/workbenchCommands";
import { WorkbenchTooltip } from "../components/ui/WorkbenchTooltip";
import { GitFreshnessBadge } from "../components/git/GitFreshnessBadge";
```

```tsx
export function WorkbenchSidebar({
  session,
  menuContent,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  menuContent: ReactNode;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const { t } = useAppI18n();
  const primaryObject = useWorkbenchStore((s) => s.primaryObject);
  const hasWorkspace = useWorkspaceStore((s) => s.workspaces.length > 0);
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const selectedTaskId = useWorkflowStore((s) => s.selectedTaskId);
  const daemon = useDaemonData();
  const sessionView = session ? selectSessionView(daemon.state, session.id) : null;

  const workflowMenu = (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ padding: "6px 18px 4px" }}>
        {menuContent.props.children[0]}
      </div>
      <WorkflowSidebarTasks session={session} />
    </div>
  );

  return (
    <>
      <TitleBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {hasWorkspace && (
          <div style={{ width: 48, display: "flex", flexDirection: "column", alignItems: "stretch", borderInlineEnd: "1px solid var(--ci-toolbar-border)", background: "transparent" }}>
            <ActivityButton
              label={t("workbench.sessions")}
              active={primaryObject === "sessions"}
              onClick={() => hasWorkspace ? showSessionSurface(session?.id ?? null) : resetWorkbenchMode()}
              icon={<MessageSquareCode size={20} strokeWidth={1.9} />}
            />
            <ActivityButton
              label="Workflows"
              active={primaryObject === "workflows"}
              onClick={() => showWorkflow(session?.id ?? null, selectedTaskId ?? null, "overview")}
              icon={<Workflow size={20} strokeWidth={1.9} />}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {activeWorkspace ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              borderBottom: "1px solid var(--ci-toolbar-border)",
              background: "transparent",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Workspace
                </div>
                <div style={{ marginTop: 3, fontSize: 11, fontWeight: 600, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeWorkspace.name}
                </div>
              </div>
              <GitFreshnessBadge workdir={activeWorkspace.path} />
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {primaryObject === "workflows" ? workflowMenu : menuContent}
          </div>
        </div>
      </div>
      <StatusBar
        session={session
          ? {
              ...session,
              workdir: sessionView?.worktree?.path ?? session.workdir,
              branchName: sessionView?.worktree?.branchName ?? session.branchName,
              baseBranch: sessionView?.worktree?.baseBranch ?? session.baseBranch,
            }
          : undefined}
      />
    </>
  );
}
```

- [ ] **Step 4: Add the git freshness badge to session and workflow headers**

In `apps/desktop/src/components/session/SessionObjectPanel.tsx`, add the import and the header badge:

```ts
import { GitFreshnessBadge } from "../git/GitFreshnessBadge";
```

```tsx
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <GitFreshnessBadge
              workdir={sessionView?.worktree?.path ?? session.worktreePath ?? session.workdir}
              baseBranch={baseBranch}
            />
            {branchName ? (
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--ci-text-dim)" }}>
                {branchName}
              </span>
            ) : null}
            {baseBranch ? (
              <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>
                base {baseBranch}
              </span>
            ) : null}
          </div>
```

In `apps/desktop/src/components/workflow/WorkflowPanel.tsx`, add the import and workflow-header badge:

```ts
import { GitFreshnessBadge } from "../git/GitFreshnessBadge";
```

```ts
  const allSessions = useSessionStore((s) => s.sessions);
  const linkedWorkflowSession = workflowSessionId
    ? allSessions.find((item) => item.id === workflowSessionId) ?? null
    : null;
  const workflowGitWorkdir = linkedWorkflowSession?.worktreePath ?? linkedWorkflowSession?.workdir ?? activeWorkspace?.path ?? null;
  const workflowGitBase = linkedWorkflowSession?.baseBranch ?? null;
```

```tsx
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <GitFreshnessBadge workdir={workflowGitWorkdir} baseBranch={workflowGitBase} />
                {executionState ? <span style={executionBadgeStyle(executionState)}>{executionState}</span> : null}
                {activeExecutionIntent ? <span style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>{activeExecutionIntent.action}</span> : null}
              </div>
```

- [ ] **Step 5: Remove obsolete explorer/scm top-level reset logic**

Delete this effect from `apps/desktop/src/App.tsx`:

```ts
  useEffect(() => {
    if (sidebarSection === "sessions" || sidebarSection === "workflow") return;
    if (workbenchSession) return;
    useWorkbenchStore.getState().resetWorkbenchMode();
  }, [sidebarSection, workbenchSession]);
```

- [ ] **Step 6: Run full automated verification**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/workbench/workbenchNavigation.test.ts apps/desktop/src/components/session/resolveSessionWorkflowLink.test.ts apps/desktop/src/components/workflow/workflowObjectModel.test.ts apps/desktop/src/components/git/gitFreshness.test.ts && cargo test -p code-bar git_branch_health && pnpm --filter @codebar/desktop exec tsc --noEmit && pnpm --filter @codebar/desktop build
```

Expected:
- all Node tests PASS
- `cargo test -p code-bar git_branch_health` reports `ok`
- `tsc --noEmit` exits without errors
- Vite build completes successfully for `@codebar/desktop`

- [ ] **Step 7: Run the desktop app and verify the object-first workflow manually**

Run:

```bash
pnpm tauri:dev:worktree
```

Expected: the Tauri desktop window opens without a runtime exception.

Manual verification checklist:

```md
- [ ] The left rail only shows Sessions and Workflows.
- [ ] The workspace context remains above the session area and now shows a git freshness badge.
- [ ] Clicking a session opens the Session object panel instead of a separate explorer/scm surface.
- [ ] Session tabs show `Run / Changes / Files / Linked Workflow`.
- [ ] `Changes` shows the SCM panel without a back button.
- [ ] `Files` shows the explorer tree and editor split inside the session object view.
- [ ] `Linked Workflow` shows the current workflow task or an explicit empty state.
- [ ] Clicking Workflows opens the workflow object view.
- [ ] Workflow tabs show `Overview / Graph / Activity / Execution`.
- [ ] `Overview` explains the workflow and gives a clear next-step CTA.
- [ ] `Execution` centralizes session attach/create/start controls.
- [ ] Session and workflow headers both show git freshness badges.
- [ ] Selecting a workflow task does not silently bind it to the currently open session unless the workflow itself already has an active session.
- [ ] Opening a session still feels immediate for existing users; the redesign should clarify the model without hiding sessions.
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/workbench/WorkbenchSidebar.tsx apps/desktop/src/components/session/SessionObjectPanel.tsx apps/desktop/src/components/workflow/WorkflowPanel.tsx apps/desktop/src/App.tsx
git commit -m "feat: turn workflow into an object-first control plane"
```

## Spec coverage check

- **Object-first navigation:** Task 1 replaces the navigation model; Task 6 makes Sessions and Workflows the only top-level objects in the left rail.
- **Session object views:** Task 2 prepares embedded explorer/scm usage; Task 3 introduces `Run / Changes / Files / Linked Workflow`.
- **Workflow object views:** Task 4 adds `Overview / Graph / Activity / Execution` and keeps workflow independent from the current session.
- **Spec-first workflow model:** Task 4 makes Overview the default workflow view and moves attach/create/start into Execution.
- **Git/mainline freshness:** Task 5 adds the backend command and reusable badge; Task 6 wires it into workspace, session, and workflow headers.
- **Gradual transition:** Task 6 keeps sessions prominent while clarifying the object model instead of hiding session-first behavior.

## Self-review

### Spec coverage

Every major section from `docs/superpowers/specs/2026-05-04-workflow-control-plane-design.md` maps to a task:

- navigation/object model → Tasks 1 and 6
- session tabs → Tasks 2 and 3
- workflow tabs → Task 4
- multi-session workflow positioning → Task 4
- git freshness visibility → Tasks 5 and 6

### Placeholder scan

This plan contains no `TBD`, `TODO`, or “similar to Task N” instructions. Each code-writing step includes the actual code to write.

### Type consistency

The shared types stay consistent across tasks:

- `SessionObjectTab` = `run | changes | files | linked_workflow`
- `WorkflowObjectTab` = `overview | graph | activity | execution`
- `WorkbenchPrimaryObject` = `sessions | workflows`
- `GitBranchHealth` uses `aheadCount`, `behindCount`, `dirty`, `conflicted`

No later task renames these symbols.
