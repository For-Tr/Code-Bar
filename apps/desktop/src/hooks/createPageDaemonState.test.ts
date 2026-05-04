// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import {
  deriveCreatePageFlags,
  deriveRuntimeSurfaceState,
  deriveRuntimeSurfaceVisibility,
  deriveSessionBridgeState,
  deriveSubmittedQueryState,
  isRuntimeUiStatus,
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

test("draft sessions with a sent query stay queued until runtime takes over", () => {
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

test("completed sessions with a bound provider stay inactive after the query was sent", () => {
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

test("ready sessions with a bound provider resume instead of launching a fresh session", () => {
  assert.equal(
    resolveSubmitAction({ daemonState: "ready", providerSessionId: "provider_123" }),
    "resume",
  );
});

test("runtime UI status includes running waiting and suspended", () => {
  assert.equal(isRuntimeUiStatus("running"), true);
  assert.equal(isRuntimeUiStatus("waiting"), true);
  assert.equal(isRuntimeUiStatus("suspended"), true);
  assert.equal(isRuntimeUiStatus("idle"), false);
  assert.equal(isRuntimeUiStatus("done"), false);
  assert.equal(isRuntimeUiStatus("error"), false);
});

test("missing daemon state falls back to runtime when a native resume binding already exists", () => {
  const flags = deriveCreatePageFlags({
    daemonState: null,
    providerSessionId: "provider_123",
    querySent: true,
    uiStatus: "idle",
  });

  assert.deepEqual(flags, {
    phase: "runtime",
    canSwitchRunner: false,
    shouldShowComposer: false,
    waitingForPtyLaunch: false,
  });
});

test("missing daemon state stays queued after submit when runtime status is absent", () => {
  const flags = deriveCreatePageFlags({
    daemonState: null,
    providerSessionId: "",
    querySent: true,
    uiStatus: "idle",
  });

  assert.deepEqual(flags, {
    phase: "queued",
    canSwitchRunner: false,
    shouldShowComposer: true,
    waitingForPtyLaunch: true,
  });
});

test("missing daemon state enters runtime when UI status is already waiting", () => {
  const flags = deriveCreatePageFlags({
    daemonState: null,
    providerSessionId: "",
    querySent: true,
    uiStatus: "waiting",
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

test("session bridge state resets to false for a fresh compose session", () => {
  assert.equal(
    deriveSessionBridgeState({
      sessionStarted: false,
      canUseRuntime: true,
      worktreeReady: false,
      isResumeLaunch: false,
      persistedResumeSessionId: "",
    }),
    false,
  );
});

test("session bridge state stays active for resumed sessions with an existing binding", () => {
  assert.equal(
    deriveSessionBridgeState({
      sessionStarted: true,
      canUseRuntime: true,
      worktreeReady: false,
      isResumeLaunch: true,
      persistedResumeSessionId: "provider_123",
    }),
    true,
  );
});

test("runtime surface stays visible for finished sessions once the bridge was active", () => {
  assert.equal(
    deriveRuntimeSurfaceVisibility({
      runtimeBridgeActive: true,
      canUseRuntime: true,
      worktreeReady: false,
      isResumeLaunch: false,
    }),
    true,
  );
});

test("runtime surface stays hidden for finished sessions when the bridge never activated", () => {
  assert.equal(
    deriveRuntimeSurfaceVisibility({
      runtimeBridgeActive: false,
      canUseRuntime: true,
      worktreeReady: false,
      isResumeLaunch: false,
    }),
    false,
  );
});

test("submitted query for launch clears composer draft without queueing duplicate runtime input", () => {
  assert.deepEqual(
    deriveSubmittedQueryState("hi", "bootstrap_then_launch"),
    {
      transportQuery: null,
      composerDraft: "",
    },
  );
});

test("submitted query for runtime send keeps transport text and clears composer draft", () => {
  assert.deepEqual(
    deriveSubmittedQueryState("hi", "send_input"),
    {
      transportQuery: "hi",
      composerDraft: "",
    },
  );
});

test("queued runtime stays active but hidden while waiting for PTY launch", () => {
  assert.deepEqual(
    deriveRuntimeSurfaceState({
      runtimeBridgeActive: true,
      canUseRuntime: true,
      waitingForPtyLaunch: true,
    }),
    {
      active: true,
      visible: false,
    },
  );
});

test("runtime becomes visible after queued launch handoff completes", () => {
  assert.deepEqual(
    deriveRuntimeSurfaceState({
      runtimeBridgeActive: true,
      canUseRuntime: true,
      waitingForPtyLaunch: false,
    }),
    {
      active: true,
      visible: true,
    },
  );
});
