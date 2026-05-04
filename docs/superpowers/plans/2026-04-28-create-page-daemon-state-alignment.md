# Create Page Daemon-State Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the create page use daemon session state as the single source of truth so runner switching and first-query dispatch behave like `origin/main`.

**Architecture:** Add a small pure TypeScript helper that derives create-page phase and submit action from daemon session state, cover it with Node-based regression tests, then wire `useSessionRunnerController` and the session detail views to consume those flags instead of recomputing local heuristics. Keep `querySent`, PTY readiness, and `launchPrompt` as transient UI bridge state only; bootstrap/launch/resume/send-input decisions come from daemon state plus stable session fields.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri desktop app, Node 22 built-in test runner (`node --experimental-strip-types --test`)

---

## File map

- `apps/desktop/src/hooks/createPageDaemonState.ts` — new pure helper for daemon-driven create-page phase (`compose`, `queued`, `runtime`, `inactive`) and submit routing (`bootstrap_then_launch`, `launch`, `resume`, `send_input`, `none`).
- `apps/desktop/src/hooks/createPageDaemonState.test.ts` — new Node-based regression tests for the helper; no React or DOM dependency.
- `apps/desktop/src/hooks/useSessionRunnerController.ts:69-90,135-181,228-307,335-374,427-457` — replace mixed heuristics with helper-derived flags, route first-query dispatch, and expose view-facing booleans.
- `apps/desktop/src/components/SessionDetail.tsx:177-203,231-238,379-425` — stop recomputing create-page state from raw session fields; render prompt composer/runtime surface from controller flags.
- `apps/desktop/src/components/session/SessionRunnerSurface.tsx:10-31,102-125` — consume a controller-owned runtime-visibility flag instead of combining `querySent` and `ptyEverActive` in the view.
- `apps/desktop/src/components/session/SessionPromptComposer.tsx:4-33,93-133,190-197` — show runner chips from `canSwitchRunner`, keep queued state read-only, and remove local assumptions about “already started”.

## Important implementation note

`daemon-core` does **not** allow `bootstrapSession` from `ready`. The backend contracts are:

- `bootstrapSession`: only `draft`, `preparing_workspace`, `preparing_worktree`
- `launchSession`: `ready`, `interrupted`, `waiting_input`
- `sendSessionInput`: `running`, `waiting_input`

So the UI helper must distinguish **`bootstrap_then_launch`** from plain **`launch`** instead of treating every pre-runtime state the same.

### Task 1: Add a pure daemon-state helper with regression coverage

**Files:**
- Create: `apps/desktop/src/hooks/createPageDaemonState.ts`
- Create: `apps/desktop/src/hooks/createPageDaemonState.test.ts`
- Test: `apps/desktop/src/hooks/createPageDaemonState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/hooks/createPageDaemonState.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCreatePageFlags,
  resolveSubmitAction,
} from "./createPageDaemonState.ts";

test("draft sessions stay in compose mode before the first query", () => {
  const flags = deriveCreatePageFlags({
    daemonState: "draft",
    providerSessionId: "",
    querySent: false,
  });

  assert.deepEqual(flags, {
    phase: "compose",
    canSwitchRunner: true,
    shouldShowComposer: true,
    waitingForPtyLaunch: false,
  });
});

test("launching sessions stay in queued mode while the first prompt is handing off", () => {
  const flags = deriveCreatePageFlags({
    daemonState: "launching",
    providerSessionId: "",
    querySent: true,
  });

  assert.deepEqual(flags, {
    phase: "queued",
    canSwitchRunner: false,
    shouldShowComposer: true,
    waitingForPtyLaunch: true,
  });
});

test("running sessions hand off to the runtime surface", () => {
  const flags = deriveCreatePageFlags({
    daemonState: "running",
    providerSessionId: "provider_123",
    querySent: true,
  });

  assert.deepEqual(flags, {
    phase: "runtime",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  });
});

test("draft sessions bootstrap before launch", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "draft", providerSessionId: "" }),
    "bootstrap_then_launch",
  );
});

test("ready sessions launch without a second bootstrap", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "ready", providerSessionId: "" }),
    "launch",
  );
});

test("waiting_input sessions route to send input", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "waiting_input", providerSessionId: "provider_123" }),
    "send_input",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `apps/desktop/src/hooks/createPageDaemonState.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/hooks/createPageDaemonState.ts` with this content:

```ts
export type CreatePageDaemonState =
  | "draft"
  | "preparing_workspace"
  | "preparing_worktree"
  | "ready"
  | "launching"
  | "running"
  | "waiting_input"
  | "approval_required"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived"
  | null;

