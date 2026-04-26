import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppI18n } from "../i18n";
import { ClaudeSession, SessionStatus, orderWorkspaceSessions, useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore, getWorkspaceColor } from "../store/workspaceStore";
import { useSettingsStore, RUNNER_LABELS, sanitizeRunnerConfig, isGlassTheme } from "../store/settingsStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { showExplorer, showSessionSurface } from "../services/workbenchCommands";
import { createDaemonSession, stopDaemonSession } from "../services/daemonCommands";

// ── 状态配置（使用 CSS 变量）────────────────────────────────
const STATUS_CONFIG: Record<SessionStatus, {
  dotColor: string;
  pulse: boolean;
  labelKey: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  leftAccent?: string;
}> = {
  running: {
    dotColor: "#34C759", pulse: true, labelKey: "status.running",
    badgeBg: "var(--ci-green-bg)",
    badgeBorder: "var(--ci-green-bdr)",
    badgeText: "var(--ci-green-dark)",
    leftAccent: "#34C759",
  },
  waiting: {
    dotColor: "#FF9F0A", pulse: true, labelKey: "status.waiting",
    badgeBg: "var(--ci-yellow-bg)",
    badgeBorder: "var(--ci-yellow-bdr)",
    badgeText: "var(--ci-yellow-dark)",
    leftAccent: "#FF9F0A",
  },
  suspended: {
    dotColor: "#6B7280", pulse: false, labelKey: "status.suspended",
    badgeBg: "var(--ci-btn-ghost-bg)",
    badgeBorder: "var(--ci-border-med)",
    badgeText: "var(--ci-text-dim)",
    leftAccent: "#6B7280",
  },
  idle: {
    dotColor: "rgba(120,120,128,0.3)", pulse: false, labelKey: "status.idle",
    badgeBg: "var(--ci-btn-ghost-bg)",
    badgeBorder: "var(--ci-border)",
    badgeText: "var(--ci-text-dim)",
  },
  done: {
    dotColor: "#007AFF", pulse: false, labelKey: "status.done",
    badgeBg: "var(--ci-accent-bg)",
    badgeBorder: "var(--ci-accent-bdr)",
    badgeText: "var(--ci-accent)",
  },
  error: {
    dotColor: "#FF3B30", pulse: false, labelKey: "status.error",
    badgeBg: "var(--ci-deleted-bg)",
    badgeBorder: "var(--ci-border-med)",
    badgeText: "var(--ci-deleted-text)",
    leftAccent: "#FF3B30",
  },
};

// ── 展开图标 ─────────────────────────────────────────────────
const ExpandIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: "block" }}>
    <path d="M1.5 9.5L9.5 1.5M9.5 1.5H4.5M9.5 1.5V6.5"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function StatusDot({ status }: { status: SessionStatus }) {
  const { dotColor } = STATUS_CONFIG[status];
  return <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />;
}

