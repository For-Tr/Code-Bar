import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS, sanitizeRunnerConfig, isGlassTheme, type RunnerType } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { PtyTerminal } from "./PtyTerminal";
import { TrafficLights } from "./TrafficLights";
import { startRunner } from "../harness/runnerRouter";
import type { RunnerHandle } from "../harness/runnerRouter";

// 弹簧参数
const SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 0.9,
};

// ── CLI 安装命令映射 ───────────────────────────────────────────
const CLI_INSTALL_CMD: Partial<Record<RunnerType, string>> = {
  "claude-code": "npm install -g @anthropic-ai/claude-code",
  "codex":       "npm install -g @openai/codex",
};

// ── 内嵌安装终端（独立 PTY，仅用于安装） ────────────────────────
interface InstallTerminalProps {
  installId: string;
  installCmd: string;
  onFinished: () => void;
}

function InstallTerminal({ installId, installCmd, onFinished }: InstallTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const startedRef = useRef(false);
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");

  useEffect(() => {
    if (!containerRef.current) return;
    let term: import("@xterm/xterm").Terminal;
    let fit: import("@xterm/addon-fit").FitAddon;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      term = new Terminal({
        theme: { background: "#0a0a0c", foreground: "#e2e8f0", cursor: "#60a5fa" },
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        lineHeight: 1.4,
        scrollback: 2000,
        allowTransparency: true,
        convertEol: true,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      if (startedRef.current) return;
      startedRef.current = true;

      const cols = Math.max(term.cols, 40);
      const rows = Math.max(term.rows, 10);

      invoke("start_pty_session", {
        sessionId: installId,
        workdir: "~",
        command: isWindows ? "cmd.exe" : "sh",
        args: isWindows ? ["/d", "/c", installCmd] : ["-c", installCmd],
        cols,
        rows,
        env: null,
      }).catch((e) => {
        term.writeln(`\x1b[31m启动失败: ${e}\x1b[0m`);
      });

      const u1 = listen<{ session_id: string; data: string }>("pty-data", ({ payload }) => {
        if (payload.session_id !== installId) return;
        try {
          const bin = atob(payload.data);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          termRef.current?.write(bytes);
        } catch {}
      });

      const u2 = listen<{ session_id: string }>("pty-exit", ({ payload }) => {
        if (payload.session_id !== installId) return;
        termRef.current?.writeln("\r\n\x1b[90m─── 安装完成，正在重新检测 CLI ───\x1b[0m");
        setTimeout(onFinished, 800);
      });

      return () => {
        u1.then((f) => f());
        u2.then((f) => f());
      };
    })();

    return () => {
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installCmd, installId, isWindows, onFinished]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isWindows]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#0a0a0c" }}
    />
  );
}

// ── 单个 Session 的常驻 PTY 面板 ─────────────────────────────
interface PanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

function hasNativeResumeBinding(
  session: { runner?: { type?: string }; providerSessionId?: string } | undefined
): boolean {
  if (!session?.providerSessionId?.trim()) return false;
  const runnerType = session.runner?.type;
  return runnerType === "claude-code" || runnerType === "codex";
}

