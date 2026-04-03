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

// ── 常量 ─────────────────────────────────────────────────────
const CARD_H = 36;          // 每张卡片的可见高度（收起状态）
const CARD_PEEK = 6;        // 堆叠时露出的高度
const CARD_OFFSET_X = 3;    // 每张卡片向右偏移
const SPRING = { type: "spring" as const, stiffness: 380, damping: 30 };

// ── 新建 Workspace 内联表单 ───────────────────────────────────
function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const { addWorkspace } = useWorkspaceStore();
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
    onDone();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 7, padding: "6px 10px",
    color: "#fff", fontSize: 11, outline: "none",
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
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10, padding: 12,
        display: "flex", flexDirection: "column", gap: 8,
        marginBottom: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: 0.3 }}>
          添加 Workspace
        </div>

        {/* 名称（可选） */}
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginBottom: 3 }}>名称（可选）</div>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="默认使用文件夹名" style={inputStyle}
            onKeyDown={e => e.key === "Enter" && handleCreate()} />
        </div>

        {/* 路径 */}
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginBottom: 3 }}>
            目录 <span style={{ color: "#f87171" }}>*</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={path} onChange={e => { setPath(e.target.value); setError(""); }}
              placeholder="/Users/你/项目"
              style={{ ...inputStyle, flex: 1, borderColor: error ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.1)" }}
              onKeyDown={e => e.key === "Enter" && handleCreate()} />
            <button onClick={handlePick} disabled={picking}
              style={{
                flexShrink: 0, background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7,
                padding: "0 9px", color: picking ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)",
                cursor: picking ? "wait" : "pointer", fontSize: 14,
                display: "flex", alignItems: "center",
              }}
            >{picking ? "…" : "📂"}</button>
          </div>
          {error && <div style={{ marginTop: 3, fontSize: 10, color: "#f87171" }}>{error}</div>}
        </div>

        {/* 颜色选择 */}
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginBottom: 5 }}>标签颜色</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WORKSPACE_COLORS.map((c) => (
              <button key={c.id} onClick={() => setColor(c.id as WorkspaceColorId)}
                title={c.label}
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: c.hex, border: "none", cursor: "pointer", padding: 0,
                  outline: color === c.id ? `2px solid ${c.hex}` : "none",
                  outlineOffset: 2,
                  boxShadow: color === c.id ? `0 0 0 1px rgba(0,0,0,0.5)` : "none",
                  transform: color === c.id ? "scale(1.2)" : "scale(1)",
                  transition: "transform 0.12s, outline 0.12s",
                }} />
            ))}
          </div>
        </div>

        {/* 操作 */}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={onDone}
            style={{
              background: "none", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 7, padding: "5px 12px",
              color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer",
            }}>取消</button>
          <button onClick={handleCreate}
            style={{
              background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)",
              borderRadius: 7, padding: "5px 14px",
              color: "#60a5fa", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>创建</button>
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
  const color = getWorkspaceColor(ws.color);
  const sessionCount = useSessionStore((s) =>
    s.sessions.filter((sess) => sess.workspaceId === ws.id).length
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
        padding: "8px 12px",
        borderRadius: 10,
        background: isActive
          ? `linear-gradient(135deg, ${color}18 0%, rgba(255,255,255,0.05) 100%)`
          : "rgba(255,255,255,0.03)",
        border: isActive
          ? `1px solid ${color}40`
          : "1px solid rgba(255,255,255,0.07)",
        cursor: "pointer",
        zIndex: total - index,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {/* 颜色标签圆点 */}
      <div style={{
        width: 10, height: 10, borderRadius: "50%",
        background: color, flexShrink: 0,
        boxShadow: `0 0 6px ${color}80`,
      }} />

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: isActive ? "#fff" : "rgba(255,255,255,0.65)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {ws.name}
        </div>
        <div style={{
          fontSize: 9, color: "rgba(255,255,255,0.25)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginTop: 1,
        }}>
          {ws.path}
        </div>
      </div>

      {/* 会话数 badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {runningCount > 0 && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 99,
            background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)",
            color: "#4ade80",
          }}>
            {runningCount} 运行
          </span>
        )}
        {sessionCount > 0 && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.3)",
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
          color: "rgba(255,255,255,0.18)", fontSize: 11,
          cursor: "pointer", padding: "2px 4px",
          borderRadius: 4, flexShrink: 0,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.18)")}
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
  // 按 order 排列，order=0 是最前面（顶层）
  const sorted = [...workspaces].sort((a, b) => a.order - b.order);
  const top = sorted[0];

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
      {/* 底层卡片（最多展示 3 层阴影） */}
      {sorted.slice(1, 4).map((ws, idx) => {
        const layerIdx = idx + 1; // 1,2,3
        const pColor = getWorkspaceColor(ws.color);
        return (
          <div key={ws.id} style={{
            position: "absolute",
            top: CARD_PEEK * layerIdx,
            left: CARD_OFFSET_X * layerIdx,
            right: -(CARD_OFFSET_X * layerIdx),
            height: CARD_H,
            borderRadius: 10,
            background: `${pColor}18`,
            border: `1px solid ${pColor}25`,
            zIndex: 10 - layerIdx,
          }} />
        );
      })}

      {/* 顶层卡片（主卡片，完整显示） */}
      <motion.div
        layoutId={`ws-card-${top.id}`}
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: CARD_H,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${topColor}22 0%, rgba(255,255,255,0.06) 100%)`,
          border: `1px solid ${topColor}45`,
          zIndex: 20,
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 12px",
        }}
        whileHover={{ scale: 1.01 }}
        transition={SPRING}
      >
        {/* 颜色点 */}
        <div style={{
          width: 9, height: 9, borderRadius: "50%",
          background: topColor, flexShrink: 0,
          boxShadow: `0 0 5px ${topColor}90`,
        }} />

        {/* 名称 + 路径 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {top.name}
          </div>
        </div>

        {/* 数量提示 */}
        {sorted.length > 1 && (
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.35)",
          }}>
            +{sorted.length - 1}
          </span>
        )}

        {/* 展开提示箭头 */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </motion.div>

      {/* Finder 颜色标签条（底部露出） */}
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
            opacity: ws.id === activeId ? 1 : 0.4,
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
  const sorted = useWorkspacesSorted();

  const [expanded, setExpanded] = useState(false);
  // 没有 workspace 时直接打开表单，让用户首次进入就能立刻添加
  const [showForm, setShowForm] = useState(workspaces.length === 0);
  // hover 展开防抖 ref：避免鼠标经过时立即展开触发布局突变导致窗口失焦
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 没有 workspace 时只渲染添加表单（直接展开，无需再点按钮）
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
                padding: "10px 0",
                background: "rgba(255,255,255,0.04)",
                border: "1px dashed rgba(255,255,255,0.12)",
                borderRadius: 10, cursor: "pointer",
                color: "rgba(255,255,255,0.35)", fontSize: 11,
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* ── 标题栏 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 2px 4px",
      }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: 0.4 }}>
          WORKSPACE
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {/* 展开/收起切换 */}
          {workspaces.length > 1 && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                background: "none", border: "none",
                color: "rgba(255,255,255,0.3)", fontSize: 10,
                cursor: "pointer", padding: "2px 6px", borderRadius: 5,
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = "rgba(255,255,255,0.3)";
                e.currentTarget.style.background = "none";
              }}
            >
              {expanded ? "收起" : "全部"}
            </button>
          )}
          {/* 添加按钮 */}
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              background: showForm ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.07)",
              border: showForm ? "1px solid rgba(96,165,250,0.3)" : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6, padding: "2px 7px",
              color: showForm ? "#60a5fa" : "rgba(255,255,255,0.5)",
              fontSize: 11, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
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
          /* 展开：每个 workspace 都显示为独立卡片 */
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
          /* 收起：堆叠展示，hover 时自动展开 */
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
                // 防抖 300ms：避免鼠标快速掠过时触发展开（会导致布局突变 → 窗口失焦）
                if (sorted.length <= 1) return;
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = setTimeout(() => {
                  setExpanded(true);
                }, 300);
              }}
              onHoverEnd={() => {
                // 离开时取消待定的展开
                if (hoverTimerRef.current) {
                  clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
              }}
              onClick={() => {
                // 点击直接展开（不依赖 hover 防抖）
                if (sorted.length > 1) setExpanded(true);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