export type CreatePagePhase = "compose" | "queued" | "runtime" | "inactive";
export type SubmitAction = "bootstrap_then_launch" | "launch" | "resume" | "send_input" | "none";

export interface CreatePageFlags {
  phase: CreatePagePhase;
  canSwitchRunner: boolean;
  shouldShowComposer: boolean;
  waitingForPtyLaunch: boolean;
}

export interface DeriveCreatePageFlagsInput {
  daemonState: CreatePageDaemonState;
  providerSessionId?: string | null;
  querySent: boolean;
}

export interface ResolveSubmitActionInput {
  daemonState: CreatePageDaemonState;
  providerSessionId?: string | null;
}

const BOOTSTRAP_STATES = new Set<CreatePageDaemonState>([
  "draft",
  "preparing_workspace",
  "preparing_worktree",
]);

const RUNTIME_STATES = new Set<CreatePageDaemonState>([
  "running",
  "waiting_input",
  "approval_required",
  "interrupted",
]);

export function deriveCreatePageFlags(input: DeriveCreatePageFlagsInput): CreatePageFlags {
  const { daemonState, querySent } = input;

  if (RUNTIME_STATES.has(daemonState)) {
    return {
      phase: "runtime",
      canSwitchRunner: false,
      shouldShowComposer: false,
      waitingForPtyLaunch: false,
    };
  }

  if (daemonState === "launching") {
    return {
      phase: "queued",
      canSwitchRunner: false,
      shouldShowComposer: true,
      waitingForPtyLaunch: true,
    };
  }

  if (daemonState === "ready" || BOOTSTRAP_STATES.has(daemonState) || daemonState === null) {
    return querySent
      ? {
          phase: "queued",
          canSwitchRunner: false,
          shouldShowComposer: true,
          waitingForPtyLaunch: true,
        }
      : {
          phase: "compose",
          canSwitchRunner: true,
          shouldShowComposer: true,
          waitingForPtyLaunch: false,
        };
  }

  return {
    phase: "inactive",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  };
}

