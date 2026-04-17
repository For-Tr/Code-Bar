import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { TrafficLights } from "./TrafficLights";
import { SessionPromptComposer } from "./session/SessionPromptComposer";
import { SessionRunnerSurface } from "./session/SessionRunnerSurface";
import { useSessionRunnerController } from "../hooks/useSessionRunnerController";

const SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 0.9,
};

type DetailPresentation = "overlay" | "embedded";

function SessionDetailEmptyState({ message }: { message: ReactNode }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      color: "var(--ci-text-dim)",
      fontSize: 12,
      textAlign: "center",
      lineHeight: 1.7,
    }}>
      <div style={{
        maxWidth: 240,
        padding: "18px 20px",
        borderRadius: 16,
        background: "var(--ci-surface)",
        border: "1px solid var(--ci-toolbar-border)",
      }}>
        {message}
      </div>
    </div>
  );
}

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

  return <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#0a0a0c" }} />;
}

interface PanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  presentation: DetailPresentation;
  showHeader: boolean;
}

function SessionPanel({ sessionId, isOpen, onClose, presentation, showHeader }: PanelProps) {
  const isGlass = isGlassTheme(useSettingsStore((s) => s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const [hidden, setHidden] = useState(!isOpen);
  const hasOpenedRef = useRef(false);

  const {
    session,
    runner,
    runnerBadge,
    queryInputRef,
    pendingQuery,
    setPendingQuery,
    querySent,
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
    handleInstall,
    handleSwitchRunner,
    supportsPromptLaunch,
    resumeSessionId,
    isResumeLaunch,
    cliCommand,
    installCmd,
    contextEnv,
  } = useSessionRunnerController({ sessionId, isOpen });

  useEffect(() => {
    if (!isOpen) return;
    setHidden(false);
  }, [isOpen]);

  useEffect(() => {
    if (presentation !== "overlay") return;
    if (isOpen) {
      hasOpenedRef.current = true;
      invoke("resize_popup_full", { width: 700, height: 600 }).catch(() => {});
    } else if (hasOpenedRef.current) {
      invoke("restore_popup_bounds").catch(() => {});
    }
  }, [isOpen, presentation]);

  useEffect(() => {
    if (isOpen && !querySent) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, querySent, queryInputRef]);

  if (!session) return null;

  const waitingForPtyLaunch = querySent && !ptyEverActive && !isResumeLaunch;
  const cliBaseArgs: string[] =
    runner.type === "claude-code"
      ? (resumeSessionId
          ? ["--resume", resumeSessionId, "--dangerously-skip-permissions"]
          : ["--dangerously-skip-permissions"])
      : (resumeSessionId ? ["resume", resumeSessionId] : []);

  const isOverlay = presentation === "overlay";
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
        position: isOverlay ? "fixed" : "absolute",
        top: isOverlay ? 6 : 0,
        left: isOverlay ? 6 : 0,
        right: isOverlay ? 6 : 0,
        bottom: isOverlay ? 6 : 0,
        zIndex: hidden ? -1 : isOverlay ? 200 : 1,
        borderRadius: isOverlay ? panelRadius : 0,
        overflow: "hidden",
        background: panelBackground,
        backdropFilter: isGlass && !isOverlay ? "none" : isGlass ? "none" : "blur(48px) saturate(1.5)",
        WebkitBackdropFilter: isGlass && !isOverlay ? "none" : isGlass ? "none" : "blur(48px) saturate(1.5)",
        border: isOverlay ? panelBorder : "none",
        display: "flex",
        flexDirection: "column",
        visibility: hidden ? "hidden" : "visible",
        textShadow,
      }}
    >
      {showHeader && (
        <div
          data-tauri-drag-region={isOverlay ? "true" : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px 10px",
            borderBottom: titlebarBorder,
            flexShrink: 0,
            cursor: isOverlay ? "grab" : "default",
            userSelect: "none",
            WebkitUserSelect: "none",
            background: titlebarBackground,
          }}
        >
          {isOverlay ? <TrafficLights onClose={onClose} size={12} gap={6} /> : <div style={{ width: 54, flexShrink: 0 }} />}

          <span data-tauri-drag-region={isOverlay ? "true" : undefined} style={{
            flex: 1, fontSize: 12, fontWeight: 600,
            color: titlebarText,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            cursor: isOverlay ? "grab" : "default",
            letterSpacing: -0.2,
          }}>
            {installing ? `正在安装 ${runnerBadge}…` : session.name}
          </span>

          <span
            data-tauri-drag-region={isOverlay ? "true" : undefined}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 99,
              background: runnerChipBackground,
              border: runnerChipBorder,
              color: runnerChipText, fontFamily: "monospace",
              cursor: "default",
            }}
          >
            {runnerBadge}
          </span>

          {installing && (
            <button
              data-tauri-drag-region={isOverlay ? "true" : undefined}
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
              data-tauri-drag-region={isOverlay ? "true" : undefined}
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
      )}

      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        <SessionRunnerSurface
          isGlass={isGlass}
          isOpen={isOpen}
          installing={installing}
          installId={installId}
          installCmd={installCmd}
          recheckCli={recheckCli}
          querySent={querySent}
          ptyEverActive={ptyEverActive}
          sessionId={sessionId}
          cliCommand={cliCommand}
          cliBaseArgs={cliBaseArgs}
          workdir={session.workdir}
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
          animate={(!querySent || waitingForPtyLaunch) && !installing ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96, pointerEvents: "none" as const }}
          transition={{ duration: 0.18 }}
          style={{ position: "absolute", inset: 0 }}
        >
          {(!querySent || waitingForPtyLaunch) && !installing && (
            <SessionPromptComposer
              pendingQuery={pendingQuery}
              setPendingQuery={setPendingQuery}
              queryInputRef={queryInputRef}
              querySent={querySent}
              waitingForPtyLaunch={waitingForPtyLaunch}
              runnerType={runner.type}
              runnerBadge={runnerBadge}
              cliAvailable={cliAvailable}
              cliCommand={cliCommand}
              installCmd={installCmd}
              isGlass={isGlass}
              launchDisabled={waitingForPtyLaunch}
              handleSwitchRunner={handleSwitchRunner}
              handleInstall={handleInstall}
            />
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export function SessionDetail({
  mode,
  emptyState,
  openSessionId,
  showPanelHeader = true,
}: {
  mode: DetailPresentation;
  emptyState?: ReactNode;
  openSessionId?: string | null;
  showPanelHeader?: boolean;
}) {
  const { expandedSessionId, setExpandedSession, sessions } = useSessionStore();
  const visibleSessionId = openSessionId === undefined ? expandedSessionId : openSessionId;

  const [mountedIds, setMountedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!visibleSessionId) return;
    setMountedIds((prev) =>
      prev.includes(visibleSessionId) ? prev : [...prev, visibleSessionId]
    );
  }, [visibleSessionId]);

  useEffect(() => {
    const sessionIds = new Set(sessions.map((s) => s.id));
    setMountedIds((prev) => prev.filter((id) => sessionIds.has(id)));
  }, [sessions]);

  useEffect(() => {
    if (mode !== "overlay" || !visibleSessionId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSession(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, visibleSessionId, setExpandedSession]);

  if (mode === "embedded") {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" }}>
        {mountedIds.map((sid) => (
          <SessionPanel
            key={sid}
            sessionId={sid}
            isOpen={visibleSessionId === sid}
            onClose={() => setExpandedSession(null)}
            presentation="embedded"
            showHeader={showPanelHeader}
          />
        ))}
        {!visibleSessionId && (
          emptyState ? <>{emptyState}</> : <SessionDetailEmptyState message="选择一个会话以在右侧打开终端。" />
        )}
      </div>
    );
  }

  return (
    <>
      {mountedIds.map((sid) => (
        <SessionPanel
          key={sid}
          sessionId={sid}
          isOpen={visibleSessionId === sid}
          onClose={() => setExpandedSession(null)}
          presentation="overlay"
          showHeader={showPanelHeader}
        />
      ))}
    </>
  );
}
