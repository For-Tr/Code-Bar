import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  useWorkspaceStore,
  useWorkspacesSorted,
  WORKSPACE_COLORS,
  getWorkspaceColor,
  type Workspace,
  type WorkspaceColorId,
} from "../store/workspaceStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";

// ── 常量 ─────────────────────────────────────────────────────
const CARD_H = 38;
const CARD_PEEK = 5;
const CARD_OFFSET_X = 3;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 30 };

// ── 新建 Workspace 内联表单 ───────────────────────────────────
function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const { addWorkspace } = useWorkspaceStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState<WorkspaceColorId>("blue");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  const handlePick = async () => {
    setPicking(true);
    setError("");
    try {
      const picked = await invoke<string>("pick_folder");
      if (picked) setPath(picked);
    } catch {
      setError("无法打开文件夹选择器");
    } finally {
      setPicking(false);
    }
  };

  const handleCreate = () => {
    const trimmed = path.trim();
    if (!trimmed) { setError("请选择工作目录"); return; }
    addWorkspace(trimmed, name.trim() || undefined, color);
    invoke("trust_workspace", { path: trimmed }).catch(() => {});
    onDone();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "transparent",
    border: "1px solid var(--ci-border)",
    borderRadius: 8, padding: "7px 10px",
    color: "var(--ci-text)", fontSize: 12, outline: "none",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      style={{ overflow: "hidden" }}
    >
      <div style={{
        background: "var(--ci-surface)",
        border: "1px solid var(--ci-toolbar-border)",
        borderRadius: 14, padding: 14,
        display: "flex", flexDirection: "column", gap: 10,
        marginBottom: 4,
        boxShadow: "none",
        textShadow,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: "var(--ci-text)", letterSpacing: -0.2,
        }}>
          添加 Workspace
        </div>

        {/* 名称（可选） */}
        <div>
          <div style={{ fontSize: 11, color: "var(--ci-text-muted)", marginBottom: 4, fontWeight: 500 }}>名称（可选）</div>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="默认使用文件夹名" style={inputStyle}
            onKeyDown={e => e.key === "Enter" && handleCreate()} />
        </div>

        {/* 路径 */}
        <div>
          <div style={{ fontSize: 11, color: "var(--ci-text-muted)", marginBottom: 4, fontWeight: 500 }}>
            目录 <span style={{ color: "var(--ci-red)" }}>*</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={path} onChange={e => { setPath(e.target.value); setError(""); }}
              placeholder="/Users/你/项目"
              style={{
                ...inputStyle, flex: 1,
                borderColor: error ? "rgba(255,59,48,0.5)" : undefined,
              }}
              onKeyDown={e => e.key === "Enter" && handleCreate()} />
            <button onClick={handlePick} disabled={picking}
              style={{
                flexShrink: 0,
                background: "transparent",
                border: "1px solid var(--ci-border)",
                borderRadius: 8, padding: "0 10px",
                color: picking ? "var(--ci-text-dim)" : "var(--ci-text-muted)",
                cursor: picking ? "wait" : "pointer", fontSize: 15,
                display: "flex", alignItems: "center",
                transition: "background 0.12s, border-color 0.12s, color 0.12s",
              }}
              onMouseEnter={e => {
                if (picking) return;
                e.currentTarget.style.background = "var(--ci-btn-ghost-bg)";
                e.currentTarget.style.borderColor = "var(--ci-toolbar-border)";
                e.currentTarget.style.color = "var(--ci-text)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "var(--ci-border)";
                e.currentTarget.style.color = picking ? "var(--ci-text-dim)" : "var(--ci-text-muted)";
              }}
            >{picking ? "…" : "📂"}</button>
          </div>
          {error && <div style={{ marginTop: 4, fontSize: 11, color: "var(--ci-red)" }}>{error}</div>}
        </div>

        {/* 颜色选择 */}
        <div>
          <div style={{ fontSize: 11, color: "var(--ci-text-muted)", marginBottom: 6, fontWeight: 500 }}>标签颜色</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {WORKSPACE_COLORS.map((c) => (
              <button key={c.id} onClick={() => setColor(c.id as WorkspaceColorId)}
                title={c.label}
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: c.hex, border: "none", cursor: "pointer", padding: 0,
                  outline: color === c.id ? `2.5px solid ${c.hex}` : "none",
                  outlineOffset: 2.5,
                  boxShadow: color === c.id ? `0 0 0 1.5px rgba(255,255,255,0.9)` : "0 1px 2px rgba(0,0,0,0.15)",
                  transform: color === c.id ? "scale(1.15)" : "scale(1)",
                  transition: "transform 0.12s, outline 0.12s, box-shadow 0.12s",
                }} />
            ))}
          </div>
        </div>

        {/* 操作 */}
        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end", marginTop: 2 }}>
          <button onClick={onDone}
            style={{
              background: "transparent",
              border: "1px solid var(--ci-border)",
              borderRadius: 8, padding: "6px 14px",
              color: "var(--ci-text-muted)", fontSize: 12, cursor: "pointer",
              fontWeight: 500,
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "var(--ci-btn-ghost-bg)";
              e.currentTarget.style.borderColor = "var(--ci-toolbar-border)";
              e.currentTarget.style.color = "var(--ci-text)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "var(--ci-border)";
              e.currentTarget.style.color = "var(--ci-text-muted)";
            }}
          >取消</button>
          <button onClick={handleCreate}
            style={{
              background: "var(--ci-accent-bg)",
              border: "1px solid var(--ci-accent-bdr)",
              borderRadius: 8, padding: "6px 16px",
              color: "var(--ci-accent)", fontSize: 12, fontWeight: 600, cursor: "pointer",
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={e => {
              if (isGlass) return;
              e.currentTarget.style.background = "var(--ci-accent)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--ci-accent-bg)";
              e.currentTarget.style.color = "var(--ci-accent)";
            }}
          >创建</button>
        </div>
      </div>
    </motion.div>
  );
}

