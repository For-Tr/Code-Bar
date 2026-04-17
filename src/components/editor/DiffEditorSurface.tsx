import { DiffViewer } from "../DiffViewer";
import { type DiffFile } from "../../store/sessionStore";
import { type ScmSelectedEntry } from "../../store/scmStore";

const GROUP_LABELS: Record<NonNullable<ScmSelectedEntry>["group"], string> = {
  committed: "Committed in Session",
  conflicts: "Conflicts",
  staged: "Staged",
  unstaged: "Changes",
  untracked: "Untracked",
};

export function DiffEditorSurface({ file, selectedEntry }: { file: DiffFile | null; selectedEntry: ScmSelectedEntry | null }) {
  if (!file) {
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
      }}>
        {selectedEntry?.group === "untracked"
          ? `未跟踪文件：${selectedEntry.path}（后续补 file content 视图）`
          : selectedEntry?.group === "conflicts"
          ? `冲突文件：${selectedEntry.path}（后续补 conflict 视图）`
          : "当前文件暂无 diff。"}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {selectedEntry && (
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--ci-toolbar-border)",
          background: "var(--ci-toolbar-bg)",
          fontSize: 11,
          color: "var(--ci-text-dim)",
        }}>
          SCM · {GROUP_LABELS[selectedEntry.group]}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <DiffViewer files={[file]} />
      </div>
    </div>
  );
}
