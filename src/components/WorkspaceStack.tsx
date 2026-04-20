import { useEffect, useMemo, useState, useRef } from "react";
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
import { useSessionStore, type ClaudeSession } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";

// ── 常量 ─────────────────────────────────────────────────────
const SUMMARY_ROW_H = 34;
const EMPTY_SESSIONS: ClaudeSession[] = [];

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

  const handleCreate = async () => {
    const trimmed = path.trim();
    if (!trimmed) { setError("请选择工作目录"); return; }
    const workspaceId = addWorkspace(trimmed, name.trim() || undefined, color);
    if ("__TAURI_INTERNALS__" in window) {
      await invoke("clear_deleted_items", {
        sessionIds: [],
        workspaceIds: [],
        sessionRefs: [],
        workspaceRefs: [{ workspaceId, path: trimmed }],
      }).catch((e) => {
        console.warn("[ui-state] clear deleted workspace failed:", e);
      });
    }
    invoke("trust_workspace", { path: trimmed }).catch(() => {});
    onDone();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "transparent",
    border: "1px solid var(--ci-border)",
    borderRadius: 7, padding: "6px 9px",
    color: "var(--ci-text)", fontSize: 11.5, outline: "none",
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
        borderRadius: 10, padding: 10,
        display: "flex", flexDirection: "column", gap: 8,
        marginBottom: 4,
        boxShadow: "none",
        textShadow,
      }}>
        <div style={{
          fontSize: 11.5, fontWeight: 600,
          color: "var(--ci-text)", letterSpacing: -0.1,
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
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
          <button onClick={onDone}
            style={{
              background: "transparent",
              border: "1px solid var(--ci-border)",
              borderRadius: 7, padding: "5px 12px",
              color: "var(--ci-text-muted)", fontSize: 11.5, cursor: "pointer",
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
              borderRadius: 7, padding: "5px 14px",
              color: "var(--ci-accent)", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
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
  ws, isActive, onClick, onRemove,
}: {
  ws: Workspace;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = getWorkspaceColor(ws.color);
  const sessions = useSessionStore((s) => (Array.isArray(s.sessions) ? s.sessions : EMPTY_SESSIONS));
  const { sessionCount, waitingCount, runningCount } = useMemo(() => {
    return sessions.reduce(
      (counts, sess) => {
        if (!sess || typeof sess !== "object") return counts;
        if (sess.workspaceId !== ws.id) return counts;
        counts.sessionCount += 1;
        if (sess.status === "waiting") counts.waitingCount += 1;
        if (sess.status === "running") counts.runningCount += 1;
        return counts;
      },
      { sessionCount: 0, waitingCount: 0, runningCount: 0 }
    );
  }, [sessions, ws.id]);
  const showActions = hovered || isActive;
  const summaryParts = [
    waitingCount > 0 ? `${waitingCount} 待操作` : null,
    runningCount > 0 ? `${runningCount} 运行` : null,
    sessionCount > 0 ? `${sessionCount} 会话` : null,
  ].filter(Boolean);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 32,
        padding: "6px 8px 6px 10px",
        borderRadius: 7,
        background: isActive ? "var(--ci-list-active-bg)" : hovered ? "var(--ci-list-hover-bg)" : "transparent",
        border: "1px solid transparent",
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      {isActive && (
        <div style={{
          position: "absolute",
          left: 0,
          top: 4,
          bottom: 4,
          width: 2,
          borderRadius: 99,
          background: color,
        }} />
      )}

      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{
            color: isActive || hovered ? "var(--ci-text)" : "var(--ci-text-muted)",
            fontSize: 11.5,
            fontWeight: isActive ? 700 : 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}>
            {ws.name}
          </span>
          {waitingCount > 0 && (
            <span style={{
              fontSize: 8.5,
              padding: "1px 5px",
              borderRadius: 99,
              background: "var(--ci-yellow-bg)",
              border: "1px solid var(--ci-yellow-bdr)",
              color: "var(--ci-yellow-dark)",
              flexShrink: 0,
              fontWeight: 600,
            }}>
              {waitingCount}
            </span>
          )}
          {runningCount > 0 && (
            <span style={{
              fontSize: 8.5,
              padding: "1px 5px",
              borderRadius: 99,
              background: "var(--ci-green-bg)",
              border: "1px solid var(--ci-green-bdr)",
              color: "var(--ci-green-dark)",
              flexShrink: 0,
              fontWeight: 600,
            }}>
              {runningCount}
            </span>
          )}
        </div>
        <p style={{
          margin: "1px 0 0",
          fontSize: 9.5,
          color: "var(--ci-text-dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {hovered || isActive ? ws.path : summaryParts.join(" · ") || ws.path}
        </p>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        opacity: showActions ? 1 : 0,
        pointerEvents: showActions ? "auto" : "none",
        transition: "opacity 0.12s",
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="删除 workspace"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ci-text-dim)",
            fontSize: 11,
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 4,
            flexShrink: 0,
          }}
        >✕</button>
      </div>
    </div>
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

  if (!top) return null;

  const topColor = getWorkspaceColor(top.color);

  return (
    <div
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={onClick}
      style={{
        position: "relative",
        height: SUMMARY_ROW_H,
        cursor: sorted.length > 1 ? "pointer" : "default",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 7,
          background: activeId === top.id ? "var(--ci-list-active-bg)" : "transparent",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px 6px 10px",
        }}
      >
        {activeId === top.id && (
          <div style={{
            position: "absolute",
            left: 0,
            top: 4,
            bottom: 4,
            width: 2,
            borderRadius: 99,
            background: topColor,
          }} />
        )}

        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: topColor,
          flexShrink: 0,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--ci-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {top.name}
          </div>
        </div>

        {sorted.length > 1 && (
          <span style={{
            fontSize: 8.5,
            padding: "1px 5px",
            borderRadius: 99,
            background: "var(--ci-btn-ghost-bg)",
            color: "var(--ci-text-muted)",
            fontWeight: 600,
            flexShrink: 0,
          }}>
            +{sorted.length - 1}
          </span>
        )}

        {sorted.length > 1 && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "var(--ci-text-dim)", flexShrink: 0 }}>
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
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
  const suppressHoverExpandRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const collapsedHeight = SUMMARY_ROW_H;

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!suppressHoverExpandRef.current || expanded) return;
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) {
        suppressHoverExpandRef.current = false;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!expanded || !target) return;
      if (rootRef.current?.contains(target)) return;
      suppressHoverExpandRef.current = false;
      setExpanded(false);
    };

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [expanded]);

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
                padding: "10px 0",
                background: "var(--ci-surface)",
                border: `1px dashed var(--ci-border-med)`,
                borderRadius: 8, cursor: "pointer",
                color: "var(--ci-text-muted)", fontSize: 11.5,
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
              <span style={{ fontSize: 14, lineHeight: 1, color: "var(--ci-accent)" }}>+</span>
              添加 Workspace
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const handleRemove = async (id: string) => {
    const sessionsToRemove = useSessionStore
      .getState()
      .sessions
      .filter((session) => session.workspaceId === id);
    const workspace = workspaces.find((item) => item.id === id);

    if ("__TAURI_INTERNALS__" in window) {
      await invoke("mark_deleted_items", {
        sessionIds: [],
        workspaceIds: [],
        sessionRefs: sessionsToRemove.map((session) => ({
          sessionId: session.id,
          workspaceId: session.workspaceId,
        })),
        workspaceRefs: workspace ? [{ workspaceId: id, path: workspace.path }] : [{ workspaceId: id }],
      }).catch((e) => {
        console.warn("[ui-state] mark deleted workspace failed:", e);
      });
    }

    removeSessionsByWorkspace(id);
    removeWorkspace(id);

    if (!("__TAURI_INTERNALS__" in window) || !workspace?.path) {
      return;
    }

    sessionsToRemove.forEach((session: ClaudeSession) => {
      if (!session.worktreePath || !session.branchName) return;

      invoke("teardown_session_worktree", {
        workdir: workspace.path,
        worktreePath: session.worktreePath,
        branch: session.branchName,
      }).catch((e) => {
        console.warn("[worktree] workspace teardown failed:", e);
      });
    });
  };
  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                background: "none",
                border: "none",
                color: "var(--ci-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                padding: "6px 2px",
                borderRadius: 0,
                fontWeight: 600,
                transition: "color 0.12s, opacity 0.12s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = "var(--ci-text)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = "var(--ci-text-muted)";
              }}
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              background: "none",
              border: "none",
              borderRadius: 0,
              padding: "6px 2px",
              color: showForm ? "var(--ci-accent)" : "var(--ci-text-muted)",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 600,
              transition: "color 0.12s, opacity 0.12s",
              lineHeight: 1,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = showForm ? "var(--ci-accent)" : "var(--ci-text)";
              e.currentTarget.style.opacity = showForm ? "0.78" : "1";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = showForm ? "var(--ci-accent)" : "var(--ci-text-muted)";
              e.currentTarget.style.opacity = "1";
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
      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : collapsedHeight,
          opacity: 1,
        }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: "hidden" }}
      >
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            style={{ display: "flex", flexDirection: "column", gap: 4, transformOrigin: "top center" }}
          >
            {sorted.map((ws) => (
              <WorkspaceCardExpanded
                key={ws.id}
                ws={ws}
                isActive={ws.id === activeWorkspaceId}
                onClick={() => {
                  bringToFront(ws.id);
                  const point = lastPointerRef.current;
                  if (point && rootRef.current) {
                    const rect = rootRef.current.getBoundingClientRect();
                    suppressHoverExpandRef.current =
                      point.x >= rect.left &&
                      point.x <= rect.right &&
                      point.y >= rect.top &&
                      point.y <= rect.bottom;
                  } else {
                    suppressHoverExpandRef.current = true;
                  }
                  setExpanded(false);
                }}
                onRemove={() => handleRemove(ws.id)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0.92 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <WorkspaceStackCollapsed
              workspaces={sorted}
              activeId={activeWorkspaceId}
              onHoverStart={() => {
                if (sorted.length <= 1 || suppressHoverExpandRef.current) return;
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
      </motion.div>
    </div>
  );
}
