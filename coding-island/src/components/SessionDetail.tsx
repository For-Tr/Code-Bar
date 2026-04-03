import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeSession, useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { PtyTerminal } from "./PtyTerminal";

// 弹簧参数——夸张的弹性感
const SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 0.9,
};

interface Props {
  session: ClaudeSession | null;
}

export function SessionDetail({ session }: Props) {
  const { expandedSessionId, setExpandedSession } = useSessionStore();
  const { settings } = useSettingsStore();
  const isOpen = !!expandedSessionId && expandedSessionId === session?.id;
  // 记录是否已经至少打开过一次，避免初次渲染时误触发收起 resize
  const hasOpenedRef = useRef(false);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSession(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, setExpandedSession]);

  // 展开时扩大窗口（宽 + 高），关闭时恢复原来的窄窗口
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      // 展开：宽 700, 高 600
      invoke("resize_popup_full", { width: 700, height: 600 }).catch(() => {});
    } else if (hasOpenedRef.current) {
      // 收起（只在曾打开过之后才恢复）：宽 376, 高 400
      invoke("resize_popup_full", { width: 376, height: 400 }).catch(() => {});
    }
  }, [isOpen]);

  // 获取 CLI 命令
  const { runner } = settings;
  const cliCommand =
    runner.type === "claude-code"
      ? runner.cliPath || "claude"
      : runner.type === "codex"
      ? runner.cliPath || "codex"
      : runner.cliPath || "sh";

  const cliArgs: string[] =
    runner.type === "claude-code"
      ? []
      : runner.type === "codex"
      ? []
      : runner.cliArgs
      ? runner.cliArgs.split(/\s+/).filter(Boolean)
      : [];

  return (
    <AnimatePresence>
      {isOpen && session && (
        <>
          {/* 遮罩已被面板覆盖，这里仅保留以便将来扩展 */}

          {/* ── 终端面板（从卡片位置弹出放大，铺满整个窗口 viewport） ── */}
          <motion.div
            key={`detail-${session.id}`}
            layoutId={`session-card-${session.id}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={SPRING}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
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
            }}
          >
            {/* ── 标题栏 ── */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}>
              {/* 交通灯 */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setExpandedSession(null)}
                  style={{
                    width: 12, height: 12, borderRadius: "50%",
                    background: "#f87171",
                    border: "none", cursor: "pointer", padding: 0,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                />
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
              </div>

              {/* Session 名称 */}
              <span style={{
                flex: 1,
                fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.8)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {session.name}
              </span>

              {/* CLI 标签 */}
              <span style={{
                fontSize: 10, padding: "2px 8px",
                borderRadius: 99,
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.22)",
                color: "#60a5fa",
                fontFamily: "monospace",
              }}>
                {cliCommand.split("/").pop()}
              </span>

              {/* 关闭按钮 */}
              <button
                onClick={() => setExpandedSession(null)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6, padding: "2px 8px",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11, cursor: "pointer",
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

            {/* ── 终端区域 ── */}
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 4px 4px" }}>
              <PtyTerminal
                sessionId={session.id}
                command={cliCommand}
                args={cliArgs}
                workdir={session.workdir}
                active={isOpen}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
