import { motion, AnimatePresence } from "framer-motion";
import { ClaudeSession, SessionStatus, useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore, getWorkspaceColor } from "../store/workspaceStore";
import { useSettingsStore, RUNNER_LABELS } from "../store/settingsStore";

// ── 展开图标 ─────────────────────────────────────────────────
const ExpandIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: "block" }}>
    <path d="M1.5 9.5L9.5 1.5M9.5 1.5H4.5M9.5 1.5V6.5"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── 状态配置 ────────────────────────────────────────────────
const STATUS_CONFIG: Record<SessionStatus, {
  color: string;
  pulse: boolean;
  label: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  leftBorder?: string;
}> = {
  running: {
    color: "#4ade80", pulse: true,  label: "运行中",
    badgeBg: "rgba(74,222,128,0.12)", badgeBorder: "rgba(74,222,128,0.3)", badgeText: "#4ade80",
    leftBorder: "#4ade80",
  },
  waiting: {
    color: "#fbbf24", pulse: true,  label: "需要操作",
    badgeBg: "rgba(251,191,36,0.18)", badgeBorder: "rgba(251,191,36,0.5)", badgeText: "#fbbf24",
    leftBorder: "#fbbf24",
  },
  idle:    {
    color: "rgba(255,255,255,0.2)", pulse: false, label: "空闲",
    badgeBg: "rgba(255,255,255,0.05)", badgeBorder: "rgba(255,255,255,0.1)", badgeText: "rgba(255,255,255,0.25)",
  },
  done:    {
    color: "#60a5fa", pulse: false, label: "已完成",
    badgeBg: "rgba(96,165,250,0.12)", badgeBorder: "rgba(96,165,250,0.3)", badgeText: "#60a5fa",
  },
  error:   {
    color: "#f87171", pulse: false, label: "出错",
    badgeBg: "rgba(248,113,113,0.15)", badgeBorder: "rgba(248,113,113,0.4)", badgeText: "#f87171",
    leftBorder: "#f87171",
  },
};

