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

export interface DeriveSessionBridgeStateInput {
  sessionStarted: boolean;
  canUseRuntime: boolean;
  worktreeReady: boolean;
  isResumeLaunch: boolean;
  persistedResumeSessionId?: string | null;
}

export interface DeriveRuntimeSurfaceVisibilityInput {
  runtimeBridgeActive: boolean;
  canUseRuntime: boolean;
  worktreeReady: boolean;
  isResumeLaunch: boolean;
}

export interface DeriveRuntimeSurfaceStateInput {
  runtimeBridgeActive: boolean;
  canUseRuntime: boolean;
  waitingForPtyLaunch: boolean;
}

export interface SubmittedQueryState {
  transportQuery: string | null;
  composerDraft: string;
}

export interface RuntimeSurfaceState {
  active: boolean;
  visible: boolean;
}

const BOOTSTRAP_STATES = new Set<CreatePageDaemonState>([
  "draft",
  "preparing_workspace",
  "preparing_worktree",
]);

export const FINISHED_STATES = new Set<CreatePageDaemonState>([
  "completed",
  "failed",
  "cancelled",
  "archived",
]);

const RUNTIME_STATES = new Set<CreatePageDaemonState>([
  "running",
  "waiting_input",
  "approval_required",
  "interrupted",
]);

export function hasProviderSessionId(providerSessionId?: string | null): boolean {
  return !!providerSessionId?.trim();
}

export function isRuntimeUiStatus(status?: CreatePageUiStatus): boolean {
  return status === "running" || status === "waiting" || status === "suspended";
}

export function deriveCreatePageFlags(input: DeriveCreatePageFlagsInput): CreatePageFlags {
  const { daemonState, providerSessionId, querySent, uiStatus } = input;
  const hasProvider = hasProviderSessionId(providerSessionId);
  const runtimeUiStatus = isRuntimeUiStatus(uiStatus);

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
    if (hasProvider || runtimeUiStatus) {
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

export function deriveSessionBridgeState(input: DeriveSessionBridgeStateInput): boolean {
  const {
    sessionStarted,
    canUseRuntime,
    worktreeReady,
    isResumeLaunch,
    persistedResumeSessionId,
  } = input;

  if (!sessionStarted) return false;
  if (!canUseRuntime) return false;
  if (worktreeReady || isResumeLaunch) return true;
  return !!persistedResumeSessionId?.trim();
}

export function deriveRuntimeSurfaceVisibility(input: DeriveRuntimeSurfaceVisibilityInput): boolean {
  const { runtimeBridgeActive, canUseRuntime, worktreeReady, isResumeLaunch } = input;

  if (!runtimeBridgeActive) return false;
  if (!canUseRuntime) return false;
  return worktreeReady || isResumeLaunch || runtimeBridgeActive;
}

export function deriveSubmittedQueryState(query: string, submitAction: SubmitAction): SubmittedQueryState {
  return {
    transportQuery: submitAction === "send_input" ? query : null,
    composerDraft: "",
  };
}

export function deriveRuntimeSurfaceState(input: DeriveRuntimeSurfaceStateInput): RuntimeSurfaceState {
  const { runtimeBridgeActive, canUseRuntime, waitingForPtyLaunch } = input;

  return {
    active: runtimeBridgeActive && canUseRuntime,
    visible: runtimeBridgeActive && canUseRuntime && !waitingForPtyLaunch,
  };
}

export function resolveSubmitAction(input: ResolveSubmitActionInput): SubmitAction {
  const { daemonState, providerSessionId, uiStatus } = input;
  const hasProvider = hasProviderSessionId(providerSessionId);
  const runtimeUiStatus = isRuntimeUiStatus(uiStatus);

  if (daemonState === "running" || daemonState === "waiting_input") {
    return "send_input";
  }

  if (daemonState === "ready") {
    return hasProvider ? "resume" : "launch";
  }

  if (daemonState === "approval_required" || daemonState === "interrupted") {
    return hasProvider ? "resume" : "launch";
  }

  if (BOOTSTRAP_STATES.has(daemonState)) {
    return "bootstrap_then_launch";
  }

  if (daemonState === null) {
    if (hasProvider) {
      return "resume";
    }
    return runtimeUiStatus ? "send_input" : "bootstrap_then_launch";
  }

  return "none";
}
