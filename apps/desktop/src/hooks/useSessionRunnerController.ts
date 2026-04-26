import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppI18n } from "../i18n";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, type RunnerType } from "../store/settingsStore";
import {
  buildRunnerContextEnv,
  checkRunnerAvailability,
  getRunnerBadge,
  getRunnerCliCommand,
  getRunnerInstallCommand,
  hasNativeResumeBinding,
  switchRunnerForSession,
} from "../services/runnerCommands";
import {
  launchDaemonSession,
  recordDaemonRuntimeLifecycle,
  resumeDaemonSession,
  sendDaemonSessionInput,
  stopDaemonSession,
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
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const worktreeReady = useSessionStore((s) => s.worktreeReadyIds.has(sessionId));
  const { updateSession } = useSessionStore();
  const pendingExecutionIntent = useWorkflowExecutionStore((s) => s.pendingIntentBySessionId[sessionId] ?? null);
  const beginWorkflowExecutionDispatch = useWorkflowExecutionStore((s) => s.beginDispatch);
  const markWorkflowExecutionSent = useWorkflowExecutionStore((s) => s.markSent);
  const { settings } = useSettingsStore();

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
  const lastQuerySentAtRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const pendingQueryRef = useRef<string | null>(null);
  const pendingQueryTimerRef = useRef<number | null>(null);

  const runner = session ? session.runner : settings.runner;
  const supportsPromptLaunch = runner.type === "claude-code" || runner.type === "codex";
  const boundResumeSessionId = supportsPromptLaunch ? (session?.providerSessionId?.trim() ?? "") : "";
  const resumeSessionId = supportsPromptLaunch
    ? (ptyEverActive ? launchResumeSessionId : boundResumeSessionId)
    : "";
  const isResumeLaunch = resumeSessionId.length > 0;
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
    if (sessionIdRef.current) {
      const session = useSessionStore.getState().sessions.find((item) => item.id === sessionIdRef.current);
      if (session?.providerSessionId?.trim()) {
        void resumeDaemonSession(sessionIdRef.current).catch(() => {});
      } else {
        void launchDaemonSession(sessionIdRef.current).catch(() => {});
      }
    }
    setLaunchPrompt(null);
    if (isWindows) {
      clearPendingQueryTimer();
      pendingQueryTimerRef.current = window.setTimeout(() => {
        pendingQueryTimerRef.current = null;
        flushPendingQuery(0);
      }, 4000);
      return;
    }
    flushPendingQuery(200);
  }, [clearPendingQueryTimer, flushPendingQuery, isWindows]);

  const handlePtyWaiting = useCallback(() => {
    const sid = sessionIdRef.current;
    const s = useSessionStore.getState().sessions.find((x) => x.id === sid);
    flushPendingQuery(isWindows ? 120 : 0);
    if (s?.status === "waiting") return;
    updateSession(sid, { status: "waiting" });
    void recordDaemonRuntimeLifecycle(sid, "waiting").catch(() => {});
    const taskName = s?.currentTask?.slice(0, 40) || t("session.genericTask");
    invoke("send_notification", {
      title: t("notifications.codeBarTitle"),
      body: t("session.waitingNextStepNotification", { task: taskName }),
      sessionId: sid,
    }).catch(() => {});
  }, [flushPendingQuery, isWindows, updateSession, t]);

  const handlePtyRunning = useCallback(() => {
    const sid = sessionIdRef.current;
    updateSession(sid, { status: "running" });
    void recordDaemonRuntimeLifecycle(sid, "running").catch(() => {});
  }, [updateSession]);

  const handlePtyError = useCallback((error: string) => {
    const sid = sessionIdRef.current;
    updateSession(sid, { status: "error", currentTask: error });
    void recordDaemonRuntimeLifecycle(sid, "error", error).catch(() => {});
  }, [updateSession]);

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
    if (!trimmed || !session) return;
    const title = trimmed.length > 24 ? trimmed.slice(0, 24) + "…" : trimmed;
    lastQuerySentAtRef.current = Date.now();
    updateSession(session.id, { name: title, currentTask: trimmed, status: "running" });
    setQuerySent(true);

    if (ptyReadyRef.current) {
      pendingQueryRef.current = trimmed;
      flushPendingQuery(isWindows ? 120 : 100);
    } else if (supportsPromptLaunch && !ptyEverActive) {
      setLaunchPrompt(trimmed);
    } else {
      pendingQueryRef.current = trimmed;
    }
  }, [session, updateSession, flushPendingQuery, isWindows, ptyEverActive, supportsPromptLaunch]);

  const handleInstall = useCallback(() => {
    if (!installCmd) return;
    installCountRef.current += 1;
    const id = `install-${sessionId}-${installCountRef.current}`;
    setInstallId(id);
    setInstalling(true);
  }, [installCmd, sessionId]);

  const handleSwitchRunner = useCallback((type: RunnerType) => {
    setLaunchPrompt(null);
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    pendingQueryRef.current = null;
    void stopDaemonSession(sessionId).catch(() => {});
    switchRunnerForSession(sessionId, type);
  }, [clearPendingQueryTimer, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    if (hasNativeResumeBinding(s)) {
      setQuerySent(true);
    }
  }, [isOpen, sessionId]);

  useEffect(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    setQuerySent(!!s && ((s.status === "running" || s.status === "waiting" || s.status === "suspended") || hasNativeResumeBinding(s)));
    setPendingQuery("");
    setLaunchPrompt(null);
    setLaunchResumeSessionId(
      s && (s.runner.type === "claude-code" || s.runner.type === "codex")
        ? (s.providerSessionId?.trim() ?? "")
        : ""
    );
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    pendingQueryRef.current = null;
  }, [clearPendingQueryTimer, sessionId]);

  useEffect(() => {
    if (isOpen && !querySent) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, querySent]);

  useEffect(() => {
    if (querySent && (worktreeReady || isResumeLaunch) && !ptyEverActive) {
      setPtyEverActive(true);
    }
  }, [querySent, worktreeReady, isResumeLaunch, ptyEverActive]);

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
        updateSession(sessionIdRef.current, { status: "done" });
        void recordDaemonRuntimeLifecycle(sessionIdRef.current, "exit").catch(() => {});
        setQuerySent(false);
      }, 1200);
    });
    return () => { void u.then((f) => f()).catch(() => {}); };
  }, [updateSession]);

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
    cliCommand,
    installCmd,
    contextEnv: buildContextEnv(),
  };
}
