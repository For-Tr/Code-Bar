import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";

export function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "11px 14px 9px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, flexShrink: 0,
          boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
        }}>
          ⌘
        </div>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Coding Island
        </span>
        {sessions.length > 0 && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: "rgba(99,102,241,0.18)", color: "#a5b4fc",
          }}>
            {sessions.length}
          </span>
        )}
      </div>

      <button
        onClick={() => invoke("close_popup").catch(() => {})}
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.35)",
          borderRadius: 6, width: 22, height: 22,
          cursor: "pointer", fontSize: 11,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(239,68,68,0.15)";
          e.currentTarget.style.color = "#f87171";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.35)";
        }}
      >
        ✕
      </button>
    </div>
  );
}
