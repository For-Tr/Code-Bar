import { ClaudeSession, SessionStatus } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { useWorkspaceStore, workspaceTargetLabel } from "../store/workspaceStore";

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "空闲",
  running: "运行中",
  waiting: "等待确认",
  suspended: "已挂起",
  done: "完成",
  error: "出错",
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: "rgba(120,120,128,0.4)",
  running: "#34C759",
  waiting: "#FF9F0A",
  suspended: "#6B7280",
  done: "#007AFF",
  error: "#FF3B30",
};

export function StatusBar({ session }: { session?: ClaudeSession }) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === session?.workspaceId));
  const terminalHostLabel = session?.terminalHost === "external"
    ? "外部终端"
    : session?.terminalHost === "headless"
    ? "仅管理"
    : "内置终端";

  return (
    <div
      style={{
        padding: "10px 18px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderTop: isGlass || !session ? "none" : "1px solid var(--ci-toolbar-border)",
        background: isGlass ? "var(--ci-status-bg)" : "transparent",
        textShadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {session ? (
          <>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: STATUS_COLOR[session.status],
              }}
            />
            <span style={{ fontSize: 10, color: STATUS_COLOR[session.status], flexShrink: 0, fontWeight: 600 }}>
              {STATUS_LABEL[session.status]}
            </span>
            <span style={{ fontSize: 10, color: "var(--ci-text-dim)", flexShrink: 0, opacity: 0.45 }}>·</span>
            <span
              style={{
                fontSize: 10,
                color: "var(--ci-text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "-apple-system, monospace",
                minWidth: 0,
              }}
            >
              {session.workdir}
            </span>
            <span style={{ fontSize: 10, color: "var(--ci-text-dim)", flexShrink: 0 }}>
              · {workspace ? workspaceTargetLabel(workspace) : "本地"}
            </span>
            <span style={{ fontSize: 10, color: "var(--ci-text-dim)", flexShrink: 0 }}>
              · {terminalHostLabel}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>无活跃会话</span>
        )}
      </div>
      <span
        style={{
          fontSize: 10,
          color: "var(--ci-text-dim)",
          flexShrink: 0,
          fontWeight: 400,
          opacity: 0.7,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        esc 关闭
      </span>
    </div>
  );
}
