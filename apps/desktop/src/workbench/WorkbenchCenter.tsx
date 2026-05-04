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

function WelcomeAction({ label, accent = false, onClick }: { label: string; accent?: boolean; onClick: () => void }) {
  return (
    <button
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        background: "none",
        border: "none",
        padding: "4px 2px",
        color: accent ? "var(--ci-accent)" : "var(--ci-text-muted)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
    >
      {label}
    </button>
  );
}

function WelcomeList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function WelcomeEntry({
  title,
  detail,
  action,
  onClick,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "start",
        gap: 18,
        padding: "10px 8px",
        borderTop: "1px solid var(--ci-toolbar-border)",
        transition: "background 0.12s",
        cursor: onClick ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--ci-list-hover-bg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ci-text)" }}>{title}</div>
        {detail && <div style={{ marginTop: 3, fontSize: 11, color: "var(--ci-text-dim)", lineHeight: 1.6 }}>{detail}</div>}
      </div>
      {action && <div data-no-window-drag="true" style={{ flexShrink: 0, alignSelf: "center" }}>{action}</div>}
    </div>
  );
}

function handleWindowDragPointerDown(event: ReactPointerEvent<HTMLElement>) {
  if (!("__TAURI_INTERNALS__" in window) || event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, option, label, a[href], [role='button'], [contenteditable='true'], [data-no-window-drag='true']")) {
    return;
  }
  void getCurrentWindow().startDragging().catch(() => {});
}

