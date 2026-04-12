import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClaudeSession, SessionStatus, orderWorkspaceSessions, useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore, getWorkspaceColor, workspaceTargetLabel } from "../store/workspaceStore";
import { useSettingsStore, RUNNER_LABELS, sanitizeRunnerConfig, isGlassTheme } from "../store/settingsStore";

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

function StatusDot({ status, isGlass }: { status: SessionStatus; isGlass: boolean }) {
  const { dotColor, pulse } = STATUS_CONFIG[status];
  return (
    <div style={{ position: "relative", width: 9, height: 9, flexShrink: 0 }}>
      <div style={{
        width: 9, height: 9, borderRadius: "50%",
        background: dotColor, position: "absolute",
      }} />
      {pulse && !isGlass && (
        <motion.div
          animate={{ scale: [1, 2.0], opacity: [0.6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          style={{
            width: 9, height: 9, borderRadius: "50%",
            background: dotColor, position: "absolute",
          }}
        />
      )}
    </div>
  );
}

// ── Session 卡片 ─────────────────────────────────────────────
function SessionCard({
  session, isActive, accentColor, isGlass, onClick, onExpand, onRemove, onRotateSuspend,
}: {
  session: ClaudeSession;
  isActive: boolean;
  accentColor: string;
  isGlass: boolean;
  onClick: () => void;
  onExpand: () => void;
  onRemove: () => void;
  onRotateSuspend: () => void;
}) {
  const runnerLabel = RUNNER_LABELS[session.runner.type];
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === session.workspaceId));
  const terminalHostLabel = session.terminalHost === "external"
    ? "外部终端"
    : session.terminalHost === "headless"
    ? "仅管理"
    : "内置终端";
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
        background: isActive
          ? "var(--ci-accent-bg)"
          : isWaiting
          ? "var(--ci-yellow-bg)"
          : isSuspended
          ? "var(--ci-btn-ghost-bg)"
          : isError
          ? "var(--ci-deleted-bg)"
          : "transparent",
        border: isActive
          ? `1px solid ${accentColor}45`
          : isWaiting
          ? "1px solid var(--ci-yellow-bdr)"
          : isSuspended
          ? "1px solid var(--ci-border-med)"
          : isError
          ? "1px solid var(--ci-border-med)"
          : "1px solid var(--ci-toolbar-border)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: isGlass ? "border-color 0.15s, color 0.15s" : "background 0.15s, border-color 0.15s",
        boxShadow: "none",
        textShadow,
      }}
    >
      {/* 左侧状态色条 */}
      {cfg.leftAccent && (
        <div style={{
          position: "absolute",
          left: 0, top: 5, bottom: 5,
          width: 3, borderRadius: 99,
          background: cfg.leftAccent,
          opacity: 0.8,
        }} />
      )}

      {/* waiting 状态：脉冲边框 */}
      {isWaiting && !isGlass && (
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute", inset: 0, borderRadius: 10,
            border: "1px solid var(--ci-yellow-bdr)",
            pointerEvents: "none",
          }}
        />
      )}

      <StatusDot status={session.status} isGlass={isGlass} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{
            color: isActive ? "var(--ci-text)" : isWaiting ? "var(--ci-text)" : "var(--ci-text-muted)",
            fontSize: 12, fontWeight: isWaiting ? 700 : 600,
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
          <span style={{
            fontSize: 9.5, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-surface)",
            border: "1px solid var(--ci-border)",
            color: "var(--ci-text-dim)",
            flexShrink: 0, fontWeight: 600,
          }}>
            {terminalHostLabel}
          </span>
          <span style={{
            fontSize: 9.5, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-surface)",
            border: "1px solid var(--ci-border)",
            color: "var(--ci-text-dim)",
            flexShrink: 0, fontWeight: 600,
          }}>
            {workspace ? workspaceTargetLabel(workspace) : "本地"}
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
        {isWaiting && !isGlass && (
          <motion.p
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              margin: "2px 0 0", fontSize: 11,
              color: "var(--ci-yellow-dark)",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>⚡</span>
            点击展开终端查看并输入
          </motion.p>
        )}
        {isWaiting && isGlass && (
          <p
            style={{
              margin: "2px 0 0", fontSize: 11,
              color: "var(--ci-yellow-dark)",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>⚡</span>
            点击展开终端查看并输入
          </p>
        )}

        {/* 运行中：当前任务 */}
        {!isWaiting && session.currentTask && (
          <p style={{
            margin: "2px 0 0", fontSize: 11,
            color: isRunning
              ? "var(--ci-green-dark)"
              : isError
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
              ⎇ {session.branchName.replace("ci/", "")}
            </span>
            {session.diffFiles.length > 0 && (
              <>
                <span style={{ opacity: 0.35 }}>·</span>
                <span style={{ color: "var(--ci-green-dark)", fontWeight: 600 }}>
                  +{session.diffFiles.reduce((s, f) => s + f.additions, 0)}
                </span>
                <span style={{ color: "var(--ci-deleted-text)", fontWeight: 600 }}>
                  −{session.diffFiles.reduce((s, f) => s + f.deletions, 0)}
                </span>
              </>
            )}
          </p>
        )}

        {!session.branchName && session.diffFiles.length > 0 && (
          <p style={{
            margin: "2px 0 0", fontSize: 10,
            color: "var(--ci-text-dim)",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {session.diffFiles.length} 变更{" "}
            <span style={{ color: "var(--ci-green-dark)", fontWeight: 600 }}>
              +{session.diffFiles.reduce((s, f) => s + f.additions, 0)}
            </span>{" "}
            <span style={{ color: "var(--ci-deleted-text)", fontWeight: 600 }}>
              −{session.diffFiles.reduce((s, f) => s + f.deletions, 0)}
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

      {/* 展开终端 */}
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

      {/* 删除 */}
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
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runner = sanitizeRunnerConfig(useSettingsStore((s) => s.settings.runner));
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
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
    const id = addSession(
      activeWorkspace.id,
      activeWorkspace.path,
      undefined,
      { ...runner },
      activeWorkspace.defaultTerminalHost
    );
    setExpandedSession(id);

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

  const handleRemoveSession = (session: ClaudeSession) => {
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
                      isActive={session.id === activeSessionId}
                      accentColor={accentColor}
                      isGlass={isGlass}
                      onClick={() => setActiveSession(session.id)}
                      onExpand={() => {
                        setActiveSession(session.id);
                        setExpandedSession(session.id);
                      }}
                      onRemove={() => handleRemoveSession(session)}
                      onRotateSuspend={() => {
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
