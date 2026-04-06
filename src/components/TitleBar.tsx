import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { TrafficLights } from "./TrafficLights";

export function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const { openSettings } = useSettingsStore();

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
      <TrafficLights onClose={() => invoke("close_popup").catch(() => {})} />

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
          Code Bar
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
          borderRadius: 6, width: 26, height: 26,
          cursor: "pointer",
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  );
}