function StatusDot({ status }: { status: SessionStatus }) {
  const { color, pulse } = STATUS_CONFIG[status];
  return (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, position: "absolute" }} />
      {pulse && (
        <motion.div
          animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          style={{ width: 8, height: 8, borderRadius: "50%", background: color, position: "absolute" }}
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
  const isError = session.status === "error";

  return (
    <motion.div
      layout
      layoutId={`session-card-${session.id}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 11px",
        borderRadius: 9,
        background: isActive
          ? `linear-gradient(135deg, ${accentColor}12 0%, rgba(255,255,255,0.05) 100%)`
          : isWaiting
          ? "rgba(251,191,36,0.06)"
          : isError
          ? "rgba(248,113,113,0.06)"
          : "rgba(255,255,255,0.03)",
        border: isActive
          ? `1px solid ${accentColor}30`
          : isWaiting
          ? "1px solid rgba(251,191,36,0.3)"
          : isError
          ? "1px solid rgba(248,113,113,0.25)"
          : "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {/* 左侧状态色条 */}
      {cfg.leftBorder && (
        <div style={{
          position: "absolute",
          left: 0, top: 4, bottom: 4,
          width: 2.5, borderRadius: 99,
          background: cfg.leftBorder,
          opacity: isRunning ? 0.8 : isWaiting ? 1 : 0.6,
        }} />
      )}

      {/* waiting 状态：整体微脉冲边框效果 */}
      {isWaiting && (
        <motion.div
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute", inset: 0, borderRadius: 9,
            border: "1px solid rgba(251,191,36,0.5)",
            pointerEvents: "none",
          }}
        />
      )}

      <StatusDot status={session.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            color: isActive ? "#fff" : isWaiting ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)",
            fontSize: 11, fontWeight: isWaiting ? 700 : 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.name}
          </span>
          {/* 状态 badge：idle 时不显示（减少噪音） */}
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

        {/* waiting 状态：醒目的操作提示行 */}
        {isWaiting && (
          <motion.p
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              margin: "2px 0 0", fontSize: 10,
              color: "#fbbf24",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: 9 }}>⚡</span>
            点击展开终端查看并输入
          </motion.p>
        )}

        {/* 运行中：显示当前任务 */}
        {!isWaiting && session.currentTask && (
          <p style={{
            margin: "2px 0 0", fontSize: 10,
            color: isRunning ? "rgba(74,222,128,0.6)" : isError ? "rgba(248,113,113,0.6)" : "rgba(255,255,255,0.3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isRunning && <span style={{ marginRight: 3 }}>›</span>}
            {session.currentTask}
          </p>
        )}

        {/* Worktree 分支 + diff 信息 */}
        {session.branchName && (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 99,
              background: "rgba(167,139,250,0.1)",
              border: "1px solid rgba(167,139,250,0.2)",
              color: "rgba(167,139,250,0.7)",
              fontFamily: "monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 80,
            }}>
              ⎇ {session.branchName.replace("ci/", "")}
            </span>
            {session.worktreePath && (
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 99,
                background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.15)",
                color: "rgba(74,222,128,0.55)",
              }}>
                worktree
              </span>
            )}
            {session.diffFiles.length > 0 && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span style={{ color: "#4ade80" }}>+{session.diffFiles.reduce((s, f) => s + f.additions, 0)}</span>
                <span style={{ color: "#f87171" }}>−{session.diffFiles.reduce((s, f) => s + f.deletions, 0)}</span>
              </>
            )}
          </p>
        )}

        {!session.branchName && session.diffFiles.length > 0 && (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", gap: 4 }}>
            {session.diffFiles.length} 变更{" "}
            <span style={{ color: "#4ade80" }}>+{session.diffFiles.reduce((s, f) => s + f.additions, 0)}</span>{" "}
            <span style={{ color: "#f87171" }}>−{session.diffFiles.reduce((s, f) => s + f.deletions, 0)}</span>
          </p>
        )}
      </div>

      {/* 展开终端 */}
      <button
        onClick={(e) => { e.stopPropagation(); onExpand(); }}
        title="展开终端"
        style={{
          background: isWaiting ? "rgba(251,191,36,0.12)" : "none",
          border: isWaiting ? "1px solid rgba(251,191,36,0.3)" : "none",
          color: isWaiting ? "#fbbf24" : "rgba(255,255,255,0.18)",
          cursor: "pointer", padding: "4px 6px", borderRadius: 5,
          flexShrink: 0, display: "flex", alignItems: "center",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = isWaiting ? "#fde68a" : accentColor;
          e.currentTarget.style.background = isWaiting ? "rgba(251,191,36,0.22)" : `${accentColor}18`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = isWaiting ? "#fbbf24" : "rgba(255,255,255,0.18)";
          e.currentTarget.style.background = isWaiting ? "rgba(251,191,36,0.12)" : "none";
        }}
      >
        <ExpandIcon />
      </button>

      {/* 删除 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          background: "none", border: "none",
          color: "rgba(255,255,255,0.18)", fontSize: 11,
          cursor: "pointer", padding: "2px 4px", borderRadius: 4,
          flexShrink: 0, transition: "color 0.12s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.18)")}
      >✕</button>
    </motion.div>
  );
}

// ── 主组件：SessionList ───────────────────────────────────────
export function SessionList() {
  const { sessions, activeSessionId, removeSession, setActiveSession, setExpandedSession, addSession } = useSessionStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runnerType = useSettingsStore((s) => s.settings.runner.type);
  const runnerLabel = RUNNER_LABELS[runnerType];

  if (!activeWorkspace) return null;

  const accentColor = getWorkspaceColor(activeWorkspace.color);
  const wsSessions = sessions.filter((s) => s.workspaceId === activeWorkspaceId);

  // 新建 session：直接创建并展开终端，跳过命名表单
  const handleNewSession = () => {
    const id = addSession(activeWorkspace.id, activeWorkspace.path);
    // 立即展开终端，用户在终端面板内输入 query
    setExpandedSession(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* 分隔线 + 区域头 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 2px 5px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        marginTop: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: accentColor, flexShrink: 0,
          }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: 0.3 }}>
            {runnerLabel} 会话
          </span>
        </div>

        <button
          onClick={handleNewSession}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 6, padding: "2px 7px",
            color: "rgba(255,255,255,0.45)",
            fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 3,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `${accentColor}20`;
            e.currentTarget.style.borderColor = `${accentColor}40`;
            e.currentTarget.style.color = accentColor;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
            e.currentTarget.style.color = "rgba(255,255,255,0.45)";
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>+</span> 新建
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
            onRemove={() => removeSession(session.id)}
          />
        ))}
      </AnimatePresence>

      {wsSessions.length === 0 && (
        <div style={{
          textAlign: "center", padding: "12px 0 6px",
          color: "rgba(255,255,255,0.18)", fontSize: 11,
        }}>
          点击「+ 新建」开始 {runnerLabel} 会话
        </div>
      )}
    </div>
  );
}
