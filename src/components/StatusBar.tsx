import { ClaudeSession, SessionStatus } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle:    "空闲",
  running: "运行中",
  waiting: "等待确认",
  done:    "完成",
  error:   "出错",
};

// 状态颜色保留固定值（语义化，不随主题变化）
const STATUS_COLOR: Record<SessionStatus, string> = {
  idle:    "rgba(120,120,128,0.4)",
  running: "#34C759",
  waiting: "#FF9F0A",
  done:    "#007AFF",
  error:   "#FF3B30",
};

export function StatusBar({ session }: { session?: ClaudeSession }) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));

  return (
    <div style={{
      padding: "10px 16px 12px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderTop: "1px solid var(--ci-toolbar-border)",
      background: "var(--ci-status-bg)",
      backdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
      WebkitBackdropFilter: isGlass ? "none" : "blur(18px) saturate(1.2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {session && (
          <>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: STATUS_COLOR[session.status],
              boxShadow: `0 0 4px ${STATUS_COLOR[session.status]}60`,
            }} />
            <span style={{
              fontSize: 10, color: "var(--ci-text-dim)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "-apple-system, monospace",
              padding: "4px 8px",
              borderRadius: 999,
              background: "var(--ci-pill-bg)",
              border: "1px solid var(--ci-pill-border)",
              boxShadow: "var(--ci-inset-highlight)",
            }}>
              {session.workdir}
            </span>
            <span style={{
              fontSize: 10, color: STATUS_COLOR[session.status],
              flexShrink: 0, fontWeight: 500,
            }}>
              · {STATUS_LABEL[session.status]}
            </span>
          </>
        )}
        {!session && (
          <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>
            无活跃会话
          </span>
        )}
      </div>
      <span style={{
        fontSize: 10,
        color: "var(--ci-text-dim)",
        flexShrink: 0,
        fontWeight: 400,
        opacity: 0.7,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        esc 关闭
      </span>
    </div>
  );
}
