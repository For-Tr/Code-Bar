import { useState } from "react";
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
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, position: "absolute" }} />
      {pulse && (
        <motion.div
          animate={{ scale: [1, 2], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
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
  const { label } = STATUS_CONFIG[session.status];
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
          : "rgba(255,255,255,0.03)",
        border: isActive
          ? `1px solid ${accentColor}30`
          : "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <StatusDot status={session.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.65)",
            fontSize: 11, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.name}
          </span>
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 99,
            background: "rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.3)", flexShrink: 0,
          }}>
            {label}
          </span>
        </div>
        {session.currentTask && (
          <p style={{
            margin: "2px 0 0", fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.currentTask}
          </p>
        )}
        {session.diffFiles.length > 0 && (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.22)" }}>
            {session.diffFiles.length} 个变更 ·{" "}
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
          background: "none", border: "none",
          color: "rgba(255,255,255,0.18)",
          cursor: "pointer", padding: "4px", borderRadius: 5,
          flexShrink: 0, display: "flex", alignItems: "center",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = accentColor;
          e.currentTarget.style.background = `${accentColor}18`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.18)";
          e.currentTarget.style.background = "none";
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

// ── 新建会话表单（仅用于当前激活 workspace） ──────────────────
function NewSessionForm({
  workspaceId, workdir, accentColor, onDone,
}: {
  workspaceId: string;
  workdir: string;
  accentColor: string;
  onDone: () => void;
}) {
  const { addSession } = useSessionStore();
  const [name, setName] = useState("");

  const handleCreate = () => {
    addSession(workspaceId, workdir, name.trim() || undefined);
    onDone();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.16 }}
      style={{ overflow: "hidden" }}
    >
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${accentColor}25`,
        borderRadius: 9, padding: "10px 11px",
        display: "flex", gap: 8, alignItems: "center",
        marginBottom: 4,
      }}>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="会话名称（可选）"
          onKeyDown={e => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") onDone();
          }}
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            color: "#fff", fontSize: 11,
          }}
        />
        <button onClick={handleCreate}
          style={{
            background: `${accentColor}20`, border: `1px solid ${accentColor}40`,
            borderRadius: 6, padding: "3px 10px",
            color: accentColor, fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>
          创建
        </button>
        <button onClick={onDone}
          style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.3)", fontSize: 12,
            cursor: "pointer", padding: "2px 4px",
          }}>✕</button>
      </div>
    </motion.div>
  );
}

// ── 主组件：SessionList（展示当前激活 workspace 的 sessions） ─
export function SessionList() {
  const { sessions, activeSessionId, removeSession, setActiveSession, setExpandedSession } = useSessionStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId)
  );
  const runnerType = useSettingsStore((s) => s.settings.runner.type);
  const runnerLabel = RUNNER_LABELS[runnerType];
  const [showForm, setShowForm] = useState(false);

  // 没有激活 workspace 时不渲染
  if (!activeWorkspace) return null;

  const accentColor = getWorkspaceColor(activeWorkspace.color);
  const wsSessions = sessions.filter((s) => s.workspaceId === activeWorkspaceId);

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
          {/* workspace 颜色小标 */}
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: accentColor, flexShrink: 0,
          }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: 0.3 }}>
            {runnerLabel} 会话
          </span>
        </div>

        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            background: showForm ? `${accentColor}20` : "rgba(255,255,255,0.06)",
            border: showForm ? `1px solid ${accentColor}40` : "1px solid rgba(255,255,255,0.09)",
            borderRadius: 6, padding: "2px 7px",
            color: showForm ? accentColor : "rgba(255,255,255,0.45)",
            fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 3,
            transition: "background 0.12s, color 0.12s",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>+</span> 新建
        </button>
      </div>

      {/* 新建表单 */}
      <AnimatePresence>
        {showForm && (
          <NewSessionForm
            key="new-form"
            workspaceId={activeWorkspace.id}
            workdir={activeWorkspace.path}
            accentColor={accentColor}
            onDone={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>

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

      {wsSessions.length === 0 && !showForm && (
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