// ── Session 卡片 ─────────────────────────────────────────────
function SessionCard({
  session, isSelected, isOpened, accentColor, isGlass, showExpandButton, isDeleteConfirming, onClick, onCancelDelete, onExpand, onOpenExplore, onRemove, onRotateSuspend,
}: {
  session: ClaudeSession;
  isSelected: boolean;
  isOpened: boolean;
  accentColor: string;
  isGlass: boolean;
  showExpandButton: boolean;
  isDeleteConfirming: boolean;
  onClick: () => void;
  onCancelDelete: () => void;
  onExpand: () => void;
  onOpenExplore: () => void;
  onRemove: () => void;
  onRotateSuspend: () => void;
}) {
  const { t } = useAppI18n();
  const [hovered, setHovered] = useState(false);
  const runnerLabel = RUNNER_LABELS[session.runner.type];
  const cfg = STATUS_CONFIG[session.status];
  const isWaiting = session.status === "waiting";
  const isSuspended = session.status === "suspended";
  const isRunning = session.status === "running";
  const isError   = session.status === "error";
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const showActions = hovered || isSelected || isOpened || isDeleteConfirming;
  const showSecondary = hovered || isSelected || isOpened || isDeleteConfirming;
  const rowBackground = isDeleteConfirming
    ? "var(--ci-deleted-bg)"
    : isOpened
    ? "var(--ci-list-active-bg)"
    : hovered || isSelected
    ? "var(--ci-list-hover-bg)"
    : "transparent";
  const nameColor = isOpened || isSelected || hovered || isWaiting ? "var(--ci-text)" : "var(--ci-text-muted)";
  const showRunner = hovered || isSelected || isOpened;
  const runnerColor = hovered || isSelected || isOpened ? "var(--ci-text-muted)" : "var(--ci-text-dim)";
  const runnerOpacity = hovered || isSelected || isOpened ? 0.95 : 0;
  const iconButtonStyle = {
    background: "var(--ci-btn-ghost-bg)",
    border: "1px solid transparent",
    color: "var(--ci-text-dim)",
    cursor: "pointer",
    padding: "3px 5px",
    borderRadius: 5,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;
  return (
    <motion.div
      layout
      layoutId={`session-card-${session.id}`}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6, height: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px 6px 10px",
        borderRadius: 7,
        background: rowBackground,
        border: isDeleteConfirming ? "1px solid rgba(255,59,48,0.24)" : "1px solid transparent",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "background 0.12s, border-color 0.12s",
        textShadow,
      }}
    >
      {isOpened && (
        <div style={{
          position: "absolute",
          insetInlineStart: 0,
          top: 4,
          bottom: 4,
          width: 2,
          borderRadius: 99,
          background: accentColor,
        }} />
      )}

      <StatusDot status={session.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{
            color: nameColor,
            fontSize: 11.5,
            fontWeight: isOpened ? 700 : 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}>
            {session.name}
          </span>
          <span style={{
            fontSize: 9.5,
            color: runnerColor,
            opacity: runnerOpacity,
            maxWidth: showRunner ? 80 : 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            flexShrink: 0,
            transition: "opacity 0.12s, color 0.12s, max-width 0.12s",
          }}>
            {runnerLabel}
          </span>
          {session.status !== "idle" && (
            <span style={{
              fontSize: 8.5,
              padding: "1px 5px",
              borderRadius: 99,
              background: cfg.badgeBg,
              border: `1px solid ${cfg.badgeBorder}`,
              color: cfg.badgeText,
              flexShrink: 0,
              fontWeight: 600,
            }}>
              {t(cfg.labelKey)}
            </span>
          )}
        </div>

        {showSecondary && (session.currentTask ? (
          <p style={{
            margin: "1px 0 0",
            fontSize: 10,
            color: isError ? "var(--ci-deleted-text)" : "var(--ci-text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {isRunning && <span style={{ marginRight: 3 }}>›</span>}
            {session.currentTask}
          </p>
        ) : session.branchName ? (
          <p style={{
            margin: "1px 0 0",
            fontSize: 9.5,
            color: "var(--ci-text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            <span style={{ fontFamily: "monospace" }}>⎇ s-{session.id}</span>
          </p>
        ) : null)}
      </div>

      {isDeleteConfirming ? (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            onMouseEnter={e => {
              e.currentTarget.style.opacity = "0.8";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.opacity = "1";
            }}
            style={{
              background: "none",
              border: "none",
              padding: "3px 2px",
              color: "var(--ci-red)",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.12s",
            }}
          >
            {t("session.confirmDelete")}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setHovered(false); onCancelDelete(); }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            style={{
              background: "none",
              border: "none",
              padding: "3px 2px",
              color: "var(--ci-text-muted)",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              transition: "color 0.12s, opacity 0.12s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "var(--ci-text)";
              e.currentTarget.style.opacity = "0.8";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "var(--ci-text-muted)";
              e.currentTarget.style.opacity = "1";
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
          opacity: showActions ? 1 : 0,
          pointerEvents: showActions ? "auto" : "none",
          transition: "opacity 0.12s",
        }}>
          {(isWaiting || isSuspended) && (
            <button
              onClick={(e) => { e.stopPropagation(); onRotateSuspend(); }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = "var(--ci-text)";
                e.currentTarget.style.opacity = "0.8";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = isSuspended ? "#6B7280" : "var(--ci-text-dim)";
                e.currentTarget.style.opacity = "1";
              }}
              title={isWaiting ? t("session.suspend") : t("session.resumeToWaiting")}
              style={{
                background: "none",
                border: "none",
                padding: "3px 2px",
                color: isSuspended ? "#6B7280" : "var(--ci-text-dim)",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                transition: "color 0.12s, opacity 0.12s",
              }}
            >
              {isWaiting ? t("session.suspend") : t("session.resume")}
            </button>
          )}

          {(isSelected || isOpened) && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenExplore(); }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title={t("session.openFileTree")}
              style={iconButtonStyle}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
                <path d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h3.1c.32 0 .63.13.85.35l.8.8c.23.22.53.35.85.35H13a1.25 1.25 0 0 1 1.25 1.25v6.5A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25v-8Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          {showExpandButton && (
            <button
              onClick={(e) => { e.stopPropagation(); onExpand(); }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title={t("session.expandTerminal")}
              style={{
                ...iconButtonStyle,
                background: isWaiting ? "var(--ci-yellow-bg)" : "var(--ci-btn-ghost-bg)",
                border: isWaiting ? "1px solid var(--ci-yellow-bdr)" : "1px solid transparent",
                color: isWaiting ? "var(--ci-yellow-dark)" : "var(--ci-text-dim)",
              }}
            >
              <ExpandIcon />
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title={t("session.removeSession")}
            style={{
              ...iconButtonStyle,
              background: "transparent",
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}
    </motion.div>
  );
}

function SortableSessionCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : 1,
    position: "relative",
    touchAction: "none",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// ── 主组件：SessionList ───────────────────────────────────────
export function SessionList() {
  const { t } = useAppI18n();
  const {
    sessions,
    activeSessionId,
    expandedSessionId,
    sessionOrderByWorkspace,
    removeSession,
    setActiveSession,
    setExpandedSession,
    addSession,
    markWorktreeReady,
    reorderWorkspaceSessionsByVisibleMove,
    updateSession,
  } = useSessionStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const focusSession = useWorkbenchStore((s) => s.focusSession);
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runner = sanitizeRunnerConfig(useSettingsStore((s) => s.settings.runner));
  const settings = useSettingsStore((s) => s.settings);
  const isGlass = isGlassTheme(settings.theme);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";

  const accentColor = activeWorkspace ? getWorkspaceColor(activeWorkspace.color) : "var(--ci-accent)";
  const wsSessions = useMemo(() => {
    if (!activeWorkspace) return [];
    return orderWorkspaceSessions(sessions, activeWorkspace.id, sessionOrderByWorkspace);
  }, [activeWorkspace, sessions, sessionOrderByWorkspace]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!activeWorkspace) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    reorderWorkspaceSessionsByVisibleMove(
      activeWorkspace.id,
      String(active.id),
      String(over.id)
    );
  };

  const handleNewSession = async () => {
    if (!activeWorkspace) return;

    if ("__TAURI_INTERNALS__" in window) {
      try {
        const created = await createDaemonSession({
          workspace: activeWorkspace,
          runnerType: runner.type,
        });
        addSession(created.sessionId, activeWorkspace.id, created.worktree?.path ?? activeWorkspace.path, undefined, { ...runner });
        useSessionStore.getState().updateSession(created.sessionId, {
          workdir: created.worktree?.path ?? activeWorkspace.path,
          worktreePath: created.worktree?.path,
          branchName: created.worktree?.branchName,
          baseBranch: created.worktree?.baseBranch,
          taskId: created.taskId,
        });
        setActiveSession(created.sessionId);
        setExpandedSession(created.sessionId);
        focusSession(created.sessionId);
        markWorktreeReady(created.sessionId);
        return;
      } catch (e) {
        console.warn("[daemon] create session failed:", e);
        return;
      }
    }

    const maxId = sessions
      .map((session) => Number(session.id))
      .filter((value) => !Number.isNaN(value))
      .reduce((max, value) => Math.max(max, value), 0);
    const id = String(maxId + 1);
    addSession(id, activeWorkspace.id, activeWorkspace.path, undefined, { ...runner });
    setActiveSession(id);
    setExpandedSession(id);
    focusSession(id);
    markWorktreeReady(id);
  };

  const handleRemoveSession = async (session: ClaudeSession) => {
    setPendingDeleteSessionId(null);

    if ("__TAURI_INTERNALS__" in window) {
      await stopDaemonSession(session.id).catch((e) => {
        console.warn("[daemon] stop session failed:", e);
      });
      await invoke("mark_deleted_items", {
        sessionIds: [session.id],
        workspaceIds: [],
        sessionRefs: [{ sessionId: session.id, workspaceId: session.workspaceId }],
        workspaceRefs: [],
      }).catch((e) => {
        console.warn("[ui-state] mark deleted session failed:", e);
      });
      await invoke("remove_session_workdir", {
        sessionId: session.id,
      }).catch((e) => {
        console.warn("[session-files] remove workdir failed:", e);
      });
    }

    removeSession(session.id);

    const workspacePath = activeWorkspace?.path;
    if (!("__TAURI_INTERNALS__" in window) || !workspacePath || !session.worktreePath || !session.branchName) {
      return;
    }

    invoke("teardown_session_worktree", {
      workdir: workspacePath,
      worktreePath: session.worktreePath,
      branch: session.branchName,
    }).catch((e) => {
      console.warn("[worktree] teardown failed:", e);
    });
  };

  if (!activeWorkspace) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* 区域头 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 0 8px",
        marginTop: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: accentColor, flexShrink: 0,
          }} />
          <span style={{
            fontSize: 11, color: "var(--ci-text-dim)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            {t("session.listTitle")}
          </span>
        </div>

        <button
          onClick={handleNewSession}
          style={{
            background: "none",
            border: "none",
            borderRadius: 0,
            padding: "6px 2px",
            color: "var(--ci-accent)",
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
            transition: "color 0.12s, opacity 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = "var(--ci-accent)";
            e.currentTarget.style.opacity = "0.78";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = "var(--ci-accent)";
            e.currentTarget.style.opacity = "1";
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
          <span>{t("session.createNew")}</span>
        </button>
      </div>

          {/* Session 列表 */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={wsSessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <AnimatePresence>
                {wsSessions.map((session) => (
                  <SortableSessionCard key={session.id} id={session.id}>
                    <SessionCard
                      session={session}
                      isSelected={session.id === activeSessionId}
                      isOpened={session.id === expandedSessionId}
                      accentColor={accentColor}
                      isGlass={isGlass}
                      showExpandButton={false}
                      isDeleteConfirming={pendingDeleteSessionId === session.id}
                      onClick={() => {
                        setPendingDeleteSessionId(null);
                        showSessionSurface(session.id);
                      }}
                      onCancelDelete={() => {
                        setPendingDeleteSessionId(null);
                      }}
                      onExpand={() => {
                        setPendingDeleteSessionId(null);
                        showSessionSurface(session.id);
                      }}
                      onOpenExplore={() => {
                        setPendingDeleteSessionId(null);
                        showExplorer(session.id);
                      }}
                      onRemove={() => {
                        if (pendingDeleteSessionId === session.id) {
                          void handleRemoveSession(session);
                          return;
                        }
                        setPendingDeleteSessionId(session.id);
                      }}
                      onRotateSuspend={() => {
                        setPendingDeleteSessionId(null);
                        updateSession(session.id, {
                          status: session.status === "waiting" ? "suspended" : "waiting",
                        });
                      }}
                    />
                  </SortableSessionCard>
                ))}
              </AnimatePresence>
            </SortableContext>
          </DndContext>

      {wsSessions.length === 0 && (
        <div
          style={{
          textAlign: "center", padding: "12px 0 6px",
          color: "var(--ci-text-dim)", fontSize: 12,
          textShadow,
        }}>
          {t("session.emptyList")}
        </div>
      )}
    </div>
  );
}
