import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeSession, SessionStatus, useSessionStore } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS } from "../store/settingsStore";

// 展开图标
const ExpandIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: "block" }}>
    <path d="M1.5 9.5L9.5 1.5M9.5 1.5H4.5M9.5 1.5V6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
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
  onExpand,
  onRemove,
}: {
  session: ClaudeSession;
  isActive: boolean;
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
        position: "relative",
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

      {/* 展开终端按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onExpand(); }}
        title="展开终端"
        style={{
          background: "none", border: "none",
          color: "rgba(255,255,255,0.2)",
          cursor: "pointer", padding: "4px", borderRadius: 5,
          flexShrink: 0, display: "flex", alignItems: "center",
          transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = "#60a5fa";
          e.currentTarget.style.background = "rgba(96,165,250,0.12)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.2)";
          e.currentTarget.style.background = "none";
        }}
      >
        <ExpandIcon />
      </button>

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

// ── 新建会话内联表单 ─────────────────────────────────────────
function NewSessionForm({ onDone }: { onDone: () => void }) {
  const { addSession } = useSessionStore();
  const [name, setName] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  const handlePickFolder = async () => {
    setPicking(true);
    setError("");
    try {
      const path = await invoke<string>("pick_folder");
      if (path) setWorkdir(path);
    } catch {
      setError("无法打开文件夹选择器");
    } finally {
      setPicking(false);
    }
  };

  const handleCreate = () => {
    const trimmed = workdir.trim();
    if (!trimmed) {
      setError("请选择或输入工作目录");
      return;
    }
    addSession(trimmed, name.trim() || undefined);
    onDone();
  };

  const inputBase: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 7,
    padding: "6px 10px",
    color: "#fff",
    fontSize: 11,
    outline: "none",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -6, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{ overflow: "hidden" }}
    >
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        padding: "12px",
        display: "flex", flexDirection: "column", gap: 8,
        marginBottom: 4,
      }}>
        {/* 标题 */}
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: 0.3 }}>
          新建会话
        </div>

        {/* 会话名称 */}
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>会话名称（可选）</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="默认自动生成"
            style={inputBase}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
          />
        </div>

        {/* 工作目录 */}
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>
            工作目录 <span style={{ color: "#f87171" }}>*</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={workdir}
              onChange={e => { setWorkdir(e.target.value); setError(""); }}
              placeholder="/Users/你/项目路径"
              style={{ ...inputBase, flex: 1, borderColor: error ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.1)" }}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
            />
            <button
              onClick={handlePickFolder}
              disabled={picking}
              title="浏览目录"
              style={{
                flexShrink: 0,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 7,
                padding: "0 9px",
                color: picking ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)",
                cursor: picking ? "wait" : "pointer",
                fontSize: 14,
                display: "flex", alignItems: "center",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => !picking && (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
            >
              {picking ? "…" : "📂"}
            </button>
          </div>
          {error && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#f87171" }}>{error}</div>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            onClick={onDone}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 7, padding: "5px 12px",
              color: "rgba(255,255,255,0.4)", fontSize: 11,
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            style={{
              background: "rgba(96,165,250,0.15)",
              border: "1px solid rgba(96,165,250,0.3)",
              borderRadius: 7, padding: "5px 14px",
              color: "#60a5fa", fontSize: 11, fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(96,165,250,0.25)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(96,165,250,0.15)")}
          >
            创建
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function SessionList() {
  const { sessions, activeSessionId, removeSession, setActiveSession, setExpandedSession } = useSessionStore();
  const runnerType = useSettingsStore((s) => s.settings.runner.type);
  const runnerLabel = RUNNER_LABELS[runnerType];
  const [showForm, setShowForm] = useState(false);

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
          onClick={() => setShowForm(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: showForm ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.07)",
            border: showForm ? "1px solid rgba(96,165,250,0.3)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6, padding: "3px 8px",
            color: showForm ? "#60a5fa" : "rgba(255,255,255,0.6)",
            fontSize: 11, cursor: "pointer",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={e => {
            if (!showForm) e.currentTarget.style.background = "rgba(255,255,255,0.12)";
          }}
          onMouseLeave={e => {
            if (!showForm) e.currentTarget.style.background = "rgba(255,255,255,0.07)";
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1, transition: "transform 0.2s", transform: showForm ? "rotate(45deg)" : "none" }}>+</span>
          {showForm ? "收起" : "新建"}
        </button>
      </div>

      {/* 新建会话内联表单 */}
      <AnimatePresence>
        {showForm && (
          <NewSessionForm key="new-form" onDone={() => setShowForm(false)} />
        )}
      </AnimatePresence>

      {/* Session 卡片列表 */}
      <AnimatePresence>
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClick={() => setActiveSession(session.id)}
            onExpand={() => {
              setActiveSession(session.id);
              setExpandedSession(session.id);
            }}
            onRemove={() => removeSession(session.id)}
          />
        ))}
      </AnimatePresence>

      {sessions.length === 0 && !showForm && (
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