// ── 单张 Workspace 卡片（展开状态） ──────────────────────────
function WorkspaceCardExpanded({
  ws, isActive, index, total, onClick, onRemove,
}: {
  ws: Workspace;
  isActive: boolean;
  index: number;
  total: number;
  onClick: () => void;
  onRemove: () => void;
}) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const color = getWorkspaceColor(ws.color);
  const sessionCount = useSessionStore((s) =>
    s.sessions.filter((sess) => sess.workspaceId === ws.id).length
  );
  const waitingCount = useSessionStore((s) =>
    s.sessions.filter((sess) => sess.workspaceId === ws.id && sess.status === "waiting").length
  );
  const runningCount = useSessionStore((s) =>
    s.sessions.filter((sess) => sess.workspaceId === ws.id && sess.status === "running").length
  );

  return (
    <motion.div
      layoutId={`ws-card-${ws.id}`}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={SPRING}
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px",
        borderRadius: 12,
        background: isActive ? "var(--ci-accent-bg)" : "transparent",
        border: isActive
          ? `1px solid ${color}45`
          : "1px solid var(--ci-toolbar-border)",
        cursor: "pointer",
        zIndex: total - index,
        transition: isGlass ? "border-color 0.15s, color 0.15s" : "background 0.15s, border-color 0.15s",
        boxShadow: "none",
        textShadow,
      }}
    >
      {/* 颜色圆点 */}
      <div style={{
        width: 11, height: 11, borderRadius: "50%",
        background: color, flexShrink: 0,
        boxShadow: `0 1px 4px ${color}60`,
      }} />

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {ws.name}
        </div>
        <div style={{
          fontSize: 10, color: "var(--ci-text-dim)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginTop: 1,
          fontFamily: "-apple-system, monospace",
        }}>
          {ws.path}
        </div>
      </div>

      {/* 会话数 badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {waitingCount > 0 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-yellow-bg)",
            border: "1px solid var(--ci-yellow-bdr)",
            color: "var(--ci-yellow-dark)",
            fontWeight: 600,
          }}>
            {waitingCount} 待操作
          </span>
        )}
        {runningCount > 0 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-green-bg)",
            border: "1px solid var(--ci-green-bdr)",
            color: "var(--ci-green-dark)",
            fontWeight: 600,
          }}>
            {runningCount} 运行
          </span>
        )}
        {sessionCount > 0 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-surface)",
            color: "var(--ci-text-muted)",
            fontWeight: 600,
          }}>
            {sessionCount}
          </span>
        )}
      </div>

      {/* 删除按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          background: "none", border: "none",
          color: "var(--ci-text-dim)", fontSize: 11,
          cursor: "pointer", padding: "2px 4px",
          borderRadius: 4, flexShrink: 0,
          transition: "color 0.12s, background 0.12s",
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

// ── 堆叠状态下的卡片层（收起时） ─────────────────────────────
function WorkspaceStackCollapsed({
  workspaces,
  activeId,
  onHoverStart,
  onHoverEnd,
  onClick,
}: {
  workspaces: Workspace[];
  activeId: string | null;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClick: () => void;
}) {
  const sorted = [...workspaces].sort((a, b) => a.order - b.order);
  const top = sorted[0];
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";

  if (!top) return null;

  const topColor = getWorkspaceColor(top.color);

  return (
    <div
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={onClick}
      style={{
        position: "relative",
        height: CARD_H + Math.min(sorted.length - 1, 3) * CARD_PEEK,
        cursor: "pointer",
      }}
    >
      {/* 底层卡片阴影 */}
      {sorted.slice(1, 4).map((ws, idx) => {
        const layerIdx = idx + 1;
        const pColor = getWorkspaceColor(ws.color);
        return (
          <div key={ws.id} style={{
            position: "absolute",
            top: CARD_PEEK * layerIdx,
            left: CARD_OFFSET_X * layerIdx,
            right: -(CARD_OFFSET_X * layerIdx),
            height: CARD_H,
            borderRadius: 12,
            background: "var(--ci-surface)",
            border: "1px solid var(--ci-toolbar-border)",
            zIndex: 10 - layerIdx,
            boxShadow: "none",
            borderTop: `2px solid ${pColor}45`,
          }} />
        );
      })}

      {/* 顶层卡片 */}
      <motion.div
        layoutId={`ws-card-${top.id}`}
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: CARD_H,
          borderRadius: 12,
          background: "var(--ci-surface)",
          border: "1px solid var(--ci-toolbar-border)",
          borderTop: `2px solid ${topColor}`,
          zIndex: 20,
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 12px",
          boxShadow: "none",
          textShadow,
        }}
        whileHover={isGlass ? undefined : { scale: 1.004 }}
        transition={SPRING}
      >
        {/* 颜色点 */}
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: topColor, flexShrink: 0,
          boxShadow: `0 1px 4px ${topColor}80`,
        }} />

        {/* 名称 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--ci-text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {top.name}
          </div>
        </div>

        {/* 数量提示 */}
        {sorted.length > 1 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-surface)",
            color: "var(--ci-text-muted)", fontWeight: 600,
          }}>
            +{sorted.length - 1}
          </span>
        )}

        {/* 展开箭头 */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ color: "var(--ci-text-dim)", flexShrink: 0 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </motion.div>

      {/* 底部颜色条指示 */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 8, right: 8,
        display: "flex", gap: 3, justifyContent: "center",
      }}>
        {sorted.slice(0, 5).map((ws) => (
          <div key={ws.id} style={{
            width: 8, height: 3, borderRadius: 99,
            background: getWorkspaceColor(ws.color),
            opacity: ws.id === activeId ? 0.9 : 0.3,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── 主组件：WorkspaceStack ────────────────────────────────────
export function WorkspaceStack() {
  const { workspaces, activeWorkspaceId, bringToFront, removeWorkspace } = useWorkspaceStore();
  const { removeSessionsByWorkspace } = useSessionStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const sorted = useWorkspacesSorted();

  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(workspaces.length === 0);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 没有 workspace 时只渲染添加表单
  if (workspaces.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <AnimatePresence>
          {showForm ? (
            <NewWorkspaceForm key="form" onDone={() => setShowForm(false)} />
          ) : (
            <motion.button
              key="add-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowForm(true)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "12px 0",
                background: "var(--ci-surface)",
                border: `1.5px dashed var(--ci-border-med)`,
                borderRadius: 10, cursor: "pointer",
                color: "var(--ci-text-muted)", fontSize: 12,
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => {
                if (isGlass) {
                  e.currentTarget.style.borderColor = "var(--ci-pill-border)";
                  return;
                }
                e.currentTarget.style.background = "var(--ci-surface-hi)";
                e.currentTarget.style.borderColor = "var(--ci-accent-bdr)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "var(--ci-surface)";
                e.currentTarget.style.borderColor = "var(--ci-border)";
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, color: "var(--ci-accent)" }}>+</span>
              添加 Workspace
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const handleRemove = (id: string) => {
    removeSessionsByWorkspace(id);
    removeWorkspace(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ── 标题栏 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 0 8px",
      }}>
        <span style={{
          fontSize: 11, color: "var(--ci-text-dim)", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Workspace
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {workspaces.length > 1 && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                background: "transparent",
                border: "1px solid var(--ci-border)",
                color: "var(--ci-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                padding: "5px 10px",
                borderRadius: 8,
                fontWeight: 600,
                transition: "background 0.12s, border-color 0.12s, color 0.12s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "var(--ci-btn-ghost-bg)";
                e.currentTarget.style.borderColor = "var(--ci-toolbar-border)";
                e.currentTarget.style.color = "var(--ci-text)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "var(--ci-border)";
                e.currentTarget.style.color = "var(--ci-text-muted)";
              }}
            >
              {expanded ? "收起" : "全部"}
            </button>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              background: showForm ? "var(--ci-accent-bg)" : "transparent",
              border: `1px solid ${showForm ? "var(--ci-accent-bdr)" : "var(--ci-border)"}`,
              borderRadius: 8,
              padding: "5px 10px",
              color: showForm ? "var(--ci-accent)" : "var(--ci-text-muted)",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 600,
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
              lineHeight: 1,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = showForm ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)";
              e.currentTarget.style.borderColor = showForm ? "var(--ci-accent-bdr)" : "var(--ci-toolbar-border)";
              e.currentTarget.style.color = showForm ? "var(--ci-accent)" : "var(--ci-text)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = showForm ? "var(--ci-accent-bg)" : "transparent";
              e.currentTarget.style.borderColor = showForm ? "var(--ci-accent-bdr)" : "var(--ci-border)";
              e.currentTarget.style.color = showForm ? "var(--ci-accent)" : "var(--ci-text-muted)";
            }}
          >
            <span style={{ fontSize: 13 }}>+</span>
            <span>添加</span>
          </button>
        </div>
      </div>

      {/* ── 新建表单 ── */}
      <AnimatePresence>
        {showForm && (
          <NewWorkspaceForm key="form" onDone={() => setShowForm(false)} />
        )}
      </AnimatePresence>

      {/* ── 堆叠卡片 or 展开列表 ── */}
      <AnimatePresence mode="wait">
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: "flex", flexDirection: "column", gap: 4 }}
          >
            {sorted.map((ws, idx) => (
              <WorkspaceCardExpanded
                key={ws.id}
                ws={ws}
                isActive={ws.id === activeWorkspaceId}
                index={idx}
                total={sorted.length}
                onClick={() => {
                  bringToFront(ws.id);
                  setExpanded(false);
                }}
                onRemove={() => handleRemove(ws.id)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <WorkspaceStackCollapsed
              workspaces={sorted}
              activeId={activeWorkspaceId}
              onHoverStart={() => {
                if (sorted.length <= 1) return;
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = setTimeout(() => {
                  setExpanded(true);
                }, 300);
              }}
              onHoverEnd={() => {
                if (hoverTimerRef.current) {
                  clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
              }}
              onClick={() => {
                if (sorted.length > 1) setExpanded(true);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
