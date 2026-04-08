import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { TrafficLights } from "./TrafficLights";

export function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const { openSettings } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const strongTextShadow = isGlass ? "var(--ci-glass-text-shadow-strong)" : "none";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px 12px",
        borderBottom: isGlass ? "none" : "1px solid var(--ci-toolbar-border)",
        cursor: "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        background: isGlass ? "var(--ci-toolbar-bg)" : "var(--ci-toolbar-bg)",
        backdropFilter: isGlass ? "none" : "blur(18px) saturate(1.3)",
        WebkitBackdropFilter: isGlass ? "none" : "blur(18px) saturate(1.3)",
        position: "relative",
        zIndex: 2,
        textShadow,
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
          width: 20, height: 20, borderRadius: 7,
          background: "linear-gradient(135deg, var(--ci-accent), #a78bfa)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, flexShrink: 0,
          boxShadow: "0 6px 18px rgba(90,120,255,0.28)",
          color: "#fff",
        }}>
          ⌘
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 11px",
          borderRadius: 999,
          background: "var(--ci-pill-bg)",
          border: "1px solid var(--ci-pill-border)",
          boxShadow: "var(--ci-inset-highlight), var(--ci-card-shadow)",
          backdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
          WebkitBackdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
          opacity: 1,
          textShadow: strongTextShadow,
        }}>
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
              fontSize: 10, padding: "2px 7px", borderRadius: 99,
              background: "var(--ci-accent-bg)",
              color: "var(--ci-accent)",
              fontWeight: 700,
            }}>
              {sessions.length}
            </span>
          )}
        </div>
      </div>

      {/* 右侧：设置按钮 */}
      <button
        onClick={() => openSettings()}
        title="设置"
        style={{
          background: "var(--ci-pill-bg)",
          border: "1px solid var(--ci-pill-border)",
          color: "var(--ci-text-muted)",
          borderRadius: 999, width: 30, height: 30,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "color 0.15s, border-color 0.15s",
          boxShadow: "var(--ci-inset-highlight), var(--ci-card-shadow)",
          backdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
          WebkitBackdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
          opacity: 1,
          textShadow,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = isGlass ? "var(--ci-pill-bg)" : "var(--ci-btn-ghost-hover)";
          e.currentTarget.style.color = "var(--ci-text)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "var(--ci-pill-bg)";
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
