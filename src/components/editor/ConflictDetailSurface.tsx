import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { CodeEditorSurface } from "./CodeEditorSurface";

interface SessionFileReadResult {
  content: string;
  versionToken: string | null;
  isBinary: boolean;
  missing: boolean;
}

export function ConflictDetailSurface({
  sessionId,
  path,
}: {
  sessionId: string;
  path: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isBinary, setIsBinary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void invoke<SessionFileReadResult>("read_session_file", {
      sessionId,
      relativePath: path,
    }).then((payload) => {
      if (cancelled) return;
      setContent(payload.content);
      setIsBinary(payload.isBinary);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [path, sessionId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
      }}>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)", marginBottom: 4 }}>SCM · Conflict</div>
        <div style={{ fontSize: 12, color: "var(--ci-text)", fontWeight: 600 }}>{path}</div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--ci-deleted-text)", lineHeight: 1.6 }}>
          该文件当前存在冲突。第一阶段先提供只读预览，后续再补完整的冲突解决视图（ours / theirs / base）。
        </div>
      </div>
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--ci-text-dim)", fontSize: 12 }}>
          载入冲突文件中…
        </div>
      ) : error ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: 24, color: "var(--ci-deleted-text)", fontSize: 12, lineHeight: 1.7 }}>
          {error}
        </div>
      ) : isBinary ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: 24, color: "var(--ci-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
          冲突文件是二进制内容，当前暂不支持预览。
        </div>
      ) : (
        <CodeEditorSurface
          path={path}
          value={content}
          onChange={() => {}}
          readOnly
        />
      )}
    </div>
  );
}
