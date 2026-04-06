import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

export function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const { openSettings } = useSettingsStore();
  const [hoverClose, setHoverClose] = useState(false);

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 14px 10px",
        borderBottom: "1px solid var(--ci-border)",
        cursor: "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        background: "transparent",
      }}
    >
      {/* 左侧：交通灯按钮区 */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {/* 关闭按钮（红色） */}
        <button
          onClick={() => invoke("close_popup").catch(() => {})}
          onMouseEnter={() => setHoverClose(true)}
          onMouseLeave={() => setHoverClose(false)}
          title="关闭"
          style={{
            width: 13, height: 13,
            borderRadius: "50%",
            background: "#ff5f57",
            border: "0.5px solid rgba(0,0,0,0.12)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
            transition: "filter 0.1s",
            filter: hoverClose ? "brightness(0.85)" : "none",
            flexShrink: 0,
          }}
        >
          {hoverClose && (
            <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
              <path d="M1 1l4 4M5 1L1 5" stroke="rgba(100,0,0,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          )}
        </button>

        {/* 最小化（黄色，装饰性） */}
        <div style={{
          width: 13, height: 13, borderRadius: "50%",
          background: "#febc2e",
          border: "0.5px solid rgba(0,0,0,0.1)",
          flexShrink: 0,
        }} />

        {/* 最大化（绿色，装饰性） */}
        <div style={{
          width: 13, height: 13, borderRadius: "50%",
          background: "#28c840",
          border: "0.5px solid rgba(0,0,0,0.1)",
          flexShrink: 0,
        }} />
      </div>

      {/* 中间：标题 */}
      <div style={{
        position: "absolute", left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        gap: 6,
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: "linear-gradient(135deg, #5e5ce6, #7c6df0)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, flexShrink: 0,
          boxShadow: "0 1px 4px rgba(94,92,230,0.4)",
        }}>
          ⌘
        </div>
        <span style={{
          color: "var(--ci-text)",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}>
          Coding Island
        </span>
        {sessions.length > 0 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "var(--ci-accent-bg)",
            color: "var(--ci-accent)",
            fontWeight: 600,
          }}>
            {sessions.length}
          </span>
        )}
      </div>

      {/* 右侧：设置按钮 */}
      <button
        onClick={() => openSettings()}
        title="设置"
        style={{
          background: "var(--ci-btn-ghost-bg)",
          border: "0.5px solid var(--ci-border)",
          color: "var(--ci-text-muted)",
          borderRadius: 6, width: 24, height: 24,
          cursor: "pointer", fontSize: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "var(--ci-btn-ghost-hover)";
          e.currentTarget.style.color = "var(--ci-text)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "var(--ci-btn-ghost-bg)";
          e.currentTarget.style.color = "var(--ci-text-muted)";
        }}
      >
        ⚙
      </button>
    </div>
  );
}