export function resolveSubmitAction(input: ResolveSubmitActionInput): SubmitAction {
  const { daemonState } = input;

  if (daemonState === "running" || daemonState === "waiting_input") {
    return "send_input";
  }

  if (daemonState === "ready") {
    return "launch";
  }

  if (BOOTSTRAP_STATES.has(daemonState) || daemonState === null) {
    return "bootstrap_then_launch";
  }

  return "none";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts
```

Expected: PASS with 6 passing tests and no failures.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/createPageDaemonState.ts apps/desktop/src/hooks/createPageDaemonState.test.ts
git commit -m "test: cover create-page daemon launch state"
```

### Task 2: Drive controller launch logic from daemon state

**Files:**
- Modify: `apps/desktop/src/hooks/createPageDaemonState.ts`
- Modify: `apps/desktop/src/hooks/createPageDaemonState.test.ts`
- Modify: `apps/desktop/src/hooks/useSessionRunnerController.ts:69-90,135-181,228-307,335-374,427-457`
- Test: `apps/desktop/src/hooks/createPageDaemonState.test.ts`

- [ ] **Step 1: Extend the helper test with the hook-facing regression cases**

Append these tests to `apps/desktop/src/hooks/createPageDaemonState.test.ts`:

```ts
test("ready sessions with a bound provider resume instead of launching a fresh session", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "ready", providerSessionId: "provider_123" }),
    "resume",
  );
});

test("missing daemon state falls back to runtime when a native resume binding already exists", () => {
  const flags = deriveCreatePageFlags({
    daemonState: null,
    providerSessionId: "provider_123",
    querySent: true,
  });

  assert.deepEqual(flags, {
    phase: "runtime",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  });
});

test("interrupted sessions relaunch through resume when the provider session is known", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "interrupted", providerSessionId: "provider_123" }),
    "resume",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts
```

Expected: FAIL because the helper still returns `launch` for `ready + providerSessionId`, treats `null` as queued instead of runtime, and returns `none` for `interrupted + providerSessionId`.

- [ ] **Step 3: Update the helper and wire it into `useSessionRunnerController`**

First, replace the helper with this final version in `apps/desktop/src/hooks/createPageDaemonState.ts`:

```ts
export type CreatePageDaemonState =
  | "draft"
  | "preparing_workspace"
  | "preparing_worktree"
  | "ready"
  | "launching"
  | "running"
  | "waiting_input"
  | "approval_required"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived"
  | null;

export type CreatePageUiStatus = "idle" | "running" | "waiting" | "suspended" | "done" | "error";
export type CreatePagePhase = "compose" | "queued" | "runtime" | "inactive";
export type SubmitAction = "bootstrap_then_launch" | "launch" | "resume" | "send_input" | "none";

export interface CreatePageFlags {
  phase: CreatePagePhase;
  canSwitchRunner: boolean;
  shouldShowComposer: boolean;
  waitingForPtyLaunch: boolean;
}

export interface DeriveCreatePageFlagsInput {
  daemonState: CreatePageDaemonState;
  providerSessionId?: string | null;
  querySent: boolean;
  uiStatus?: CreatePageUiStatus;
}

export interface ResolveSubmitActionInput {
  daemonState: CreatePageDaemonState;
  providerSessionId?: string | null;
  uiStatus?: CreatePageUiStatus;
}

const BOOTSTRAP_STATES = new Set<CreatePageDaemonState>([
  "draft",
  "preparing_workspace",
  "preparing_worktree",
]);

const RUNTIME_STATES = new Set<CreatePageDaemonState>([
  "running",
  "waiting_input",
  "approval_required",
  "interrupted",
]);

const FINISHED_STATES = new Set<CreatePageDaemonState>([
  "completed",
  "failed",
  "cancelled",
  "archived",
]);

function hasProviderSessionId(providerSessionId?: string | null) {
  return !!providerSessionId?.trim();
}

function isRuntimeUiStatus(uiStatus?: CreatePageUiStatus) {
  return uiStatus === "running" || uiStatus === "waiting" || uiStatus === "suspended";
}

export function deriveCreatePageFlags(input: DeriveCreatePageFlagsInput): CreatePageFlags {
  const { daemonState, providerSessionId, querySent, uiStatus = "idle" } = input;

  if (RUNTIME_STATES.has(daemonState)) {
    return {
      phase: "runtime",
      canSwitchRunner: false,
      shouldShowComposer: false,
      waitingForPtyLaunch: false,
    };
  }

  if (FINISHED_STATES.has(daemonState)) {
    return {
      phase: "inactive",
      canSwitchRunner: false,
      shouldShowComposer: false,
      waitingForPtyLaunch: false,
    };
  }

  if (daemonState === "launching") {
    return {
      phase: "queued",
      canSwitchRunner: false,
      shouldShowComposer: true,
      waitingForPtyLaunch: true,
    };
  }

  if (daemonState === null) {
    if (hasProviderSessionId(providerSessionId) || isRuntimeUiStatus(uiStatus)) {
      return {
        phase: "runtime",
        canSwitchRunner: false,
        shouldShowComposer: false,
        waitingForPtyLaunch: false,
      };
    }

    return querySent
      ? {
          phase: "queued",
          canSwitchRunner: false,
          shouldShowComposer: true,
          waitingForPtyLaunch: true,
        }
      : {
          phase: "compose",
          canSwitchRunner: true,
          shouldShowComposer: true,
          waitingForPtyLaunch: false,
        };
  }

  if (daemonState === "ready" || BOOTSTRAP_STATES.has(daemonState)) {
    return querySent
      ? {
          phase: "queued",
          canSwitchRunner: false,
          shouldShowComposer: true,
          waitingForPtyLaunch: true,
        }
      : {
          phase: "compose",
          canSwitchRunner: true,
          shouldShowComposer: true,
          waitingForPtyLaunch: false,
        };
  }

  return {
    phase: "inactive",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  };
}

export function resolveSubmitAction(input: ResolveSubmitActionInput): SubmitAction {
  const { daemonState, providerSessionId, uiStatus = "idle" } = input;

  if (daemonState === "running" || daemonState === "waiting_input") {
    return "send_input";
  }

  if (daemonState === "ready") {
    return hasProviderSessionId(providerSessionId) ? "resume" : "launch";
  }

  if (daemonState === "approval_required" || daemonState === "interrupted") {
    return hasProviderSessionId(providerSessionId) ? "resume" : "launch";
  }

  if (BOOTSTRAP_STATES.has(daemonState)) {
    return "bootstrap_then_launch";
  }

  if (daemonState === null) {
    if (hasProviderSessionId(providerSessionId)) return "resume";
    if (isRuntimeUiStatus(uiStatus)) return "send_input";
    return "bootstrap_then_launch";
  }

  return "none";
}
```

Then update `apps/desktop/src/hooks/useSessionRunnerController.ts` as follows:

1. Add the helper import next to the existing service imports:

```ts
import {
  deriveCreatePageFlags,
  resolveSubmitAction,
} from "./createPageDaemonState";
```

2. Replace the current `isBootstrapSession` block with daemon-derived flags:

```ts
  const currentEntity = session;
  const daemonSession = (session ? daemon.state.sessionsById[session.id] : null) as DaemonSession | null;
  const sessionLifecycleState = daemonSession?.state ?? null;
  const runner = currentEntity ? currentEntity.runner : settings.runner;
  const supportsPromptLaunch = runner.type === "claude-code" || runner.type === "codex";
  const canUseRuntime = !("__TAURI_INTERNALS__" in window) || !!session?.taskId;
  const boundResumeSessionId = supportsPromptLaunch ? (session?.providerSessionId?.trim() ?? "") : "";
  const createPageFlags = deriveCreatePageFlags({
    daemonState: sessionLifecycleState,
    providerSessionId: session?.providerSessionId,
    querySent,
    uiStatus: session?.status ?? "idle",
  });
  const canSwitchRunner = createPageFlags.canSwitchRunner;
  const shouldShowComposer = createPageFlags.shouldShowComposer;
  const waitingForPtyLaunch = createPageFlags.waitingForPtyLaunch;
  const resumeSessionId = supportsPromptLaunch
    ? (ptyEverActive ? launchResumeSessionId : boundResumeSessionId)
    : "";
  const isResumeLaunch = resumeSessionId.length > 0;
  const showRuntimeSurface = querySent && ptyEverActive;
  const runnerBadge = getRunnerBadge(runner.type);
  const installCmd = getRunnerInstallCommand(runner.type);
```

3. In `handlePtyReady`, replace the launch branch so the daemon decides whether to bootstrap, launch, resume, or just accept input:

```ts
  const handlePtyReady = useCallback(() => {
    ptyReadyRef.current = true;
    if (launchAttemptRef.current || !sessionIdRef.current) return;
    launchAttemptRef.current = true;
    const currentSessionId = sessionIdRef.current;
    const currentSession = useSessionStore.getState().sessions.find((item) => item.id === currentSessionId);
    const liveDaemonState = daemon.state.sessionsById[currentSessionId]?.state ?? null;

    if (!("__TAURI_INTERNALS__" in window) || !currentSession?.taskId) {
      if (isWindows) {
        clearPendingQueryTimer();
        pendingQueryTimerRef.current = window.setTimeout(() => {
          pendingQueryTimerRef.current = null;
          flushPendingQuery(0);
        }, 4000);
        return;
      }
      flushPendingQuery(200);
      return;
    }

    const submitAction = resolveSubmitAction({
      daemonState: liveDaemonState,
      providerSessionId: currentSession.providerSessionId,
      uiStatus: currentSession.status,
    });

    let launchPromise: Promise<unknown> | null = null;
    if (submitAction === "bootstrap_then_launch") {
      launchPromise = bootstrapDaemonSession({ sessionId: currentSessionId, strategy: "new_managed" })
        .then(() => launchDaemonSession(currentSessionId));
    } else if (submitAction === "launch") {
      launchPromise = launchDaemonSession(currentSessionId);
    } else if (submitAction === "resume") {
      launchPromise = resumeDaemonSession(currentSessionId);
    }

    if (!launchPromise) {
      launchAttemptRef.current = false;
      flushPendingQuery(isWindows ? 120 : 0);
      return;
    }

    void launchPromise
      .then(() => {
        if (isWindows) {
          clearPendingQueryTimer();
          pendingQueryTimerRef.current = window.setTimeout(() => {
            pendingQueryTimerRef.current = null;
            flushPendingQuery(0);
          }, 4000);
          return;
        }
        flushPendingQuery(200);
      })
      .catch((error) => {
        launchAttemptRef.current = false;
        ptyReadyRef.current = false;
        setQuerySent(false);
        setLaunchPrompt(null);
        pendingQueryRef.current = null;
        void recordDaemonRuntimeLifecycle(
          currentSessionId,
          "error",
          error instanceof Error ? error.message : String(error),
        ).catch(() => {});
      });
  }, [clearPendingQueryTimer, daemon.state.sessionsById, flushPendingQuery, isWindows]);
```

4. In `handleSubmitQuery`, make daemon state choose the path instead of `isBootstrapSession`:

```ts
  const handleSubmitQuery = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !currentEntity) return;
    lastQuerySentAtRef.current = Date.now();
    pendingQueryRef.current = trimmed;
    setPendingQuery(trimmed);
    setQuerySent(true);

    const nextTitle = currentEntity.name?.trim() || trimmed.slice(0, 48);

    if (session?.taskId) {
      void updateDaemonTask({
        taskId: session.taskId,
        title: nextTitle,
        prompt: trimmed,
      }).catch(() => {});

      const submitAction = resolveSubmitAction({
        daemonState: sessionLifecycleState,
        providerSessionId: session.providerSessionId,
        uiStatus: session.status,
      });

      if (submitAction === "send_input") {
        if (ptyReadyRef.current) {
          flushPendingQuery(isWindows ? 120 : 100);
        }
        return;
      }

      if (supportsPromptLaunch && !ptyEverActive) {
        setLaunchPrompt(trimmed);
      }
      return;
    }

    if (!("__TAURI_INTERNALS__" in window)) {
      if (ptyReadyRef.current) {
        flushPendingQuery(isWindows ? 120 : 100);
      } else if (supportsPromptLaunch && !ptyEverActive) {
        setLaunchPrompt(trimmed);
      }
      return;
    }

    setQuerySent(false);
    pendingQueryRef.current = null;
  }, [
    currentEntity,
    flushPendingQuery,
    isWindows,
    ptyEverActive,
    session,
    sessionLifecycleState,
    supportsPromptLaunch,
  ]);
```

5. In `handleSwitchRunner`, gate on `canSwitchRunner` and clear only UI bridge state:

```ts
  const handleSwitchRunner = useCallback(async (type: RunnerType) => {
    if (!session) return;
    if (!canSwitchRunner || session.runner.type === type) return;

    const provider = type === "codex" ? "codex" : "claude";
    const nextRunner = useSettingsStore.getState().getRunnerConfigForType(type);

    await updateDaemonSession({ sessionId: session.id, provider }).catch(() => {});

    if (session.taskId) {
      await updateDaemonTask({ taskId: session.taskId, title: session.name }).catch(() => {});
    }

    useSessionStore.getState().updateSession(session.id, {
      runner: { ...nextRunner },
      providerSessionId: undefined,
    });
    patchRunner({ type });
    setLaunchResumeSessionId("");
    setLaunchPrompt(null);
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    launchAttemptRef.current = false;
    pendingQueryRef.current = null;
    await daemon.refreshSessionViews(session.id).catch(() => {});
  }, [canSwitchRunner, clearPendingQueryTimer, daemon, patchRunner, session]);
```

6. In the `useEffect` blocks and return value, expose the new controller-owned booleans:

```ts
  useEffect(() => {
    if (isOpen && shouldShowComposer) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, shouldShowComposer]);

  useEffect(() => {
    if (querySent && canUseRuntime && (worktreeReady || isResumeLaunch || sessionLifecycleState === "launching")) {
      if (!ptyEverActive) {
        setPtyEverActive(true);
      }
    }
  }, [canUseRuntime, isResumeLaunch, ptyEverActive, querySent, sessionLifecycleState, worktreeReady]);

  return {
    session,
    runner,
    runnerBadge,
    queryInputRef,
    pendingQuery,
    setPendingQuery,
    querySent,
    setQuerySent,
    installing,
    setInstalling,
    installId,
    launchPrompt,
    ptyEverActive,
    cliAvailable,
    recheckCli,
    handlePtyReady,
    handlePtyWaiting,
    handlePtyRunning,
    handlePtyError,
    handleSubmitQuery,
    handleInstall,
    handleSwitchRunner,
    supportsPromptLaunch,
    boundResumeSessionId,
    resumeSessionId,
    isResumeLaunch,
    cliCommand,
    installCmd,
    canSwitchRunner,
    shouldShowComposer,
    waitingForPtyLaunch,
    showRuntimeSurface,
    contextEnv: buildContextEnv(),
  };
```

- [ ] **Step 4: Run the tests and typecheck**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit
```

Expected:
- the Node test runner reports all tests PASS
- `tsc --noEmit` exits cleanly with no diagnostics

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/createPageDaemonState.ts apps/desktop/src/hooks/createPageDaemonState.test.ts apps/desktop/src/hooks/useSessionRunnerController.ts
git commit -m "fix: align create-page launch flow with daemon state"
```

### Task 3: Remove view-level heuristics and verify the desktop flow

**Files:**
- Modify: `apps/desktop/src/components/SessionDetail.tsx:177-203,231-238,379-425`
- Modify: `apps/desktop/src/components/session/SessionRunnerSurface.tsx:10-31,102-125`
- Modify: `apps/desktop/src/components/session/SessionPromptComposer.tsx:4-33,93-133,190-197`
- Test: `apps/desktop/src/hooks/createPageDaemonState.test.ts`

- [ ] **Step 1: Add the final view-facing regression tests**

Append these tests to `apps/desktop/src/hooks/createPageDaemonState.test.ts`:

```ts
test("draft sessions with a submitted first prompt stay queued until runtime takes over", () => {
  const flags = deriveCreatePageFlags({
    daemonState: "draft",
    providerSessionId: "",
    querySent: true,
  });

  assert.deepEqual(flags, {
    phase: "queued",
    canSwitchRunner: false,
    shouldShowComposer: true,
    waitingForPtyLaunch: true,
  });
});

test("completed sessions do not reopen the composer", () => {
  const flags = deriveCreatePageFlags({
    daemonState: "completed",
    providerSessionId: "provider_123",
    querySent: true,
  });

  assert.deepEqual(flags, {
    phase: "inactive",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails if the helper or view assumptions regress**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts
```

Expected: If Task 2 is implemented exactly, this should already PASS. If it fails, fix `apps/desktop/src/hooks/createPageDaemonState.ts` before touching the view. Do **not** continue with view edits while helper regressions remain.

- [ ] **Step 3: Update the session detail views to consume controller flags**

In `apps/desktop/src/components/session/SessionRunnerSurface.tsx`, replace the local visibility contract:

```ts
interface SessionRunnerSurfaceProps {
  isGlass: boolean;
  isOpen: boolean;
  installing: boolean;
  installId: string;
  installCmd?: string;
  recheckCli: () => void;
  runtimeVisible: boolean;
  sessionId: string;
  cliCommand: string;
  cliBaseArgs: string[];
  workdir: string;
  launchPrompt: string | null;
  supportsPromptLaunch: boolean;
  handlePtyReady: () => void;
  handlePtyWaiting: () => void;
  handlePtyRunning: () => void;
  handlePtyError: (error: string) => void;
  contextEnv: [string, string][];
  InstallTerminal: (props: InstallTerminalProps) => React.ReactNode;
}
```

and change the runtime terminal container to:

```ts
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          padding: isGlass ? 0 : "8px 4px 4px",
          opacity: runtimeVisible ? 1 : 0,
          pointerEvents: runtimeVisible ? "auto" : "none",
        }}
      >
        <PtyTerminal
          sessionId={sessionId}
          command={cliCommand}
          args={cliBaseArgs}
          workdir={workdir}
          active={isOpen && runtimeVisible}
          initialPrompt={launchPrompt}
          supportsPromptArg={supportsPromptLaunch}
          onReady={handlePtyReady}
          onWaiting={handlePtyWaiting}
          onRunning={handlePtyRunning}
          onError={handlePtyError}
          env={contextEnv}
          enableWindowsCtrlCv
        />
      </div>
```

In `apps/desktop/src/components/session/SessionPromptComposer.tsx`, change the props and runner-chip gate:

```ts
export function SessionPromptComposer({
  pendingQuery,
  setPendingQuery,
  queryInputRef,
  waitingForPtyLaunch,
  runnerType,
  runnerBadge,
  cliAvailable,
  cliCommand,
  installCmd,
  isGlass,
  launchDisabled,
  canSwitchRunner,
  handleSwitchRunner,
  handleInstall,
}: {
  pendingQuery: string;
  setPendingQuery: (value: string) => void;
  queryInputRef: React.RefObject<HTMLTextAreaElement | null>;
  waitingForPtyLaunch: boolean;
  runnerType: RunnerType;
  runnerBadge: string;
  cliAvailable: boolean | null;
  cliCommand: string;
  installCmd?: string;
  isGlass: boolean;
  launchDisabled: boolean;
  canSwitchRunner: boolean;
  handleSwitchRunner: (type: RunnerType) => Promise<void> | void;
  handleInstall: () => void;
}) {
```

and:

```tsx
        {canSwitchRunner && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {(Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(([type, label]) => {
              const active = runnerType === type;
              return (
                <button
                  key={type}
                  onClick={() => handleSwitchRunner(type)}
                  disabled={launchDisabled}
                  style={{
                    fontSize: 10,
                    padding: "3px 10px",
                    borderRadius: 99,
                    background: active ? "var(--ci-accent-bg)" : actionButtonBackground,
                    border: active ? "1px solid var(--ci-accent-bdr)" : actionButtonBorder,
                    color: active ? "var(--ci-accent)" : actionButtonText,
                    cursor: launchDisabled ? "default" : "pointer",
                    transition: "all 0.15s",
                    fontWeight: active ? 600 : 400,
                    opacity: launchDisabled ? 0.7 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
```

In `apps/desktop/src/components/SessionDetail.tsx`, stop recomputing `waitingForPtyLaunch` locally and consume the controller flags:

```ts
  const {
    session,
    runnerBadge,
    queryInputRef,
    pendingQuery,
    setPendingQuery,
    installing,
    setInstalling,
    installId,
    launchPrompt,
    cliAvailable,
    recheckCli,
    handlePtyReady,
    handlePtyWaiting,
    handlePtyRunning,
    handlePtyError,
    handleInstall,
    handleSwitchRunner,
    supportsPromptLaunch,
    resumeSessionId,
    cliCommand,
    installCmd,
    canSwitchRunner,
    shouldShowComposer,
    waitingForPtyLaunch,
    showRuntimeSurface,
    contextEnv,
  } = useSessionRunnerController({ sessionId, isOpen });
```

```ts
  useEffect(() => {
    if (isOpen && shouldShowComposer) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, queryInputRef, shouldShowComposer]);
```

```tsx
        <SessionRunnerSurface
          isGlass={isGlass}
          isOpen={isOpen}
          installing={installing}
          installId={installId}
          installCmd={installCmd}
          recheckCli={recheckCli}
          runtimeVisible={showRuntimeSurface}
          sessionId={sessionId}
          cliCommand={cliCommand}
          cliBaseArgs={cliBaseArgs}
          workdir={effectiveWorkdir}
          launchPrompt={launchPrompt}
          supportsPromptLaunch={supportsPromptLaunch}
          handlePtyReady={handlePtyReady}
          handlePtyWaiting={handlePtyWaiting}
          handlePtyRunning={handlePtyRunning}
          handlePtyError={handlePtyError}
          contextEnv={contextEnv}
          InstallTerminal={InstallTerminal}
        />

        <motion.div
          initial={false}
          animate={shouldShowComposer && !installing
            ? { opacity: 1, scale: 1 }
            : { opacity: 0, scale: 0.96, pointerEvents: "none" as const }}
          transition={{ duration: 0.18 }}
          style={{ position: "absolute", inset: 0 }}
        >
          {shouldShowComposer && !installing && (
            <SessionPromptComposer
              pendingQuery={pendingQuery}
              setPendingQuery={setPendingQuery}
              queryInputRef={queryInputRef}
              waitingForPtyLaunch={waitingForPtyLaunch}
              runnerType={session.runner.type}
              runnerBadge={runnerBadge}
              cliAvailable={cliAvailable}
              cliCommand={cliCommand}
              installCmd={installCmd}
              isGlass={isGlass}
              launchDisabled={waitingForPtyLaunch}
              canSwitchRunner={canSwitchRunner}
              handleSwitchRunner={handleSwitchRunner}
              handleInstall={handleInstall}
            />
          )}
        </motion.div>
```

- [ ] **Step 4: Run automated verification**

Run:

```bash
node --experimental-strip-types --test apps/desktop/src/hooks/createPageDaemonState.test.ts && pnpm --filter @codebar/desktop exec tsc --noEmit && pnpm --filter @codebar/desktop build
```

Expected:
- Node tests PASS
- `tsc --noEmit` exits with no errors
- Vite build completes successfully for `@codebar/desktop`

- [ ] **Step 5: Run the desktop app and verify the bug manually**

Run:

```bash
pnpm tauri:dev:worktree
```

Expected: the Tauri desktop window opens without a runtime exception.

Manual verification checklist:

```md
- [ ] Open a fresh session from the welcome screen or session list.
- [ ] Confirm the create-page runner chips are clickable before the first submit.
- [ ] Switch `Claude Code -> Codex -> Claude Code` and confirm the header badge tracks the selected runner.
- [ ] Enter `Summarize this repository in one sentence` and press Enter once.
- [ ] Confirm the overlay shows a queued/read-only state, then hands off to the runtime surface without requiring a second Enter.
- [ ] Confirm the first prompt appears in the CLI session immediately after launch.
- [ ] Once the session reaches running or waiting, confirm runner chips are no longer visible/clickable.
- [ ] If both CLIs are installed locally, repeat the same flow once with the other runner.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/SessionDetail.tsx apps/desktop/src/components/session/SessionRunnerSurface.tsx apps/desktop/src/components/session/SessionPromptComposer.tsx
git commit -m "fix: drive create-page session UI from daemon state"
```

## Spec coverage check

- **Daemon as single source of truth:** Task 1 creates the helper; Task 2 wires controller launch/switch behavior to daemon-derived flags.
- **Restrict local state to UI bridge concerns:** Task 2 keeps `querySent`, `ptyEverActive`, and `launchPrompt` but removes them from business decisions.
- **Runner switching only in pre-runtime:** Task 2 gates `handleSwitchRunner` with `canSwitchRunner`; Task 3 only renders chips when that flag is true.
- **First-query daemon-driven dispatch:** Task 2 routes to `bootstrap_then_launch`, `launch`, `resume`, or `send_input`.
- **Overlay/runtime handoff from daemon state:** Task 3 removes `SessionDetail.tsx`’s raw `providerSessionId` heuristic and consumes controller flags.
- **Verification:** Tasks 1-3 add unit regressions, typecheck/build, and a manual Tauri verification pass.
