import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { TrafficLights } from "./TrafficLights";

export function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const { openSettings } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px 8px",
        borderBottom: "none",
        cursor: "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
        position: "relative",
        zIndex: 2,
        textShadow,
      }}
    >
      <TrafficLights onClose={() => invoke("close_popup").catch(() => {})} />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 7,
              background: "var(--ci-accent-bg)",
              border: "1px solid var(--ci-accent-bdr)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
              color: "var(--ci-accent)",
            }}
          >
            ⌘
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                color: "var(--ci-text)",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              Code Bar
            </span>
            {sessions.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--ci-accent)", fontWeight: 700 }}>
                {sessions.length}
              </span>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={() => openSettings()}
        title="设置"
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          background: "var(--ci-close-bg)",
          border: "0.5px solid var(--ci-close-border)",
          color: "var(--ci-text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
          textShadow: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isGlass ? "var(--ci-close-bg)" : "var(--ci-btn-ghost-hover)";
          e.currentTarget.style.borderColor = "var(--ci-toolbar-border)";
          e.currentTarget.style.color = "var(--ci-text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--ci-close-bg)";
          e.currentTarget.style.borderColor = "var(--ci-close-border)";
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
