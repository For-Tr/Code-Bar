import { GitMerge, Check } from "lucide-react";
import { resolveConflict } from "../../services/scmCommands";
import { useScmStore } from "../../store/scmStore";
import { CodeEditorSurface } from "./CodeEditorSurface";
import { WorkbenchTooltip } from "../ui/WorkbenchTooltip";

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
        padding: "8px 12px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ci-text-dim)", fontSize: 11 }}>
          <GitMerge size={12} strokeWidth={1.8} />
          SCM · Conflict
        </div>
        <div style={{ minWidth: 0, flex: 1, fontSize: 11, color: "var(--ci-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <WorkbenchTooltip label="Accept Ours">
            <button
              onClick={() => void resolveConflict(sessionId, path, "ours")}
              disabled={busy}
              style={{
                background: "none",
                border: "none",
                color: busy ? "var(--ci-text-dim)" : "var(--ci-accent)",
                width: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: busy ? "default" : "pointer",
                padding: 0,
              }}
            >
              <Check size={13} strokeWidth={2} />
            </button>
          </WorkbenchTooltip>
          <WorkbenchTooltip label="Accept Theirs">
            <button
              onClick={() => void resolveConflict(sessionId, path, "theirs")}
              disabled={busy}
              style={{
                background: "none",
                border: "none",
                color: busy ? "var(--ci-text-dim)" : "var(--ci-text-muted)",
                width: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: busy ? "default" : "pointer",
                padding: 0,
              }}
            >
              <GitMerge size={13} strokeWidth={1.8} />
            </button>
          </WorkbenchTooltip>
        </div>
      </div>

      {actionError && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--ci-toolbar-border)", fontSize: 11, color: "var(--ci-deleted-text)", lineHeight: 1.6 }}>
          {actionError}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {payload.versions.map((version) => (
          <div key={version.label} style={{ minHeight: 0, display: "flex", flexDirection: "column", borderRight: version.label === "ours" || version.label === "working" ? "none" : "1px solid var(--ci-toolbar-border)", borderBottom: version.label === "base" || version.label === "ours" ? "1px solid var(--ci-toolbar-border)" : "none" }}>
            <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-toolbar-bg)", fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
