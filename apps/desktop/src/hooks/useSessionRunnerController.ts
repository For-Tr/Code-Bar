import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session as DaemonSession } from "@codebar/contracts";
import { useAppI18n } from "../i18n";
import { useDaemonData } from "../daemon/DaemonDataProvider";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, type RunnerType } from "../store/settingsStore";
import {
  deriveCreatePageFlags,
  deriveRuntimeSurfaceState,
  deriveSessionBridgeState,
  deriveSubmittedQueryState,
  resolveSubmitAction,
} from "./createPageDaemonState";
import {
  buildRunnerContextEnv,
  checkRunnerAvailability,
  getRunnerBadge,
  getRunnerCliCommand,
  getRunnerInstallCommand,
  hasNativeResumeBinding,
} from "../services/runnerCommands";
import {
  bootstrapDaemonSession,
  launchDaemonSession,
  recordDaemonRuntimeLifecycle,
  resumeDaemonSession,
  sendDaemonSessionInput,
  updateDaemonSession,
  updateDaemonTask,
} from "../services/daemonCommands";
import { useWorkflowExecutionStore } from "../store/workflowExecutionStore";

export function useSessionRunnerController({
  sessionId,
  isOpen,
}: {
  sessionId: string;
  isOpen: boolean;
}) {
  const { t } = useAppI18n();
  const daemon = useDaemonData();
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const worktreeReady = useSessionStore((s) => s.worktreeReadyIds.has(sessionId));
  const pendingExecutionIntent = useWorkflowExecutionStore((s) => s.pendingIntentBySessionId[sessionId] ?? null);
  const beginWorkflowExecutionDispatch = useWorkflowExecutionStore((s) => s.beginDispatch);
  const markWorkflowExecutionSent = useWorkflowExecutionStore((s) => s.markSent);
  const { settings, patchRunner } = useSettingsStore();

  const [pendingQuery, setPendingQuery] = useState("");
  const [querySent, setQuerySent] = useState(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    return !!s && ((s.status === "running" || s.status === "waiting" || s.status === "suspended") || hasNativeResumeBinding(s));
  });
  const queryInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingQueryForInputRef = useRef("");

  const [installing, setInstalling] = useState(false);
  const installCountRef = useRef(0);
  const [installId, setInstallId] = useState("");
  const [launchPrompt, setLaunchPrompt] = useState<string | null>(null);
  const [ptyEverActive, setPtyEverActive] = useState(false);
  const [launchResumeSessionId, setLaunchResumeSessionId] = useState("");
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);

  const ptyReadyRef = useRef(false);
  const launchAttemptRef = useRef(false);
  const lastQuerySentAtRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const pendingQueryRef = useRef<string | null>(null);
  const pendingQueryTimerRef = useRef<number | null>(null);

  const currentEntity = session;
  const daemonSession = (session ? daemon.state.sessionsById[session.id] : null) as DaemonSession | null;
  const sessionLifecycleState = daemonSession?.state ?? null;
  const runner = currentEntity ? currentEntity.runner : settings.runner;
  const supportsPromptLaunch = runner.type === "claude-code" || runner.type === "codex";
  const canUseRuntime = !("__TAURI_INTERNALS__" in window) || !!session?.taskId;
   const daemonFlags = deriveCreatePageFlags({
    daemonState: sessionLifecycleState,
    providerSessionId: session?.providerSessionId,
    querySent,
    uiStatus: session?.status ?? "idle",
  });
  const canSwitchRunner = daemonFlags.canSwitchRunner;
  const shouldShowComposer = daemonFlags.shouldShowComposer;
  const waitingForPtyLaunch = daemonFlags.waitingForPtyLaunch;
  const boundResumeSessionId = supportsPromptLaunch ? (session?.providerSessionId?.trim() ?? "") : "";
  const resumeSessionId = supportsPromptLaunch
    ? (ptyEverActive ? launchResumeSessionId : boundResumeSessionId)
    : "";
  const isResumeLaunch = resumeSessionId.length > 0;
  const runtimeSurfaceState = deriveRuntimeSurfaceState({
    runtimeBridgeActive: ptyEverActive,
    canUseRuntime,
    waitingForPtyLaunch,
  });
  const showRuntimeSurface = runtimeSurfaceState.visible;
  const runnerBadge = getRunnerBadge(runner.type);
  const installCmd = getRunnerInstallCommand(runner.type);

  const clearPendingQueryTimer = useCallback(() => {
    if (pendingQueryTimerRef.current !== null) {
      window.clearTimeout(pendingQueryTimerRef.current);
      pendingQueryTimerRef.current = null;
    }
  }, []);

  const flushPendingQuery = useCallback((delay = 0) => {
    if (!ptyReadyRef.current) return false;
    const queued = pendingQueryRef.current?.trim();
    if (!queued) return false;

    clearPendingQueryTimer();

    const send = () => {
      const query = pendingQueryRef.current?.trim();
      if (!query || !ptyReadyRef.current) return;
      sendDaemonSessionInput(sessionIdRef.current, query)
        .then(() => {
          if (pendingQueryRef.current?.trim() === query) {
            pendingQueryRef.current = null;
          }
          setLaunchPrompt(null);
        })
        .catch(() => {
          pendingQueryTimerRef.current = window.setTimeout(() => {
            pendingQueryTimerRef.current = null;
            flushPendingQuery(isWindows ? 1200 : 300);
          }, isWindows ? 1200 : 300);
        });
    };

    if (delay > 0) {
      pendingQueryTimerRef.current = window.setTimeout(() => {
        pendingQueryTimerRef.current = null;
        send();
      }, delay);
      return true;
    }

    send();
    return true;
  }, [clearPendingQueryTimer, isWindows]);

  const handlePtyReady = useCallback(() => {
    ptyReadyRef.current = true;
    if (launchAttemptRef.current || !sessionIdRef.current) return;
    launchAttemptRef.current = true;
    const currentSessionId = sessionIdRef.current;
    const currentSession = useSessionStore.getState().sessions.find((item) => item.id === currentSessionId);

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

    const currentDaemonSession = daemon.state.sessionsById[currentSessionId] as DaemonSession | null | undefined;
    const submitAction = resolveSubmitAction({
      daemonState: currentDaemonSession?.state ?? null,
      providerSessionId: currentSession.providerSessionId,
      uiStatus: currentSession.status,
    });

    const launch = submitAction === "bootstrap_then_launch"
      ? bootstrapDaemonSession({ sessionId: currentSessionId, strategy: "new_managed" }).then(() => launchDaemonSession(currentSessionId))
      : submitAction === "launch"
      ? launchDaemonSession(currentSessionId)
      : submitAction === "resume"
      ? resumeDaemonSession(currentSessionId)
      : null;

    if (!launch) {
      launchAttemptRef.current = false;
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

    void launch
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
        clearPendingQueryTimer();
        pendingQueryRef.current = null;
        void recordDaemonRuntimeLifecycle(currentSessionId, "error", error instanceof Error ? error.message : String(error)).catch(() => {});
      });
  }, [clearPendingQueryTimer, daemon.state.sessionsById, flushPendingQuery, isWindows, querySent]);

  const handlePtyWaiting = useCallback(() => {
    const sid = sessionIdRef.current;
    const s = useSessionStore.getState().sessions.find((x) => x.id === sid);
    flushPendingQuery(isWindows ? 120 : 0);
    if (s?.status === "waiting") return;
    void recordDaemonRuntimeLifecycle(sid, "waiting").catch(() => {});
    const taskName = s?.currentTask?.slice(0, 40) || t("session.genericTask");
    invoke("send_notification", {
      title: t("notifications.codeBarTitle"),
      body: t("session.waitingNextStepNotification", { task: taskName }),
      sessionId: sid,
    }).catch(() => {});
  }, [flushPendingQuery, isWindows, t]);

  const handlePtyRunning = useCallback(() => {
    const sid = sessionIdRef.current;
    void recordDaemonRuntimeLifecycle(sid, "running").catch(() => {});
  }, []);

  const handlePtyError = useCallback((error: string) => {
    const sid = sessionIdRef.current;
    launchAttemptRef.current = false;
    ptyReadyRef.current = false;
    setQuerySent(false);
    setLaunchPrompt(null);
    clearPendingQueryTimer();
    pendingQueryRef.current = null;
    void recordDaemonRuntimeLifecycle(sid, "error", error).catch(() => {});
  }, [clearPendingQueryTimer]);

  const cliCommand = getRunnerCliCommand(runner);

  const recheckCli = useCallback(() => {
    setCliAvailable(null);
    checkRunnerAvailability(cliCommand)
      .then((ok) => {
        setCliAvailable(ok);
        if (ok) setInstalling(false);
      })
      .catch(() => setCliAvailable(false));
  }, [cliCommand]);

  const buildContextEnv = useCallback((): [string, string][] => {
    if (!session) return [];
    return buildRunnerContextEnv(session, runner);
  }, [session, runner]);

  const handleSubmitQuery = useCallback((q: string) => {
    const trimmed = q.trim();
    const liveSession = useSessionStore.getState().sessions.find((item) => item.id === sessionIdRef.current);
    if (!trimmed || !liveSession) return;
    const liveDaemonSession = daemon.state.sessionsById[liveSession.id] as DaemonSession | null | undefined;
    const submitAction = resolveSubmitAction({
      daemonState: liveDaemonSession?.state ?? null,
      providerSessionId: liveSession.providerSessionId,
      uiStatus: liveSession.status,
    });
    lastQuerySentAtRef.current = Date.now();
    const submittedQuery = deriveSubmittedQueryState(trimmed, submitAction);
    pendingQueryRef.current = submittedQuery.transportQuery;
    setPendingQuery(submittedQuery.composerDraft);
    setQuerySent(true);

    const nextTitle = liveSession.name?.trim() || trimmed.slice(0, 48);

    if (liveSession.taskId) {
      void updateDaemonTask({
        taskId: liveSession.taskId,
        title: nextTitle,
        prompt: trimmed,
      }).catch(() => {});

      if (submitAction === "send_input") {
        if (ptyReadyRef.current) {
          flushPendingQuery(isWindows ? 120 : 100);
        }
        return;
      }

      if (supportsPromptLaunch && !ptyEverActive) {
        setLaunchPrompt(trimmed);
      }
      setPtyEverActive(true);
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
    return;
  }, [daemon.state.sessionsById, flushPendingQuery, isWindows, ptyEverActive, supportsPromptLaunch]);

  const handleInstall = useCallback(() => {
    if (!installCmd) return;
    installCountRef.current += 1;
    const id = `install-${sessionId}-${installCountRef.current}`;
    setInstallId(id);
    setInstalling(true);
  }, [installCmd, sessionId]);

  const handleSwitchRunner = useCallback(async (type: RunnerType) => {
    if (!session || !canSwitchRunner) return;
    if (session.runner.type === type) return;

    const provider = type === "codex" ? "codex" : "claude";
    const nextRunner = useSettingsStore.getState().getRunnerConfigForType(type);

    await updateDaemonSession({ sessionId: session.id, provider });

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

  useEffect(() => {
    if (!isOpen) return;
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    if (hasNativeResumeBinding(s)) {
      setQuerySent(true);
    }
  }, [isOpen, sessionId]);

  useEffect(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    const started = !!s && ((s.status === "running" || s.status === "waiting" || s.status === "suspended") || hasNativeResumeBinding(s));
    const persistedResumeSessionId =
      s && (s.runner.type === "claude-code" || s.runner.type === "codex")
        ? (s.providerSessionId?.trim() ?? "")
        : "";
    setQuerySent(started);
    setLaunchResumeSessionId(persistedResumeSessionId);
    setPtyEverActive(
      deriveSessionBridgeState({
        sessionStarted: started,
        canUseRuntime,
        worktreeReady: !!useSessionStore.getState().worktreeReadyIds.has(sessionId),
        isResumeLaunch: persistedResumeSessionId.length > 0,
        persistedResumeSessionId,
      }),
    );
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    launchAttemptRef.current = false;
    if (!started) {
      pendingQueryRef.current = null;
      setLaunchPrompt(null);
    }
  }, [canUseRuntime, clearPendingQueryTimer, sessionId]);

  useEffect(() => {
    if (isOpen && shouldShowComposer && !querySent) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, querySent, shouldShowComposer]);

  useEffect(() => {
    if (
      !ptyEverActive
      && deriveSessionBridgeState({
        sessionStarted: querySent,
        canUseRuntime,
        worktreeReady,
        isResumeLaunch,
        persistedResumeSessionId: launchResumeSessionId,
      })
    ) {
      setPtyEverActive(true);
    }
  }, [canUseRuntime, isResumeLaunch, launchResumeSessionId, ptyEverActive, querySent, worktreeReady]);

  useEffect(() => {
    const canConsumeIntent = !querySent || session?.status === "waiting";
    if (!isOpen || !pendingExecutionIntent || !canConsumeIntent) return;
    const activeIntent = beginWorkflowExecutionDispatch(sessionId);
    if (!activeIntent) return;
    setPendingQuery(activeIntent.prompt);
    handleSubmitQuery(activeIntent.prompt);
    markWorkflowExecutionSent(sessionId);
  }, [
    beginWorkflowExecutionDispatch,
    handleSubmitQuery,
    isOpen,
    markWorkflowExecutionSent,
    pendingExecutionIntent,
    querySent,
    session?.status,
    sessionId,
  ]);

  useEffect(() => {
    if (!supportsPromptLaunch) {
      setLaunchResumeSessionId("");
      return;
    }
    if (ptyEverActive) return;
    setLaunchResumeSessionId(boundResumeSessionId);
  }, [boundResumeSessionId, ptyEverActive, supportsPromptLaunch]);

  useEffect(() => {
    recheckCli();
    setInstalling(false);
  }, [recheckCli]);

  useEffect(() => {
    const u = listen<{ session_id: string }>("pty-exit", ({ payload }) => {
      if (payload.session_id !== sessionIdRef.current) return;
      setTimeout(() => {
        launchAttemptRef.current = false;
        void recordDaemonRuntimeLifecycle(sessionIdRef.current, "exit").catch(() => {});
        setQuerySent(false);
      }, 1200);
    });
    return () => { void u.then((f) => f()).catch(() => {}); };
  }, []);

  useEffect(() => {
    pendingQueryForInputRef.current = pendingQuery;
  }, [pendingQuery]);

  const handleSubmitQueryRef = useRef(handleSubmitQuery);
  useEffect(() => { handleSubmitQueryRef.current = handleSubmitQuery; }, [handleSubmitQuery]);

  useEffect(() => {
    const el = queryInputRef.current;
    if (!el) return;

    let imeComposing = false;
    const onCompositionStart = () => { imeComposing = true; };
    const onCompositionEnd = () => { imeComposing = false; };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        const composing = imeComposing || e.isComposing || e.keyCode === 229;
        if (composing) return;
        e.preventDefault();
        const q = pendingQueryForInputRef.current.trim();
        if (q) handleSubmitQueryRef.current(q);
      }
    };

    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [querySent, installing]);

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
    canSwitchRunner,
    shouldShowComposer,
    waitingForPtyLaunch,
    showRuntimeSurface,
    runtimeSurfaceActive: runtimeSurfaceState.active,
    cliCommand,
    installCmd,
    contextEnv: buildContextEnv(),
  };
}
