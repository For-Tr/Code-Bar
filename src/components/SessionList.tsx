import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClaudeSession, SessionStatus, orderWorkspaceSessions, useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore, getWorkspaceColor } from "../store/workspaceStore";
import { useSettingsStore, RUNNER_LABELS, sanitizeRunnerConfig, isGlassTheme } from "../store/settingsStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { useScmStore } from "../store/scmStore";
import { showExplorer, showSessionSurface } from "../services/workbenchCommands";

// ── 状态配置（使用 CSS 变量）────────────────────────────────
const STATUS_CONFIG: Record<SessionStatus, {
  dotColor: string;
  pulse: boolean;
  label: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  leftAccent?: string;
}> = {
  running: {
    dotColor: "#34C759", pulse: true, label: "运行中",
    badgeBg: "var(--ci-green-bg)",
    badgeBorder: "var(--ci-green-bdr)",
    badgeText: "var(--ci-green-dark)",
    leftAccent: "#34C759",
  },
  waiting: {
    dotColor: "#FF9F0A", pulse: true, label: "需要操作",
    badgeBg: "var(--ci-yellow-bg)",
    badgeBorder: "var(--ci-yellow-bdr)",
    badgeText: "var(--ci-yellow-dark)",
    leftAccent: "#FF9F0A",
  },
  suspended: {
    dotColor: "#6B7280", pulse: false, label: "已挂起",
    badgeBg: "var(--ci-btn-ghost-bg)",
    badgeBorder: "var(--ci-border-med)",
    badgeText: "var(--ci-text-dim)",
    leftAccent: "#6B7280",
  },
  idle: {
    dotColor: "rgba(120,120,128,0.3)", pulse: false, label: "空闲",
    badgeBg: "var(--ci-btn-ghost-bg)",
    badgeBorder: "var(--ci-border)",
    badgeText: "var(--ci-text-dim)",
  },
  done: {
    dotColor: "#007AFF", pulse: false, label: "已完成",
    badgeBg: "var(--ci-accent-bg)",
    badgeBorder: "var(--ci-accent-bdr)",
    badgeText: "var(--ci-accent)",
  },
  error: {
    dotColor: "#FF3B30", pulse: false, label: "出错",
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
  return <div style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />;
}

// ── Session 卡片 ─────────────────────────────────────────────
function SessionCard({
  session, isSelected, isOpened, accentColor, isGlass, showExpandButton, isDeleteConfirming, onClick, onExpand, onOpenExplore, onRemove, onRotateSuspend,
}: {
  session: ClaudeSession;
  isSelected: boolean;
  isOpened: boolean;
  accentColor: string;
  isGlass: boolean;
  showExpandButton: boolean;
  isDeleteConfirming: boolean;
  onClick: () => void;
  onExpand: () => void;
  onOpenExplore: () => void;
  onRemove: () => void;
  onRotateSuspend: () => void;
}) {
  const runnerLabel = RUNNER_LABELS[session.runner.type];
  const scmFiles = useScmStore((s) => s.snapshotBySessionId[session.id]?.files ?? session.diffFiles);
  const totalAdditions = scmFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = scmFiles.reduce((sum, file) => sum + file.deletions, 0);
  const cfg = STATUS_CONFIG[session.status];
  const isWaiting = session.status === "waiting";
  const isSuspended = session.status === "suspended";
  const isRunning = session.status === "running";
  const isError   = session.status === "error";
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";

  return (
    <motion.div
      layout
      layoutId={`session-card-${session.id}`}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6, height: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "11px 12px",
        borderRadius: 12,
        background: isOpened
          ? "var(--ci-accent-bg)"
          : "transparent",
        border: isOpened
          ? `1px solid ${accentColor}55`
          : isDeleteConfirming
          ? "1px solid var(--ci-red)"
          : showExpandButton && isSelected
          ? "1px solid var(--ci-border-med)"
          : isSuspended || isError
          ? "1px solid var(--ci-border-med)"
          : "1px solid var(--ci-toolbar-border)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: isGlass ? "border-color 0.15s, color 0.15s" : "background 0.15s, border-color 0.15s, box-shadow 0.15s",
        boxShadow: isOpened ? `0 10px 24px ${accentColor}14` : "none",
        textShadow,
      }}
    >
      {/* 左侧状态色条 */}
      {(isOpened || cfg.leftAccent) && (
        <div style={{
          position: "absolute",
          left: 0, top: 5, bottom: 5,
          width: isOpened ? 4 : 3,
          borderRadius: 99,
          background: isOpened ? accentColor : cfg.leftAccent,
          opacity: isOpened ? 1 : 0.8,
        }} />
      )}

      <StatusDot status={session.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{
            color: isOpened || isSelected || isWaiting ? "var(--ci-text)" : "var(--ci-text-muted)",
            fontSize: 12, fontWeight: isOpened || isWaiting ? 700 : 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            minWidth: 0,
          }}>
            {session.name}
          </span>
          <span style={{
            fontSize: 9.5, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-accent-bg)",
            border: "1px solid var(--ci-accent-bdr)",
            color: "var(--ci-accent)",
            flexShrink: 0, fontWeight: 600,
          }}>
            {runnerLabel}
          </span>
          {/* 状态 badge：idle 时不显示 */}
          {session.status !== "idle" && (
            <span style={{
              fontSize: 9, padding: "1px 6px", borderRadius: 99,
              background: cfg.badgeBg,
              border: `1px solid ${cfg.badgeBorder}`,
              color: cfg.badgeText,
              flexShrink: 0, fontWeight: 600,
            }}>
              {cfg.label}
            </span>
          )}
        </div>

        {/* waiting：操作提示 */}
        {isWaiting && (
          <p
            style={{
              margin: "2px 0 0", fontSize: 11,
              color: "var(--ci-text-dim)",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>⚡</span>
            {showExpandButton ? "点击展开终端查看并输入" : "点击卡片聚焦会话"}
          </p>
        )}

        {/* 运行中：当前任务 */}
        {!isWaiting && session.currentTask && (
          <p style={{
            margin: "2px 0 0", fontSize: 11,
            color: isError
              ? "var(--ci-deleted-text)"
              : "var(--ci-text-dim)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isRunning && <span style={{ marginRight: 3 }}>›</span>}
            {session.currentTask}
          </p>
        )}

        {/* Worktree 分支信息 */}
        {session.branchName && (
          <p style={{
            margin: "3px 0 0", fontSize: 10,
            color: "var(--ci-text-dim)",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{
              fontSize: 8.5, padding: "1px 6px", borderRadius: 99,
              background: "var(--ci-purple-bg)",
              border: "1px solid var(--ci-purple-bdr)",
              color: "var(--ci-purple)",
              fontFamily: "monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 140,
            }}>
              ⎇ s-{session.id}
            </span>
            {scmFiles.length > 0 && (
              <>
                <span style={{ opacity: 0.35 }}>·</span>
                <span style={{ color: "var(--ci-green-dark)", fontWeight: 600 }}>
                  +{totalAdditions}
                </span>
                <span style={{ color: "var(--ci-deleted-text)", fontWeight: 600 }}>
                  −{totalDeletions}
                </span>
              </>
            )}
          </p>
        )}

        {!session.branchName && scmFiles.length > 0 && (
          <p style={{
            margin: "2px 0 0", fontSize: 10,
            color: "var(--ci-text-dim)",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {scmFiles.length} 变更{" "}
            <span style={{ color: "var(--ci-green-dark)", fontWeight: 600 }}>
              +{totalAdditions}
            </span>{" "}
            <span style={{ color: "var(--ci-deleted-text)", fontWeight: 600 }}>
              −{totalDeletions}
            </span>
          </p>
        )}
      </div>

      {(isWaiting || isSuspended) && (
        <button
          onClick={(e) => { e.stopPropagation(); onRotateSuspend(); }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title={isWaiting ? "挂起" : "恢复为需要操作"}
          style={{
            background: isWaiting ? "var(--ci-btn-ghost-bg)" : "rgba(107,114,128,0.14)",
            border: isWaiting ? "1px solid var(--ci-border)" : "1px solid rgba(107,114,128,0.36)",
            color: isWaiting ? "var(--ci-text-dim)" : "#6B7280",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
            flexShrink: 0,
            fontSize: 11,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = isWaiting ? "rgba(107,114,128,0.14)" : "rgba(107,114,128,0.2)";
            e.currentTarget.style.borderColor = "rgba(107,114,128,0.44)";
            e.currentTarget.style.color = "#4B5563";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = isWaiting ? "var(--ci-btn-ghost-bg)" : "rgba(107,114,128,0.14)";
            e.currentTarget.style.borderColor = isWaiting ? "var(--ci-border)" : "rgba(107,114,128,0.36)";
            e.currentTarget.style.color = isWaiting ? "var(--ci-text-dim)" : "#6B7280";
          }}
        >
          {isWaiting ? "挂起" : "恢复"}
        </button>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onOpenExplore(); }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        title="打开文件树"
        style={{
          background: "var(--ci-btn-ghost-bg)",
          border: "1px solid transparent",
          color: "var(--ci-text-dim)",
          cursor: "pointer",
          padding: "4px 6px",
          borderRadius: 6,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          transition: isGlass ? "color 0.12s" : "color 0.12s, background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = accentColor;
          e.currentTarget.style.background = isGlass ? "var(--ci-btn-ghost-bg)" : `${accentColor}15`;
          e.currentTarget.style.borderColor = isGlass ? "transparent" : `${accentColor}30`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "var(--ci-text-dim)";
          e.currentTarget.style.background = "var(--ci-btn-ghost-bg)";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
          <path d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h3.1c.32 0 .63.13.85.35l.8.8c.23.22.53.35.85.35H13a1.25 1.25 0 0 1 1.25 1.25v6.5A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25v-8Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
        </svg>
      </button>

      {showExpandButton && (
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title="展开终端"
          style={{
            background: isWaiting ? "var(--ci-yellow-bg)" : "var(--ci-btn-ghost-bg)",
            border: isWaiting ? "1px solid var(--ci-yellow-bdr)" : "1px solid transparent",
            color: isWaiting ? "var(--ci-yellow-dark)" : "var(--ci-text-dim)",
            cursor: "pointer", padding: "4px 6px", borderRadius: 6,
            flexShrink: 0, display: "flex", alignItems: "center",
            transition: isGlass ? "color 0.12s" : "color 0.12s, background 0.12s, border-color 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = isWaiting ? "var(--ci-yellow)" : accentColor;
            e.currentTarget.style.background = isGlass
              ? (isWaiting ? "var(--ci-yellow-bg)" : "var(--ci-btn-ghost-bg)")
              : isWaiting
              ? "rgba(255,159,10,0.18)"
              : `${accentColor}15`;
            e.currentTarget.style.borderColor = isGlass
              ? (isWaiting ? "var(--ci-yellow-bdr)" : "transparent")
              : isWaiting
              ? "rgba(255,159,10,0.4)"
              : `${accentColor}30`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = isWaiting ? "var(--ci-yellow-dark)" : "var(--ci-text-dim)";
            e.currentTarget.style.background = isWaiting ? "var(--ci-yellow-bg)" : "var(--ci-btn-ghost-bg)";
            e.currentTarget.style.borderColor = isWaiting ? "var(--ci-yellow-bdr)" : "transparent";
          }}
        >
          <ExpandIcon />
        </button>
      )}

      {/* 删除 */}
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
            style={{
              background: "var(--ci-deleted-bg)",
              border: "1px solid rgba(255,59,48,0.28)",
              color: "var(--ci-red)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              flexShrink: 0,
            }}
          >
            确认删除
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            style={{
              background: "var(--ci-btn-ghost-bg)",
              border: "1px solid var(--ci-border)",
              color: "var(--ci-text-dim)",
              fontSize: 11,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              flexShrink: 0,
            }}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            background: "none", border: "none",
            color: "var(--ci-text-dim)", fontSize: 11,
            cursor: "pointer", padding: "2px 4px", borderRadius: 4,
            flexShrink: 0, transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = "var(--ci-red)";
            e.currentTarget.style.background = isGlass ? "none" : "var(--ci-deleted-bg)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = "var(--ci-text-dim)";
            e.currentTarget.style.background = "none";
          }}
        >✕</button>
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
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runner = sanitizeRunnerConfig(useSettingsStore((s) => s.settings.runner));
  const settings = useSettingsStore((s) => s.settings);
  const isGlass = isGlassTheme(settings.theme);
  const isSplitLayout = settings.layoutMode === "split";
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

    let id: string;
    if ("__TAURI_INTERNALS__" in window) {
      try {
        id = await invoke<string>("reserve_session_id", {
          workspaces: workspaces.map((workspace) => ({
            workspaceId: workspace.id,
            workspacePath: workspace.path,
          })),
          existingSessionIds: sessions.map((session) => session.id),
        });
      } catch (e) {
        console.warn("[ui-state] reserve session id failed:", e);
        return;
      }
    } else {
      const maxId = sessions
        .map((session) => Number(session.id))
        .filter((value) => !Number.isNaN(value))
        .reduce((max, value) => Math.max(max, value), 0);
      id = String(maxId + 1);
    }

    addSession(id, activeWorkspace.id, activeWorkspace.path, undefined, { ...runner });
    setActiveSession(id);
    setExpandedSession(id);
    focusSession(id);

    if ("__TAURI_INTERNALS__" in window) {
      await invoke("clear_deleted_items", {
        sessionIds: [id],
        workspaceIds: [],
        sessionRefs: [{ sessionId: id, workspaceId: activeWorkspace.id }],
        workspaceRefs: [],
      }).catch((e) => {
        console.warn("[ui-state] clear deleted session failed:", e);
      });
      await invoke("remember_session_workdir", {
        sessionId: id,
        workdir: activeWorkspace.path,
      }).catch((e) => {
        console.warn("[session-files] remember workdir failed:", e);
      });
    }

    if ("__TAURI_INTERNALS__" in window) {
      try {
        const result = await invoke<{
          worktree_path: string;
          branch: string;
          base_branch: string;
        } | null>("setup_session_worktree", {
          workdir: activeWorkspace.path,
          sessionId: id,
        });

        if (result) {
          await invoke("remember_session_workdir", {
            sessionId: id,
            workdir: result.worktree_path,
          }).catch((e) => {
            console.warn("[session-files] remember worktree failed:", e);
          });
          useSessionStore.getState().updateSession(id, {
            workdir: result.worktree_path,
            worktreePath: result.worktree_path,
            branchName: result.branch,
            baseBranch: result.base_branch,
          });
        }
      } catch (e) {
        console.warn("[worktree] setup failed, fallback to workdir:", e);
      }
    }
    markWorktreeReady(id);
  };

  const handleRemoveSession = async (session: ClaudeSession) => {
    setPendingDeleteSessionId(null);

    if ("__TAURI_INTERNALS__" in window) {
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
            会话
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
          <span>新建</span>
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
                      showExpandButton={!isSplitLayout}
                      isDeleteConfirming={pendingDeleteSessionId === session.id}
                      onClick={() => {
                        setPendingDeleteSessionId(null);
                        if (isSplitLayout) {
                          showSessionSurface(session.id);
                          return;
                        }
                        setActiveSession(session.id);
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
          点击「+ 新建」开始新会话
        </div>
      )}
    </div>
  );
}