function WorkbenchWelcome({ session }: { session: ClaudeSession | null }) {
  const showWorkflowSurface = useWorkbenchStore((s) => s.showWorkflow);
  const { t } = useAppI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const sessions = useSessionStore((s) => s.sessions);
  const daemon = useDaemonData();
  const runner = sanitizeRunnerConfig(useSettingsStore((s) => s.settings.runner));
  const hasWorkspace = workspaces.length > 0;
  const recentSessions = activeWorkspace
    ? sessions.filter((item) => item.workspaceId === activeWorkspace.id).slice(0, 5)
    : [];
  const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId).slice(0, 4);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      setCompactHeader(element.clientWidth < 560);
    });

    observer.observe(element);
    setCompactHeader(element.clientWidth < 560);
    return () => observer.disconnect();
  }, []);

  const handleAddWorkspace = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const picked = await invoke<string>("pick_folder").catch(() => "");
    const trimmed = picked.trim();
    if (!trimmed) return;
    const workspaceId = addWorkspace(trimmed);
    await invoke("clear_deleted_items", {
      sessionIds: [],
      workspaceIds: [],
      sessionRefs: [],
      workspaceRefs: [{ workspaceId, path: trimmed }],
    }).catch(() => {});
    await invoke("trust_workspace", { path: trimmed }).catch(() => {});
    void syncWorkspaceToDaemon({
      id: workspaceId,
      name: trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed,
      path: trimmed,
      color: "blue",
      createdAt: Date.now(),
      order: 0,
    }).catch(() => {});
  };

  const handleNewSession = async () => {
    if (!activeWorkspace) return;

    try {
      const created = await createDaemonSession({
        workspace: activeWorkspace,
        runnerType: runner.type,
      });
      await daemon.refreshSessionViews(created.sessionId);
      await daemon.refreshTaskViews(created.taskId);
      await showSessionSurface(created.sessionId);
    } catch {
      return;
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto" }}>
      <div ref={containerRef} style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: compactHeader ? "24px 18px 32px" : "36px 30px 44px", boxSizing: "border-box" }}>
        {!compactHeader && (
          <div
            data-tauri-drag-region
            onPointerDown={handleWindowDragPointerDown}
            style={{ cursor: "grab", userSelect: "none", WebkitUserSelect: "none" }}
          >
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {t("workbench.welcome.getStarted")}
            </div>
            <div style={{ marginTop: 8, fontSize: 26, fontWeight: 700, color: "var(--ci-text)", letterSpacing: -0.5, lineHeight: 1.15 }}>
              {hasWorkspace ? (activeWorkspace ? activeWorkspace.name : t("workbench.welcome.welcome")) : t("workbench.welcome.noWorkspace")}
            </div>
            <div style={{ marginTop: 8, maxWidth: 520, fontSize: 12, color: "var(--ci-text-muted)", lineHeight: 1.7 }}>
              {hasWorkspace ? t("workbench.welcome.chooseWhereToContinue") : t("workbench.welcome.addProjectToBegin")}
            </div>
          </div>
        )}

        <div style={{ marginTop: compactHeader ? 0 : 30, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: compactHeader ? 24 : 36 }}>
          {hasWorkspace ? (
            <>
              <WelcomeList title={t("workbench.welcome.start")}>
                {session ? (
                  <>
                    <WelcomeEntry
                      title={t("workbench.welcome.openCurrentSession")}
                      detail={t("workbench.welcome.continueActiveTerminal")}
                      onClick={() => showSessionSurface(session.id)}
                      action={<WelcomeAction label={t("workbench.welcome.open")} accent onClick={() => showSessionSurface(session.id)} />}
                    />
                    <WelcomeEntry
                      title={t("workbench.welcome.openExplorer")}
                      detail={t("workbench.welcome.browseFiles")}
                      onClick={() => showExplorer(session.id)}
                      action={<WelcomeAction label={t("workbench.explorer")} onClick={() => showExplorer(session.id)} />}
                    />
                    <WelcomeEntry
                      title={t("workbench.welcome.openSourceControl")}
                      detail={t("workbench.welcome.reviewChanges")}
                      onClick={() => showScm(session.id)}
                      action={<WelcomeAction label={t("workbench.welcome.scm")} onClick={() => showScm(session.id)} />}
                    />
                    <WelcomeEntry
                      title={t("workbench.welcome.openWorkflow")}
                      detail={t("workbench.welcome.reviewWorkflowBeforeRun")}
                      onClick={() => showWorkflow(session.id)}
                      action={<WelcomeAction label={t("workbench.workflow")} onClick={() => showWorkflow(session.id)} />}
                    />
                  </>
                ) : (
                  <>
                    <WelcomeEntry
                      title={t("workbench.welcome.createOrChooseSession")}
                      detail={t("workbench.welcome.useSidebarOrCreate")}
                      onClick={() => { void handleNewSession(); }}
                      action={<WelcomeAction label={t("workbench.welcome.new")} accent onClick={() => { void handleNewSession(); }} />}
                    />
                    <WelcomeEntry
                      title={t("workbench.welcome.openWorkflow")}
                      detail={t("workbench.welcome.workflowWithoutSession")}
                      onClick={() => showWorkflowSurface(null, null)}
                      action={<WelcomeAction label={t("workbench.workflow")} onClick={() => showWorkflowSurface(null, null)} />}
                    />
                  </>
                )}
              </WelcomeList>
              <WelcomeList title={t("workbench.welcome.recent")}>
                {recentSessions.length > 0 ? recentSessions.map((recent) => (
                  <WelcomeEntry
                    key={recent.id}
                    title={recent.name}
                    detail={recent.currentTask || undefined}
                    onClick={() => showSessionSurface(recent.id)}
                    action={<WelcomeAction label={t("workbench.welcome.open")} onClick={() => showSessionSurface(recent.id)} />}
                  />
                )) : (
                  <WelcomeEntry title={t("workbench.welcome.noRecentSessions")} detail={t("workbench.welcome.recentWillAppear")} />
                )}
              </WelcomeList>
            </>
          ) : (
            <>
              <WelcomeList title={t("workbench.welcome.start")}>
                <WelcomeEntry
                  title={t("workbench.welcome.addWorkspace")}
                  detail={t("workbench.welcome.chooseProjectFolder")}
                  onClick={() => { void handleAddWorkspace(); }}
                  action={<WelcomeAction label={t("workbench.welcome.add")} accent onClick={() => { void handleAddWorkspace(); }} />}
                />
                <WelcomeEntry title={t("workbench.welcome.createSession")} detail={t("workbench.welcome.availableAfterWorkspace")} />
              </WelcomeList>
              <WelcomeList title={t("workbench.welcome.overview")}>
                <WelcomeEntry title={t("workbench.welcome.explorerAndScm")} detail={t("workbench.welcome.appearAfterWorkspace")} />
                <WelcomeEntry title={t("workbench.welcome.splitWorkbench")} detail={t("workbench.welcome.splitWorkbenchDetail")} />
              </WelcomeList>
            </>
          )}
        </div>

        {hasWorkspace && otherWorkspaces.length > 0 && (
          <div style={{ marginTop: 34, maxWidth: 520 }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {t("workbench.welcome.otherWorkspaces")}
            </div>
            <div style={{ marginTop: 10 }}>
              {otherWorkspaces.map((workspace) => {
                const workspaceSessions = sessions.filter((item) => item.workspaceId === workspace.id);
                const topSession = workspaceSessions[0] ?? null;
                return (
                  <div
                    key={workspace.id}
                    onClick={() => useWorkspaceStore.getState().bringToFront(workspace.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "8px 8px", borderTop: "1px solid var(--ci-toolbar-border)", transition: "background 0.12s", cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--ci-list-hover-bg)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11.5, color: "var(--ci-text-muted)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {workspace.name}
                      </div>
                      {topSession && (
                        <div style={{ marginTop: 2, fontSize: 10, color: "var(--ci-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {topSession.name}
                        </div>
                      )}
                    </div>
                    <WelcomeAction label={t("workbench.welcome.switch")} onClick={() => useWorkspaceStore.getState().bringToFront(workspace.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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

  if (centerSurface === "session" || centerSurface === "editor" || centerSurface === "diff") {
    return <SessionObjectPanel session={session} onRefreshDiff={onRefreshDiff} />;
  }

  return <WorkbenchWelcome session={session} />;
}