function SessionPanel({ sessionId, isOpen, onClose }: PanelProps) {
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const worktreeReady = useSessionStore((s) => s.worktreeReadyIds.has(sessionId));
  const { updateSession, appendOutput, clearOutput } = useSessionStore();
  const { settings, patchRunner, openSettings, getRunnerConfigForType } = useSettingsStore();
  const isGlass = isGlassTheme(settings.theme);
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const hasOpenedRef = useRef(false);
  const [hidden, setHidden] = useState(!isOpen);

  // query 相关状态
  const [pendingQuery, setPendingQuery] = useState("");
  // querySent: query 已发送，隐藏输入遮罩，显示终端
  const [querySent, setQuerySent] = useState(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    return !!s && ((s.status === "running" || s.status === "waiting" || s.status === "suspended") || hasNativeResumeBinding(s));
  });
  const queryInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingQueryForInputRef = useRef("");

  // 安装模式
  const [installing, setInstalling] = useState(false);
  const installCountRef = useRef(0);
  const [installId, setInstallId] = useState("");
  const [launchPrompt, setLaunchPrompt] = useState<string | null>(null);

  // PTY 是否已启动过（首次展开后就保持 true，避免收起时 active=false 触发重启逻辑）
  const [ptyEverActive, setPtyEverActive] = useState(false);
  // 锁定当前这轮 PTY 启动时使用的 resume session id。
  // providerSessionId 可能在首条 prompt 发出后几秒才回填；如果立刻参与 key/args 计算，
  // 会导致正在运行的 PTY 被卸载并改用 resume 重启。
  const [launchResumeSessionId, setLaunchResumeSessionId] = useState("");

  // PTY 是否已就绪（start_pty_session 成功返回后置为 true）
  const ptyReadyRef = useRef(false);
  // 最后一次发送 query 的时间戳（ms），用于过滤紧随 query 之后的延迟 Stop
  const lastQuerySentAtRef = useRef(0);
  // 用 ref 保存 sessionId，供稳定回调访问（避免闭包过时）
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // PTY 就绪回调：仅在 query 已提交但 PTY 还没就绪时消费
  // onReady 触发时机 = start_pty_session spawn 返回（CLI 进程已启动），
  // 稍作延迟让 CLI 完成初始化输出再发 query。
  const pendingQueryRef = useRef<string | null>(null);
  const pendingQueryTimerRef = useRef<number | null>(null);
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
      invoke("send_pty_query", {
        sessionId: sessionIdRef.current,
        query,
      })
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
  }, [clearPendingQueryTimer, flushPendingQuery, isWindows]); // 纯 ref 访问，永不更新引用

  // PTY 状态回调：Claude 完成一轮回应，等待下一条 query
  const handlePtyWaiting = useCallback(() => {
    const sid = sessionIdRef.current;
    const s = useSessionStore.getState().sessions.find((x) => x.id === sid);
    flushPendingQuery(isWindows ? 120 : 0);
    // 已是 waiting 则不重复通知
    if (s?.status === "waiting") return;
    updateSession(sid, { status: "waiting" });
    // 发系统通知
    const taskName = s?.currentTask?.slice(0, 40) || "任务";
    invoke("send_notification", {
      title: "Code Bar",
      body: `✅ ${taskName} — 已完成，等待下一步指令`,
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushPendingQuery, isWindows, updateSession]);

  // PTY 状态回调：Claude 开始处理（UserPromptSubmit hook 触发）
  const handlePtyRunning = useCallback(() => {
    updateSession(sessionIdRef.current, { status: "running" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSession]);

  // PTY 状态回调：API 错误中断（StopFailure hook 触发）
  const handlePtyError = useCallback((error: string) => {
    updateSession(sessionIdRef.current, { status: "error", currentTask: error });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSession]);

  // isOpen 变化：即将展开时立即取消隐藏
  useEffect(() => {
    if (!isOpen) return;
    setHidden(false);
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    if (hasNativeResumeBinding(s)) {
      setQuerySent(true);
    }
  }, [isOpen, sessionId]);

  // sessionId 变化时重置（切换 session）
  useEffect(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    setQuerySent(!!s && ((s.status === "running" || s.status === "waiting" || s.status === "suspended") || hasNativeResumeBinding(s)));
    setPendingQuery("");
    setLaunchPrompt(null);
    setLaunchResumeSessionId(
      s && (s.runner?.type === "claude-code" || s.runner?.type === "codex")
        ? (s.providerSessionId?.trim() ?? "")
        : ""
    );
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    pendingQueryRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearPendingQueryTimer, sessionId]);

  // 展开/收起时调整窗口大小
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      // 展开：临时放大，不写盘（不覆盖用户记忆的基础大小）
      invoke("resize_popup_full", { width: 700, height: 600 }).catch(() => {});
    } else if (hasOpenedRef.current) {
      // 收起：恢复到用户记忆的基础大小（从磁盘读取），不硬编码尺寸
      invoke("restore_popup_bounds").catch(() => {});
    }
  }, [isOpen]);

  // 首条 query 提交后才激活 PTY，避免 CLI 初始化阶段的输入竞争。
  useEffect(() => {
    if (querySent && worktreeReady && !ptyEverActive) setPtyEverActive(true);
  }, [querySent, worktreeReady, ptyEverActive]);

  // 展开且未发送 query 时自动聚焦输入框
  useEffect(() => {
    if (isOpen && !querySent) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, querySent]);

  useEffect(() => {
    if (!session?.runner) {
      updateSession(sessionId, { runner: { ...sanitizeRunnerConfig(settings.runner) } });
      return;
    }

    const normalizedRunner = sanitizeRunnerConfig(session.runner);
    if (
      normalizedRunner.type !== session.runner.type
      || (normalizedRunner.cliPath ?? "") !== (session.runner.cliPath ?? "")
      || (normalizedRunner.cliArgs ?? "") !== (session.runner.cliArgs ?? "")
      || (normalizedRunner.apiBaseUrl ?? "") !== (session.runner.apiBaseUrl ?? "")
      || (normalizedRunner.apiKeyOverride ?? "") !== (session.runner.apiKeyOverride ?? "")
    ) {
      updateSession(sessionId, { runner: normalizedRunner });
    }
  }, [session?.runner, sessionId, settings.runner, updateSession]);

  const runner = sanitizeRunnerConfig(session?.runner ?? settings.runner);
  const isNativeMode = runner.type === "native";
  const supportsPromptLaunch = runner.type === "claude-code" || runner.type === "codex";
  const boundResumeSessionId = supportsPromptLaunch ? (session?.providerSessionId?.trim() ?? "") : "";
  const resumeSessionId = supportsPromptLaunch
    ? (ptyEverActive ? launchResumeSessionId : boundResumeSessionId)
    : "";
  const isResumeLaunch = resumeSessionId.length > 0;

  useEffect(() => {
    if (!supportsPromptLaunch) {
      setLaunchResumeSessionId("");
      return;
    }
    if (ptyEverActive) return;
    setLaunchResumeSessionId(boundResumeSessionId);
  }, [boundResumeSessionId, ptyEverActive, supportsPromptLaunch]);

  const cliCommand =
    runner.type === "claude-code" ? runner.cliPath || "claude"
    : runner.type === "codex" ? runner.cliPath || "codex"
    : runner.type === "custom-cli" ? runner.cliPath || "sh"
    : "claude";

  // CLI 可用性检测
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  const recheckCli = useCallback(() => {
    if (isNativeMode) { setCliAvailable(true); return; }
    setCliAvailable(null);
    invoke<boolean>("check_cli", { command: cliCommand })
      .then((ok) => {
        setCliAvailable(ok);
        if (ok) setInstalling(false);
      })
      .catch(() => setCliAvailable(false));
  }, [isNativeMode, cliCommand]);

  useEffect(() => {
    recheckCli();
    setInstalling(false);
  }, [recheckCli]);

  const ptyConfigKey = `${runner.type}::${cliCommand}::${session?.workdir ?? ""}::${resumeSessionId}`;
  const lastPtyConfigKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const prevKey = lastPtyConfigKeyRef.current;
    lastPtyConfigKeyRef.current = ptyConfigKey;
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    if (!ptyEverActive || prevKey === null || prevKey === ptyConfigKey) return;
    setLaunchPrompt(null);
    pendingQueryRef.current = null;
  }, [clearPendingQueryTimer, ptyConfigKey, ptyEverActive]);

  // PTY 退出后标记 done
  useEffect(() => {
    if (isNativeMode) return;
    const u = listen<{ session_id: string }>("pty-exit", ({ payload }) => {
      if (payload.session_id !== sessionIdRef.current) return;
      setTimeout(() => {
        updateSession(sessionIdRef.current, { status: "done" });
        setQuerySent(false);
      }, 1200);
    });
    return () => { u.then((f: () => void) => f()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNativeMode]);

  // 监听通知点击回调：用户点击系统通知后，激活并显示 popup 窗口
  // notification-clicked 由 Rust 层 mac-notification-sys 在用户点击通知后发射
  useEffect(() => {
    const u = listen<{ title: string; body: string; action: string }>(
      "notification-clicked",
      () => {
        // 先显示/激活窗口，再展开 terminal panel
        invoke("focus_popup").catch(() => {});
      }
    );
    return () => { u.then((f: () => void) => f()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 构建注入给 PTY 进程的环境变量 ──
  // 包含：CODE_BAR_* 上下文信息 + CLI 所需的 API Key / Base URL
  const buildContextEnv = useCallback((): [string, string][] => {
    if (!session) return [];
    const workspace = workspaces.find((w) => w.id === session.workspaceId);
    const allSessions = useSessionStore.getState().sessions;
    const siblingSessions = allSessions.filter(
      (s) => s.workspaceId === session.workspaceId && s.id !== session.id && s.status === "running"
    );

    const env: [string, string][] = [
      ["CODE_BAR_SESSION_ID", session.id],
      ["CODE_BAR_RUNNER_TYPE", runner.type],
      ["CODE_BAR_SESSION_NAME", session.name],
      ["CODE_BAR_WORKDIR", session.workdir],
      ["CODE_BAR_WORKSPACE_ID", session.workspaceId],
      ["CODE_BAR_WORKSPACE_NAME", workspace?.name ?? ""],
      ["CODE_BAR_CONCURRENT_SESSIONS", String(siblingSessions.length)],
      ["CODE_BAR_SUGGESTED_BRANCH", `ci/session-${session.id}`],
      // Worktree 信息：告知 AI CLI 当前在独立 worktree 工作，不用自己创建分支
      ...(session.worktreePath ? [
        ["CODE_BAR_WORKTREE_PATH", session.worktreePath] as [string, string],
        ["CODE_BAR_BASE_BRANCH", session.baseBranch ?? ""] as [string, string],
        ["CODE_BAR_BRANCH", session.branchName ?? ""] as [string, string],
      ] : []),
    ];

    // ── CLI 专用：注入 API Key 和 Base URL ──
    // apiKeyOverride 优先，否则从 apiKeys 取对应服务商的 key
    const apiKey = runner.apiKeyOverride?.trim()
      || settings.apiKeys?.[runner.type === "claude-code" ? "anthropic" : runner.type === "codex" ? "openai" : "openai-compatible"]
      || "";
    const apiBaseUrl = runner.apiBaseUrl?.trim() ?? "";

    if (runner.type === "claude-code") {
      if (apiKey)     env.push(["ANTHROPIC_API_KEY", apiKey]);
      if (apiBaseUrl) env.push(["ANTHROPIC_BASE_URL", apiBaseUrl]);
    } else if (runner.type === "codex") {
      if (apiKey)     env.push(["OPENAI_API_KEY", apiKey]);
      if (apiBaseUrl) env.push(["OPENAI_BASE_URL", apiBaseUrl]);
    } else if (runner.type === "custom-cli") {
      // 自定义 CLI：通用变量名，CLI 自己读取
      if (apiKey)     env.push(["API_KEY", apiKey]);
      if (apiBaseUrl) env.push(["API_BASE_URL", apiBaseUrl]);
    }

    return env;
  }, [session, workspaces, runner, settings.apiKeys]);

  // ── 用户提交 query ──
  const nativeRunnerRef = useRef<RunnerHandle | null>(null);

  const handleSubmitQuery = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !session) return;
    const title = trimmed.length > 24 ? trimmed.slice(0, 24) + "…" : trimmed;
    lastQuerySentAtRef.current = Date.now();
    updateSession(session.id, { name: title, currentTask: trimmed, status: "running" });
    setQuerySent(true);

    // ── Native 模式 ──
    if (isNativeMode) {
      clearOutput(sessionIdRef.current);
      const activeApiKey = settings.apiKeys?.[settings.model.provider] || settings.model.apiKey || "";
      startRunner({
        sessionId: session.id,
        workdir: session.workdir,
        task: trimmed,
        runner,
        model: { ...settings.model, apiKey: activeApiKey },
        harness: settings.harness,
        onOutput: (line) => appendOutput(sessionIdRef.current, line),
        onDone: () => {
          updateSession(sessionIdRef.current, { status: "done", currentTask: "已完成" });
          setQuerySent(false);
        },
        onError: (msg) => {
          updateSession(sessionIdRef.current, { status: "error", currentTask: msg });
          setQuerySent(false);
        },
      }).then((handle) => {
        nativeRunnerRef.current = handle;
      }).catch((e) => {
        updateSession(sessionIdRef.current, { status: "error", currentTask: String(e) });
        setQuerySent(false);
      });
      return;
    }

    // ── PTY 模式 ──
    if (ptyReadyRef.current) {
      pendingQueryRef.current = trimmed;
      flushPendingQuery(isWindows ? 120 : 100);
    } else if (supportsPromptLaunch && !ptyEverActive) {
      // Claude / Codex 首条 query 直接作为位置参数启动，避免首屏黑屏只剩光标。
      setLaunchPrompt(trimmed);
    } else {
      pendingQueryRef.current = trimmed;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, updateSession, appendOutput, clearOutput, flushPendingQuery, isNativeMode, isWindows, ptyEverActive, runner, settings.apiKeys, settings.model, settings.harness, supportsPromptLaunch]);

  const handleStopNative = useCallback(() => {
    nativeRunnerRef.current?.stop();
    nativeRunnerRef.current = null;
    updateSession(sessionId, { status: "idle" });
    setQuerySent(false);
    setPendingQuery("");
  }, [sessionId, updateSession]);

  const handleInstall = useCallback(() => {
    const cmd = CLI_INSTALL_CMD[runner.type];
    if (!cmd) return;
    installCountRef.current += 1;
    const id = `install-${sessionId}-${installCountRef.current}`;
    setInstallId(id);
    setInstalling(true);
  }, [runner.type, sessionId]);

  const handleSwitchRunner = useCallback((type: RunnerType) => {
    const nextRunner = getRunnerConfigForType(type);
    setLaunchPrompt(null);
    clearPendingQueryTimer();
    ptyReadyRef.current = false;
    pendingQueryRef.current = null;
    invoke("stop_pty_session", { sessionId }).catch(() => {});
    if (session) {
      updateSession(session.id, { runner: { ...nextRunner } });
    }
    patchRunner({ type });
  }, [clearPendingQueryTimer, getRunnerConfigForType, patchRunner, session, sessionId, updateSession]);

  // pendingQuery 同步到 ref，供原生 DOM 事件回调读取最新值
  useEffect(() => {
    pendingQueryForInputRef.current = pendingQuery;
  }, [pendingQuery]);

  const handleSubmitQueryRef = useRef(handleSubmitQuery);
  useEffect(() => { handleSubmitQueryRef.current = handleSubmitQuery; }, [handleSubmitQuery]);

  // 原生 DOM 事件处理 Enter 发送（绕过 React 合成事件对 isComposing 的时序问题）
  useEffect(() => {
    const el = queryInputRef.current;
    if (!el) return;

    let imeComposing = false;
    const onCompositionStart = () => { imeComposing = true; };
    const onCompositionEnd   = () => { imeComposing = false; };
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
    el.addEventListener("compositionend",   onCompositionEnd);
    el.addEventListener("keydown",          onKeyDown);
    return () => {
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend",   onCompositionEnd);
      el.removeEventListener("keydown",          onKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySent, installing]);

  if (!session) return null;

  const runnerBadge = isNativeMode
    ? RUNNER_LABELS["native"]
    : cliCommand.split("/").pop() ?? cliCommand;

  const isRunning = session.status === "running";
  const waitingForPtyLaunch = !isNativeMode && querySent && !ptyEverActive && !isResumeLaunch;
  const sessionOutput = session.output ?? [];
  const installCmd = CLI_INSTALL_CMD[runner.type];

  // PTY key：runner/command 或 workdir 变化时重新挂载
  // workdir 变化场景：新建 session 时 worktree 在后台创建完成，workdir 从原路径更新为 worktree 路径
  // 由于 worktree 完成前 PTY 还未启动（querySent=false），重挂载无副作用
  const ptyKey = `${sessionId}::${runner.type}::${cliCommand}::${session.workdir}::${resumeSessionId}`;

  // CLI 基础 args（不含 task，task 通过 write_pty 写入）
  const cliBaseArgs: string[] =
    runner.type === "claude-code"
      ? (resumeSessionId
          ? ["--resume", resumeSessionId, "--dangerously-skip-permissions"]
          : ["--dangerously-skip-permissions"])
      : runner.type === "codex"
      ? (resumeSessionId ? ["resume", resumeSessionId] : [])
      : runner.cliArgs ? runner.cliArgs.split(/\s+/).filter(Boolean) : [];

  const contextEnv = buildContextEnv();
  const panelRadius = isGlass ? "var(--ci-shell-radius)" : 14;
  const panelBackground = isGlass ? "transparent" : "var(--ci-pty-panel-bg)";
  const panelBorder = isGlass ? "none" : "1px solid var(--ci-pty-panel-border)";
  const titlebarBackground = isGlass ? "var(--ci-toolbar-bg)" : "var(--ci-pty-titlebar-bg)";
  const titlebarBorder = isGlass ? "none" : "1px solid var(--ci-pty-titlebar-bdr)";
  const titlebarText = isGlass ? "var(--ci-text)" : "var(--ci-pty-title-color)";
  const actionButtonBackground = isGlass ? "var(--ci-pill-bg)" : "var(--ci-pty-btn-bg)";
  const actionButtonBorder = isGlass ? "1px solid var(--ci-pill-border)" : "1px solid var(--ci-pty-btn-border)";
  const actionButtonText = isGlass ? "var(--ci-text-muted)" : "var(--ci-pty-btn-text)";
  const actionButtonHoverBackground = isGlass ? "var(--ci-surface-hi)" : "var(--ci-pty-btn-hover-bg)";
  const actionButtonHoverText = isGlass ? "var(--ci-text)" : "var(--ci-pty-btn-hover-text)";
  const runnerChipBackground = isGlass ? "var(--ci-accent-bg)" : "var(--ci-pty-runner-bg)";
  const runnerChipBorder = isGlass ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-pty-runner-border)";
  const runnerChipText = isGlass ? "var(--ci-accent)" : "var(--ci-pty-runner-text)";
  const runnerChipHoverBackground = isGlass ? "rgba(63,145,255,0.16)" : "var(--ci-pty-runner-bg-hover)";
  const overlayBackground = isGlass ? "transparent" : "var(--ci-pty-mask-bg)";
  const overlayTitle = isGlass ? "var(--ci-text)" : "var(--ci-pty-mask-title)";
  const overlayHint = isGlass ? "var(--ci-text-muted)" : "var(--ci-pty-mask-hint)";
  const overlayFooter = isGlass ? "var(--ci-text-dim)" : "var(--ci-pty-mask-footer)";
  const inputBackground = isGlass ? "var(--ci-surface-hi)" : "var(--ci-pty-input-bg)";
  const inputBorder = isGlass ? "1px solid var(--ci-border)" : "1px solid var(--ci-pty-input-border)";
  const inputText = isGlass ? "var(--ci-text)" : "var(--ci-pty-input-text)";
  const installOverlayBackground = isGlass ? "transparent" : "var(--ci-pty-panel-bg)";
  const installStripBackground = isGlass ? "var(--ci-toolbar-bg)" : "transparent";
  const installPromptColor = isGlass ? "var(--ci-text-dim)" : "var(--ci-pty-mask-footer)";
  const terminalSurface = isGlass ? "var(--ci-code-bg)" : "var(--ci-pty-term-bg)";
  const queryCardShadow = isGlass
    ? "var(--ci-inset-highlight), var(--ci-card-shadow-strong)"
    : "none";
  const queryInputShadow = isGlass
    ? "var(--ci-inset-highlight), var(--ci-card-shadow)"
    : "0 1px 6px rgba(0,0,0,0.1), inset 0 0 0 0.5px rgba(0,0,0,0.04)";

  return (
    <motion.div
      initial={false}
      animate={isOpen
        ? { opacity: 1, pointerEvents: "auto" as const }
        : { opacity: 0, pointerEvents: "none" as const }
      }
      transition={SPRING}
      onAnimationComplete={() => {
        if (!isOpen) setHidden(true);
      }}
      style={{
        position: "fixed",
        top: 6, left: 6, right: 6, bottom: 6,
        zIndex: hidden ? -1 : 200,
        borderRadius: panelRadius,
        overflow: "hidden",
        background: panelBackground,
        backdropFilter: isGlass ? "none" : "blur(48px) saturate(1.5)",
        WebkitBackdropFilter: isGlass ? "none" : "blur(48px) saturate(1.5)",
        border: panelBorder,
        display: "flex",
        flexDirection: "column",
        visibility: hidden ? "hidden" : "visible",
        textShadow,
      }}
    >
      {/* ── 标题栏（data-tauri-drag-region 让整条都可拖动窗口）── */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px 10px",
          borderBottom: titlebarBorder,
          flexShrink: 0,
          cursor: "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
          background: titlebarBackground,
        }}
      >
        <TrafficLights onClose={onClose} size={12} gap={6} />

        <span data-tauri-drag-region style={{
          flex: 1, fontSize: 12, fontWeight: 600,
          color: titlebarText,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          cursor: "grab",
          letterSpacing: -0.2,
        }}>
          {installing ? `正在安装 ${runnerBadge}…` : session.name}
        </span>

        {/* Runner 快速切换 badge */}
        <button
          data-tauri-drag-region
          onClick={() => openSettings("runner")}
          onMouseDown={(e) => e.stopPropagation()}
          title="切换 Runner"
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 99,
            background: runnerChipBackground,
            border: runnerChipBorder,
            color: runnerChipText, fontFamily: "monospace",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = runnerChipHoverBackground)}
          onMouseLeave={e => (e.currentTarget.style.background = runnerChipBackground)}
        >
          {runnerBadge}
        </button>

        {isNativeMode && isRunning && (
          <button
            onClick={handleStopNative}
            style={{
              background: "rgba(255,59,48,0.12)",
              border: "1px solid rgba(255,59,48,0.28)",
              borderRadius: 6, padding: "2px 10px",
              color: "#ff6b6b", fontSize: 11, cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,59,48,0.22)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,59,48,0.12)")}
          >
            停止
          </button>
        )}

        {installing && (
          <button
            data-tauri-drag-region
            onClick={() => { setInstalling(false); recheckCli(); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: actionButtonBackground,
              border: actionButtonBorder,
              borderRadius: 6, padding: "2px 8px",
              color: actionButtonText, fontSize: 11, cursor: "pointer",
            }}
          >
            取消
          </button>
        )}

        {!installing && (
          <button
            data-tauri-drag-region
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: actionButtonBackground,
              border: actionButtonBorder,
              borderRadius: 6, padding: "2px 8px",
              color: actionButtonText, fontSize: 11, cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = actionButtonHoverBackground;
              e.currentTarget.style.color = actionButtonHoverText;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = actionButtonBackground;
              e.currentTarget.style.color = actionButtonText;
            }}
          >
            收起
          </button>
        )}
      </div>

      {/* ── 内容区域 ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* ── 安装终端 ── */}
        <AnimatePresence>
          {installing && installId && installCmd && (
            <motion.div
              key="install-terminal"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              style={{
                position: "absolute", inset: 0, zIndex: 10,
                display: "flex", flexDirection: "column",
                background: installOverlayBackground,
              }}
            >
              <div style={{
                flexShrink: 0,
                padding: "8px 14px",
                borderBottom: titlebarBorder,
                background: installStripBackground,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 10, color: installPromptColor, fontFamily: "monospace" }}>$</span>
                <code style={{
                  flex: 1, fontSize: 11,
                  color: "rgba(251,191,36,0.8)",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {installCmd}
                </code>
              </div>
              <div style={{ flex: 1, overflow: "hidden", padding: isGlass ? 0 : "4px" }}>
                <InstallTerminal
                  installId={installId}
                  installCmd={installCmd}
                  onFinished={recheckCli}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Native 模式：输出面板 ── */}
        {isNativeMode && querySent && (
          <div style={{
            flex: 1, overflow: "auto",
            padding: "12px 16px",
            background: terminalSurface,
          }}>
            <pre style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: isGlass ? 12.5 : 12,
              lineHeight: isGlass ? "1.7" : "1.6",
              color: isGlass ? "rgba(11,34,56,0.94)" : "rgba(230,230,235,0.82)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}>
              {sessionOutput.join("\n")}
            </pre>
          </div>
        )}

        {/* ── PTY 终端：面板打开即启动（常驻），发送 query 后可见 ── */}
        {!isNativeMode && (
          <div style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            padding: isGlass ? 0 : "8px 4px 4px",
            opacity: querySent && ptyEverActive ? 1 : 0,
            pointerEvents: querySent && ptyEverActive ? "auto" : "none",
          }}>
            <PtyTerminal
              key={ptyKey}
              sessionId={sessionId}
              command={cliCommand}
              args={cliBaseArgs}
              workdir={session.workdir}
              active={ptyEverActive}
              initialPrompt={launchPrompt}
              supportsPromptArg={supportsPromptLaunch}
              onReady={handlePtyReady}
              onWaiting={handlePtyWaiting}
              onRunning={handlePtyRunning}
              onError={handlePtyError}
              env={contextEnv}
            />
          </div>
        )}

        {/* Query 输入遮罩 */}
        <AnimatePresence>
          {(!querySent || waitingForPtyLaunch) && !installing && (
            <motion.div
              key="query-input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                padding: isGlass ? "22px 28px 28px" : "24px 32px",
                gap: 16,
                overflowY: "auto",
                background: overlayBackground,
              }}
            >
              <div style={{
                width: "min(100%, 560px)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                padding: isGlass ? "0" : "22px 22px 20px",
                borderRadius: isGlass ? 0 : 20,
                background: isGlass ? "transparent" : "transparent",
                border: "none",
                boxShadow: isGlass ? "none" : queryCardShadow,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: waitingForPtyLaunch ? "rgba(255,159,10,0.14)" : "var(--ci-accent-bg)",
                  border: waitingForPtyLaunch ? "1px solid rgba(255,159,10,0.28)" : "1px solid var(--ci-accent-bdr)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, flexShrink: 0,
                  color: waitingForPtyLaunch ? "#ffbf40" : "var(--ci-accent)",
                }}>
                  ✦
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: overlayTitle, marginBottom: 4 }}>
                    描述你的任务
                  </div>
                  <div style={{ fontSize: 11, color: overlayHint }}>
                    {isNativeMode
                      ? `使用内置 Harness 调用 ${settings.model.model}`
                      : `回车后将自动启动 ${runnerBadge} 并透传给 AI`}
                  </div>
                </div>

                {/* Runner 快速切换 */}
                {waitingForPtyLaunch && (
                  <div style={{
                    width: "100%",
                    background: "rgba(255,159,10,0.10)",
                    border: "1px solid rgba(255,159,10,0.28)",
                    borderRadius: 9,
                    padding: "10px 14px",
                    fontSize: 11,
                    color: "rgba(255,195,80,0.92)",
                    lineHeight: "1.6",
                    textAlign: "center",
                  }}>
                    首条指令已排队，正在等待 worktree 和 PTY 准备完成。
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {(Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(([type, label]) => {
                    const active = runner.type === type;
                    return (
                      <button
                        key={type}
                        onClick={() => handleSwitchRunner(type)}
                        disabled={waitingForPtyLaunch}
                        style={{
                          fontSize: 10, padding: "3px 10px", borderRadius: 99,
                          background: active ? "var(--ci-accent-bg)" : actionButtonBackground,
                          border: active ? "1px solid var(--ci-accent-bdr)" : actionButtonBorder,
                          color: active ? "var(--ci-accent)" : actionButtonText,
                          cursor: waitingForPtyLaunch ? "default" : "pointer",
                          transition: "all 0.15s",
                          fontWeight: active ? 600 : 400,
                          opacity: waitingForPtyLaunch ? 0.7 : 1,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* CLI 不可用警告 + 一键安装 */}
                {!isNativeMode && cliAvailable === false && (
                  <div style={{
                    width: "100%",
                    background: "var(--ci-yellow-bg)",
                    border: "1px solid var(--ci-yellow-bdr)",
                    borderRadius: 9,
                    padding: "10px 14px",
                    fontSize: 11,
                    color: "var(--ci-yellow-dark)",
                    lineHeight: "1.6",
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      ⚠️  找不到 {cliCommand}
                    </div>
                    <div style={{ color: overlayHint, marginBottom: 8 }}>
                      {runner.type === "claude-code" && (
                        <>安装命令：<code style={{ color: "rgba(255,195,80,0.8)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>npm install -g @anthropic-ai/claude-code</code></>
                      )}
                      {runner.type === "codex" && (
                        <>安装命令：<code style={{ color: "rgba(255,195,80,0.8)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>npm install -g @openai/codex</code></>
                      )}
                      {runner.type === "custom-cli" && (
                        <>请在设置中配置正确的可执行文件路径</>
                      )}
                    </div>
                    {installCmd && (
                      <button
                        onClick={handleInstall}
                        style={{
                          width: "100%",
                          padding: "8px 0",
                          borderRadius: 6,
                          background: "var(--ci-accent-bg)",
                          border: "1px solid var(--ci-accent-bdr)",
                          color: "var(--ci-accent)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = runnerChipHoverBackground)}
                        onMouseLeave={e => (e.currentTarget.style.background = "var(--ci-accent-bg)")}
                      >
                        一键安装
                      </button>
                    )}
                  </div>
                )}
                <div style={{
                  width: "100%",
                  background: inputBackground,
                  border: inputBorder,
                  borderRadius: 12,
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "10px 14px",
                  backdropFilter: isGlass ? "none" : "blur(8px)",
                  boxShadow: queryInputShadow,
                  transition: "border-color 0.15s, box-shadow 0.15s",
                  textShadow: "none",
                }}
                onFocus={() => {}}
                >
                  <span style={{ color: "rgba(0,122,255,0.7)", fontSize: 13, marginTop: 1, flexShrink: 0 }}>›</span>
                  <textarea
                    ref={queryInputRef}
                    value={pendingQuery}
                    onChange={e => setPendingQuery(e.target.value)}
                    placeholder="例：重构 auth 模块，添加 JWT 支持…"
                    rows={3}
                    readOnly={waitingForPtyLaunch}
                    style={{
                      flex: 1, background: "none", border: "none", outline: "none",
                      color: inputText, fontSize: 13, lineHeight: "1.6",
                      resize: "none", fontFamily: "inherit",
                    }}
                  />
                </div>

                <div style={{ fontSize: 10, color: overlayFooter }}>
                  Enter 发送 · Shift+Enter 换行 · Esc 关闭
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── 主组件 ──
export function SessionDetail() {
  const { expandedSessionId, setExpandedSession, sessions } = useSessionStore();

  // 记录所有曾经被展开过的 session id，保持其 Panel 常驻以维持 PTY 进程
  const [mountedIds, setMountedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!expandedSessionId) return;
    setMountedIds((prev) =>
      prev.includes(expandedSessionId) ? prev : [...prev, expandedSessionId]
    );
  }, [expandedSessionId]);

  // 当 session 被删除时，从 mountedIds 中移除，实现卸载销毁
  useEffect(() => {
    const sessionIds = new Set(sessions.map((s) => s.id));
    setMountedIds((prev) => prev.filter((id) => sessionIds.has(id)));
  }, [sessions]);

  useEffect(() => {
    if (!expandedSessionId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSession(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedSessionId, setExpandedSession]);

  return (
    <>
      {mountedIds.map((sid) => (
        <SessionPanel
          key={sid}
          sessionId={sid}
          isOpen={expandedSessionId === sid}
          onClose={() => setExpandedSession(null)}
        />
      ))}
    </>
  );
}
