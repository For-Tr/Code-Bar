import { type ClaudeSession } from "../../store/sessionStore";
import { selectScmFile } from "../../services/scmCommands";
import { resetWorkbenchMode } from "../../services/workbenchCommands";
import { useScmStore } from "../../store/scmStore";

export function ScmSidebar({ session }: { session: ClaudeSession | null }) {
  if (!session) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--ci-text-dim)",
        fontSize: 12,
        lineHeight: 1.7,
        textAlign: "center",
      }}>
        选择一个会话以查看改动。
      </div>
    );
  }

  const snapshot = useScmStore((s) => s.snapshotBySessionId[session.id]?.files ?? session.diffFiles);
  const totalAdditions = snapshot.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = snapshot.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ci-text-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            SCM
          </div>
          <div style={{ marginTop: 6, color: "var(--ci-text)", fontSize: 12, fontWeight: 700 }}>
            {session.name}
          </div>
        </div>
        <button
          onClick={resetWorkbenchMode}
          style={{
            background: "none",
            border: "none",
            color: "var(--ci-text-muted)",
            cursor: "pointer",
            padding: 0,
            fontSize: 12,
          }}
          title="返回会话视图"
        >
          ←
        </button>
      </div>

      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        color: "var(--ci-text-dim)",
      }}>
        <span>{snapshot.length} 个变更文件</span>
        <span style={{ color: "var(--ci-green-dark)", fontWeight: 700 }}>+{totalAdditions}</span>
        <span style={{ color: "var(--ci-deleted-text)", fontWeight: 700 }}>−{totalDeletions}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 12px" }}>
        {snapshot.length === 0 ? (
          <div style={{ padding: "12px 4px", color: "var(--ci-text-dim)", fontSize: 12 }}>
            当前会话暂无代码变更。
          </div>
        ) : snapshot.map((file) => (
          <button
            key={file.path}
            onClick={() => selectScmFile(session.id, file.path)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid transparent",
              background: "none",
              color: "var(--ci-text-muted)",
              cursor: "pointer",
              textAlign: "left",
            }}
            title={`打开 ${file.path} 的实际变更 diff`}
          >
            <span style={{ width: 12, textAlign: "center", color: file.type === "added" ? "var(--ci-green)" : file.type === "deleted" ? "var(--ci-red)" : "var(--ci-yellow)", fontSize: 10 }}>
              {file.type === "added" ? "A" : file.type === "deleted" ? "D" : "M"}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
              {file.path}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
