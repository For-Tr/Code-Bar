import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { PtyTerminal } from "./PtyTerminal";

// 弹簧参数
const SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 0.9,
};

// ── 单个 Session 的常驻 PTY 面板 ─────────────────────────────
interface PanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

function SessionPanel({ sessionId, isOpen, onClose }: PanelProps) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const { updateSession } = useSessionStore();
  const { settings } = useSettingsStore();
  const hasOpenedRef = useRef(false);

  // query 相关状态
  const [pendingQuery, setPendingQuery] = useState("");
  // querySent: query 已发送，隐藏输入遮罩，显示终端
  const [querySent, setQuerySent] = useState(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    return !!s?.currentTask;
  });
  const queryInputRef = useRef<HTMLTextAreaElement>(null);

  // sessionId 变化时重置（切换 session）
  useEffect(() => {
    const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
    setQuerySent(!!s?.currentTask);
    setPendingQuery("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 展开/收起时调整窗口大小
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      invoke("resize_popup_full", { width: 700, height: 600 }).catch(() => {});
    } else if (hasOpenedRef.current) {
      invoke("resize_popup_full", { width: 376, height: 400 }).catch(() => {});
    }
  }, [isOpen]);

  // 展开且未发送 query 时自动聚焦输入框
  useEffect(() => {
    if (isOpen && !querySent) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen, querySent]);

  // CLI 配置
  const { runner } = settings;
  const cliCommand =
    runner.type === "claude-code" ? runner.cliPath || "claude"
    : runner.type === "codex" ? runner.cliPath || "codex"
    : runner.cliPath || "sh";

  const cliArgs: string[] =
    runner.type === "claude-code"
      ? ["--dangerously-skip-permissions"]
      : runner.type === "codex"
      ? []
      : runner.cliArgs ? runner.cliArgs.split(/\s+/).filter(Boolean) : [];

  // PTY 是否已启动过（首次展开后就保持 true，避免收起时 active=false 触发重启逻辑）
  const [ptyEverActive, setPtyEverActive] = useState(false);
  useEffect(() => {
    if (isOpen && !ptyEverActive) setPtyEverActive(true);
  }, [isOpen, ptyEverActive]);

  // PTY 是否已就绪（start_pty_session 成功返回后置为 true）
  const ptyReadyRef = useRef(false);
  // 用 ref 保存 sessionId，供稳定回调访问（避免闭包过时）
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // PTY 就绪回调：仅在 query 已提交但还没发送时消费
  const pendingQueryRef = useRef<string | null>(null);
  const handlePtyReady = useCallback(() => {
    ptyReadyRef.current = true;
    const q = pendingQueryRef.current;
    if (!q) return;
    pendingQueryRef.current = null;
    setTimeout(() => {
      const bytes = new TextEncoder().encode(q + "\n");
      const b64 = btoa(String.fromCharCode(...bytes));
      invoke("write_pty", { sessionId: sessionIdRef.current, data: b64 }).catch(() => {});
    }, 200);
  }, []); // 纯 ref 访问，永不更新引用

  // 用户提交 query
  const handleSubmitQuery = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !session) return;
    const title = trimmed.length > 24 ? trimmed.slice(0, 24) + "…" : trimmed;
    updateSession(session.id, { name: title, currentTask: trimmed, status: "running" });
    setQuerySent(true);

    const sendQuery = () => {
      const bytes = new TextEncoder().encode(trimmed + "\n");
      const b64 = btoa(String.fromCharCode(...bytes));
      invoke("write_pty", { sessionId: sessionIdRef.current, data: b64 }).catch(() => {});
    };

    if (ptyReadyRef.current) {
      // PTY 已就绪（面板打开时就启动了），Claude 正在交互等待输入
      setTimeout(sendQuery, 100);
    } else {
      // PTY 还在启动，等 onReady 回调消费
      pendingQueryRef.current = trimmed;
    }
  }, [session, updateSession]);

  if (!session) return null;

  return (
    <motion.div
      initial={false}
      animate={isOpen
        ? { opacity: 1, scale: 1, pointerEvents: "auto" as const }
        : { opacity: 0, scale: 0.96, pointerEvents: "none" as const }
      }
      transition={SPRING}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 100,
        borderRadius: 18,
        overflow: "hidden",
        background: "rgba(10,10,12,0.97)",
        backdropFilter: "blur(48px)",
        WebkitBackdropFilter: "blur(48px)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: [
          "0 8px 16px rgba(0,0,0,0.4)",
          "0 40px 80px rgba(0,0,0,0.6)",
          "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
        ].join(", "),
        display: "flex",
        flexDirection: "column",
        visibility: isOpen ? "visible" : "hidden",
      }}
    >
      {/* ── 标题栏 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onClose}
            style={{
              width: 12, height: 12, borderRadius: "50%",
              background: "#f87171", border: "none", cursor: "pointer", padding: 0,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
        </div>

        <span style={{
          flex: 1, fontSize: 12, fontWeight: 600,
          color: "rgba(255,255,255,0.8)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {session.name}
        </span>

        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 99,
          background: "rgba(96,165,250,0.12)",
          border: "1px solid rgba(96,165,250,0.22)",
          color: "#60a5fa", fontFamily: "monospace",
        }}>
          {cliCommand.split("/").pop()}
        </span>

        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6, padding: "2px 8px",
            color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "rgba(255,255,255,0.8)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          }}
        >
          收起
        </button>
      </div>

      {/* ── 内容区域 ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* PTY 终端：面板打开就启动（active=isOpen），常驻，query 发送后才变可见 */}
        <div style={{
          flex: 1, overflow: "hidden", padding: "8px 4px 4px",
          opacity: querySent ? 1 : 0,
          pointerEvents: querySent ? "auto" : "none",
        }}>
          <PtyTerminal
            sessionId={session.id}
            command={cliCommand}
            args={cliArgs}
            workdir={session.workdir}
            active={ptyEverActive}
            onReady={handlePtyReady}
          />
        </div>

        {/* Query 输入遮罩（PTY 已启动但 query 尚未发送时显示） */}
        <AnimatePresence>
          {!querySent && (
            <motion.div
              key="query-input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                padding: "24px 32px", gap: 16,
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.22)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
              }}>
                ✦
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)", marginBottom: 4 }}>
                  描述你的任务
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  回车后将自动启动 {cliCommand.split("/").pop()} 并透传给 AI
                </div>
              </div>

              <div style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "10px 14px",
              }}>
                <span style={{ color: "rgba(96,165,250,0.7)", fontSize: 13, marginTop: 1, flexShrink: 0 }}>›</span>
                <textarea
                  ref={queryInputRef}
                  value={pendingQuery}
                  onChange={e => setPendingQuery(e.target.value)}
                  placeholder="例：重构 auth 模块，添加 JWT 支持…"
                  rows={3}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitQuery(pendingQuery);
                    }
                  }}
                  style={{
                    flex: 1, background: "none", border: "none", outline: "none",
                    color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: "1.6",
                    resize: "none", fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                Enter 发送 · Shift+Enter 换行 · Esc 关闭
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── 主组件：渲染所有 session 的面板（常驻挂载） ───────────────
export function SessionDetail() {
  const { sessions, expandedSessionId, setExpandedSession } = useSessionStore();

  // Esc 关闭当前展开的面板
  useEffect(() => {
    if (!expandedSessionId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSession(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedSessionId, setExpandedSession]);

  return (
    <>
      {sessions.map((session) => (
        <SessionPanel
          key={session.id}
          sessionId={session.id}
          isOpen={expandedSessionId === session.id}
          onClose={() => setExpandedSession(null)}
        />
      ))}
    </>
  );
}
