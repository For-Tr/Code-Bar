import { ClaudeSession, SessionStatus } from "../store/sessionStore";

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle:    "空闲",
  running: "运行中",
  waiting: "等待确认",
  done:    "完成",
  error:   "出错",
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  idle:    "rgba(255,255,255,0.2)",
  running: "#4ade80",
  waiting: "#fbbf24",
  done:    "#60a5fa",
  error:   "#f87171",
};

export function StatusBar({ session }: { session?: ClaudeSession }) {
  return (
    <div style={{
      padding: "5px 14px 8px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderTop: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {session && (
          <>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: STATUS_COLOR[session.status],
            }} />
            <span style={{
              fontSize: 10, color: "rgba(255,255,255,0.25)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {session.workdir}
            </span>
            <span style={{
              fontSize: 10, color: STATUS_COLOR[session.status],
              flexShrink: 0,
            }}>
              · {STATUS_LABEL[session.status]}
            </span>
          </>
        )}
        {!session && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)" }}>
            无活跃会话
          </span>
        )}
      </div>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", flexShrink: 0 }}>
        esc 关闭
      </span>
    </div>
  );
}
