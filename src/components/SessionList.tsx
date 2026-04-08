import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeSession, SessionStatus, useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore, getWorkspaceColor } from "../store/workspaceStore";
import { useSettingsStore, RUNNER_LABELS, sanitizeRunnerConfig } from "../store/settingsStore";

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
  const { dotColor, pulse } = STATUS_CONFIG[status];
  return (
    <div style={{ position: "relative", width: 9, height: 9, flexShrink: 0 }}>
      <div style={{
        width: 9, height: 9, borderRadius: "50%",
        background: dotColor, position: "absolute",
      }} />
      {pulse && (
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
  session, isActive, accentColor, onClick, onExpand, onRemove,
}: {
  session: ClaudeSession;
  isActive: boolean;
  accentColor: string;
  onClick: () => void;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const cfg = STATUS_CONFIG[session.status];
  const isWaiting = session.status === "waiting";
  const isRunning = session.status === "running";
  const isError   = session.status === "error";

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
        padding: "9px 11px",
        borderRadius: 10,
        background: isActive
          ? "var(--ci-surface-hi)"
          : isWaiting
          ? "var(--ci-yellow-bg)"
          : isError
          ? "var(--ci-deleted-bg)"
          : "var(--ci-surface)",
        border: isActive
          ? `1px solid ${accentColor}35`
          : isWaiting
          ? "1px solid var(--ci-yellow-bdr)"
          : isError
          ? "1px solid var(--ci-border-med)"
          : "1px solid var(--ci-border)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "background 0.15s, border-color 0.15s",
        boxShadow: isActive ? "0 1px 6px rgba(0,0,0,0.07)" : "none",
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
      {isWaiting && (
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

      <StatusDot status={session.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            color: isActive ? "var(--ci-text)" : isWaiting ? "var(--ci-text)" : "var(--ci-text-muted)",
            fontSize: 12, fontWeight: isWaiting ? 700 : 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.name}
          </span>
          {/* 状态 badge：idle 时不显示 */}
          {session.status !== "idle" && (
            <span style={{
              fontSize: 9.5, padding: "1px 6px", borderRadius: 99,
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
              fontSize: 9, padding: "1px 5px", borderRadius: 99,
              background: "var(--ci-purple-bg)",
              border: "1px solid var(--ci-purple-bdr)",
              color: "var(--ci-purple)",
              fontFamily: "monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 80,
            }}>
              ⎇ {session.branchName.replace("ci/", "")}
            </span>
            {session.worktreePath && (
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 99,
                background: "var(--ci-green-bg)",
                border: "1px solid var(--ci-green-bdr)",
                color: "var(--ci-green-dark)",
              }}>
                worktree
              </span>
            )}
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
          transition: "color 0.12s, background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = isWaiting ? "var(--ci-yellow)" : accentColor;
          e.currentTarget.style.background = isWaiting
            ? "rgba(255,159,10,0.18)"
            : `${accentColor}15`;
          e.currentTarget.style.borderColor = isWaiting
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
          e.currentTarget.style.background = "var(--ci-deleted-bg)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "var(--ci-text-dim)";
          e.currentTarget.style.background = "none";
        }}
      >✕</button>
    </motion.div>
  );
}

// ── 主组件：SessionList ───────────────────────────────────────
export function SessionList() {
  const { sessions, activeSessionId, removeSession, setActiveSession, setExpandedSession, addSession, markWorktreeReady } = useSessionStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runner = sanitizeRunnerConfig(useSettingsStore((s) => s.settings.runner));
  const runnerType = runner.type;
  const runnerLabel = RUNNER_LABELS[runnerType];

  if (!activeWorkspace) return null;

  const accentColor = getWorkspaceColor(activeWorkspace.color);
  const wsSessions = sessions.filter((s) => s.workspaceId === activeWorkspaceId);

  const handleNewSession = async () => {
    const id = addSession(activeWorkspace.id, activeWorkspace.path, undefined, { ...runner });
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

    if ("__TAURI_INTERNALS__" in window && session.worktreePath && session.branchName) {
      invoke("teardown_session_worktree", {
        workdir: activeWorkspace.path,
        worktreePath: session.worktreePath,
        branch: session.branchName,
      }).catch((e) => {
        console.warn("[worktree] teardown failed:", e);
      });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* 区域头 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 2px 6px",
        borderTop: "1px solid var(--ci-border)",
        marginTop: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: accentColor, flexShrink: 0,
            boxShadow: `0 1px 3px ${accentColor}60`,
          }} />
          <span style={{
            fontSize: 11, color: "var(--ci-text-dim)",
            fontWeight: 600,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}>
            {runnerLabel} 会话
          </span>
        </div>

        <button
          onClick={handleNewSession}
          style={{
            background: "var(--ci-accent-bg)",
            border: "1px solid var(--ci-accent-bdr)",
            borderRadius: 7, padding: "3px 10px",
            color: "var(--ci-accent)",
            fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 3,
            fontWeight: 600,
            transition: "background 0.12s, border-color 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.filter = "brightness(0.9)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.filter = "none";
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> 新建
        </button>
      </div>

      {/* Session 列表 */}
      <AnimatePresence>
        {wsSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            accentColor={accentColor}
            onClick={() => setActiveSession(session.id)}
            onExpand={() => {
              setActiveSession(session.id);
              setExpandedSession(session.id);
            }}
            onRemove={() => handleRemoveSession(session)}
          />
        ))}
      </AnimatePresence>

      {wsSessions.length === 0 && (
        <div style={{
          textAlign: "center", padding: "14px 0 8px",
          color: "var(--ci-text-dim)", fontSize: 12,
        }}>
          点击「+ 新建」开始 {runnerLabel} 会话
        </div>
      )}
    </div>
  );
}
