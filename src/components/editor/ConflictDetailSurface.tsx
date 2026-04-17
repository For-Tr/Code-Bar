import { resolveConflict } from "../../services/scmCommands";
import { useScmStore } from "../../store/scmStore";
import { CodeEditorSurface } from "./CodeEditorSurface";

export function ConflictDetailSurface({
  sessionId,
  path,
}: {
  sessionId: string;
  path: string;
}) {
  const payload = useScmStore((s) => s.conflictBySessionId[sessionId] ?? null);
  const busy = useScmStore((s) => s.actionPendingBySessionId[sessionId] ?? false);
  const actionError = useScmStore((s) => s.actionErrorBySessionId[sessionId] ?? null);

  if (!payload || payload.path !== path) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--ci-text-dim)", fontSize: 12 }}>
        载入冲突详情中…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
      }}>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)", marginBottom: 4 }}>SCM · Conflict</div>
        <div style={{ fontSize: 12, color: "var(--ci-text)", fontWeight: 600 }}>{path}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button
            onClick={() => void resolveConflict(sessionId, path, "ours")}
            disabled={busy}
            style={{
              background: busy ? "var(--ci-btn-ghost-bg)" : "var(--ci-accent-bg)",
              border: `1px solid ${busy ? "var(--ci-toolbar-border)" : "var(--ci-accent-bdr)"}`,
              color: busy ? "var(--ci-text-dim)" : "var(--ci-accent)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Accept Ours
          </button>
          <button
            onClick={() => void resolveConflict(sessionId, path, "theirs")}
            disabled={busy}
            style={{
              background: busy ? "var(--ci-btn-ghost-bg)" : "var(--ci-surface)",
              border: "1px solid var(--ci-toolbar-border)",
              color: busy ? "var(--ci-text-dim)" : "var(--ci-text-muted)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Accept Theirs
          </button>
        </div>
        {actionError && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--ci-deleted-text)", lineHeight: 1.6 }}>
            {actionError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {payload.versions.map((version) => (
          <div key={version.label} style={{ minHeight: 0, display: "flex", flexDirection: "column", borderRight: version.label === "ours" || version.label === "working" ? "none" : "1px solid var(--ci-toolbar-border)" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-toolbar-bg)", fontSize: 11, color: "var(--ci-text-dim)", textTransform: "uppercase" }}>
              {version.label}
            </div>
            {version.missing ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: 24, color: "var(--ci-text-dim)", fontSize: 12 }}>
                当前版本不存在。
              </div>
            ) : version.isBinary ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: 24, color: "var(--ci-text-dim)", fontSize: 12 }}>
                二进制内容暂不支持预览。
              </div>
            ) : (
              <CodeEditorSurface path={`${path}:${version.label}`} value={version.content} onChange={() => {}} readOnly />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
