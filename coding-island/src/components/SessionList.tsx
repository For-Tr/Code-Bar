import { motion, AnimatePresence } from "framer-motion";
import { ClaudeSession, SessionStatus, useSessionStore } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS } from "../store/settingsStore";

// ── 状态指示灯 ──────────────────────────────────────────────
const STATUS_CONFIG: Record<SessionStatus, { color: string; pulse: boolean; label: string }> = {
  running: { color: "#4ade80", pulse: true,  label: "运行中" },
  waiting: { color: "#fbbf24", pulse: true,  label: "等待确认" },
  idle:    { color: "rgba(255,255,255,0.2)", pulse: false, label: "空闲" },
  done:    { color: "#60a5fa", pulse: false, label: "完成" },
  error:   { color: "#f87171", pulse: false, label: "出错" },
};

function StatusDot({ status }: { status: SessionStatus }) {
  const { color, pulse } = STATUS_CONFIG[status];
  return (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        position: "absolute",
      }} />
      {pulse && (
        <motion.div
          animate={{ scale: [1, 2], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: color,
            position: "absolute",
          }}
        />
      )}
    </div>
  );
}

function SessionCard({
  session,
  isActive,
  onClick,
  onRemove,
}: {
  session: ClaudeSession;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const { label } = STATUS_CONFIG[session.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 12px",
        borderRadius: 10,
        background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
        border: isActive
          ? "1px solid rgba(255,255,255,0.12)"
          : "1px solid transparent",
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {/* 状态灯 */}
      <StatusDot status={session.status} />

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
            fontSize: 12, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.name}
          </span>
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.35)", flexShrink: 0,
          }}>
            {label}
          </span>
        </div>
        {session.currentTask && (
          <p style={{
            margin: "2px 0 0", fontSize: 10,
            color: "rgba(255,255,255,0.35)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.currentTask}
          </p>
        )}
        {session.diffFiles.length > 0 && (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            {session.diffFiles.length} 个文件变更 ·{" "}
            <span style={{ color: "#4ade80" }}>
              +{session.diffFiles.reduce((s, f) => s + f.additions, 0)}
            </span>{" "}
            <span style={{ color: "#f87171" }}>
              −{session.diffFiles.reduce((s, f) => s + f.deletions, 0)}
            </span>
          </p>
        )}
      </div>

      {/* 删除按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          background: "none", border: "none",
          color: "rgba(255,255,255,0.2)", fontSize: 12,
          cursor: "pointer", padding: "2px 4px", borderRadius: 4,
          flexShrink: 0,
          transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
      >
        ✕
      </button>
    </motion.div>
  );
}

export function SessionList() {
  const { sessions, activeSessionId, addSession, removeSession, setActiveSession } = useSessionStore();
  const runnerType = useSettingsStore((s) => s.settings.runner.type);
  const runnerLabel = RUNNER_LABELS[runnerType];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* 标题栏 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 4px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 2,
      }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
          {runnerLabel} 会话
        </span>
        <button
          onClick={() => addSession()}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6, padding: "3px 8px",
            color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> 新建
        </button>
      </div>

      {/* Session 卡片列表 */}
      <AnimatePresence>
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClick={() => setActiveSession(session.id)}
            onRemove={() => removeSession(session.id)}
          />
        ))}
      </AnimatePresence>

      {sessions.length === 0 && (
        <div style={{
          textAlign: "center", padding: "16px 0",
          color: "rgba(255,255,255,0.2)", fontSize: 12,
        }}>
          点击「+」新建一个 {runnerLabel} 会话
        </div>
      )}
    </div>
  );
}
