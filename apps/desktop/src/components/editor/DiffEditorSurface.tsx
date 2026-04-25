import { GitCommitHorizontal } from "lucide-react";
import { useAppI18n } from "../../i18n";
import { DiffViewer } from "../DiffViewer";
import { applyScmHunk } from "../../services/scmCommands";
import { type DiffFile } from "../../store/sessionStore";
import { type ScmSelectedEntry, useScmStore } from "../../store/scmStore";

export function DiffEditorSurface({
  sessionId,
  file,
  selectedEntry,
}: {
  sessionId: string;
  file: DiffFile | null;
  selectedEntry: ScmSelectedEntry | null;
}) {
  const { t } = useAppI18n();
  const busy = useScmStore((s) => s.actionPendingBySessionId[sessionId] ?? false);

  if (!file) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "var(--ci-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
        {selectedEntry?.group === "untracked"
          ? t("diff.untrackedFile", { path: selectedEntry.path })
          : selectedEntry?.group === "conflicts"
          ? t("diff.conflictFile", { path: selectedEntry.path })
          : t("diff.noDiff")}
      </div>
    );
  }

  const fileMode = selectedEntry?.group === "staged" || selectedEntry?.group === "unstaged"
    ? selectedEntry.group
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {selectedEntry && (
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--ci-toolbar-border)",
          background: "transparent",
          fontSize: 11,
          color: "var(--ci-text-dim)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <GitCommitHorizontal size={12} strokeWidth={1.8} />
          SCM · {t(`diff.group${selectedEntry.group.charAt(0).toUpperCase()}${selectedEntry.group.slice(1)}`)}
          <span style={{ marginInlineStart: 8, color: "var(--ci-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <DiffViewer
          files={[file]}
          fileMode={fileMode}
          busy={busy}
          contentMaxHeight="none"
          onStageHunk={fileMode === "unstaged" ? (path, hunkIndex) => void applyScmHunk(sessionId, path, "unstaged", hunkIndex, "stage") : undefined}
          onDiscardHunk={fileMode === "unstaged" ? (path, hunkIndex) => void applyScmHunk(sessionId, path, "unstaged", hunkIndex, "discard") : undefined}
          onUnstageHunk={fileMode === "staged" ? (path, hunkIndex) => void applyScmHunk(sessionId, path, "staged", hunkIndex, "unstage") : undefined}
        />
      </div>
    </div>
  );
}
