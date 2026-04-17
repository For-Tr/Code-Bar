import { type DiffFile, type ClaudeSession } from "../../store/sessionStore";
import {
  commitScm,
  discardScmFile,
  selectScmFile,
  stageScmFile,
  unstageScmFile,
} from "../../services/scmCommands";
import { resetWorkbenchMode } from "../../services/workbenchCommands";
import { EMPTY_SCM_GROUPS, type ScmEntryGroup, type ScmStatusEntry, useScmStore } from "../../store/scmStore";

function mapDiffFileToStatusEntry(file: DiffFile): ScmStatusEntry {
  return {
    path: file.path,
    kind: file.type === "added" ? "added" : file.type === "deleted" ? "deleted" : "modified",
    staged: false,
    unstaged: false,
    conflicted: false,
    oldPath: null,
  };
}

function buildCommittedEntries(snapshot: DiffFile[], localPaths: Set<string>): ScmStatusEntry[] {
  return snapshot
    .filter((file) => !localPaths.has(file.path))
    .map(mapDiffFileToStatusEntry);
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        void onClick();
      }}
      disabled={disabled}
      style={{
        background: disabled ? "var(--ci-btn-ghost-bg)" : "var(--ci-surface)",
        border: "1px solid var(--ci-toolbar-border)",
        color: disabled ? "var(--ci-text-dim)" : "var(--ci-text-muted)",
        borderRadius: 6,
        padding: "2px 6px",
        fontSize: 10,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function GroupSection({
  title,
  group,
  files,
  sessionId,
  selectedPath,
  busy,
}: {
  title: string;
  group: ScmEntryGroup;
  files: ScmStatusEntry[];
  sessionId: string;
  selectedPath: string | null;
  busy: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 4px 6px" }}>
        {title}
      </div>
      {files.map((file) => {
        const isSelected = selectedPath === file.path;
        return (
          <div
            key={`${title}:${file.path}`}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 8,
              border: isSelected ? "1px solid var(--ci-accent-bdr)" : "1px solid transparent",
              background: isSelected ? "var(--ci-accent-bg)" : "none",
              color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)",
            }}
          >
            <button
              onClick={() => selectScmFile(sessionId, group, file.path)}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                padding: 0,
              }}
              title={group === "untracked" ? `打开 ${file.path} 的文件内容` : `打开 ${file.path} 的实际变更 diff`}
            >
              <span style={{ width: 12, textAlign: "center", color: file.kind === "added" ? "var(--ci-green)" : file.kind === "deleted" ? "var(--ci-red)" : file.kind === "conflicted" ? "var(--ci-red)" : "var(--ci-yellow)", fontSize: 10 }}>
                {file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : file.kind === "conflicted" ? "!" : file.kind === "renamed" ? "R" : "M"}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                {file.path}
              </span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {(group === "unstaged" || group === "untracked") && (
                <ActionButton label="Stage" onClick={() => stageScmFile(sessionId, file.path)} disabled={busy} />
              )}
              {group === "staged" && (
                <ActionButton label="Unstage" onClick={() => unstageScmFile(sessionId, file.path)} disabled={busy} />
              )}
              {group === "unstaged" && (
                <ActionButton label="Discard" onClick={() => discardScmFile(sessionId, file.path, "unstaged")} disabled={busy} />
              )}
              {group === "untracked" && (
                <ActionButton label="Delete" onClick={() => discardScmFile(sessionId, file.path, "untracked")} disabled={busy} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
  const groups = useScmStore((s) => s.statusBySessionId[session.id] ?? EMPTY_SCM_GROUPS);
  const selectedEntry = useScmStore((s) => s.selectedEntryBySessionId[session.id] ?? null);
  const commitMessage = useScmStore((s) => s.commitMessageBySessionId[session.id] ?? "");
  const busy = useScmStore((s) => s.actionPendingBySessionId[session.id] ?? false);
  const actionError = useScmStore((s) => s.actionErrorBySessionId[session.id] ?? null);
  const setCommitMessage = useScmStore((s) => s.setCommitMessage);
  const totalAdditions = snapshot.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = snapshot.reduce((sum, file) => sum + file.deletions, 0);
  const hasGroupedStatus = groups.conflicts.length + groups.staged.length + groups.unstaged.length + groups.untracked.length > 0;
  const localPaths = new Set([
    ...groups.conflicts.map((file) => file.path),
    ...groups.staged.map((file) => file.path),
    ...groups.unstaged.map((file) => file.path),
    ...groups.untracked.map((file) => file.path),
  ]);
  const committedEntries = hasGroupedStatus
    ? buildCommittedEntries(snapshot, localPaths)
    : snapshot.map(mapDiffFileToStatusEntry);

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

      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--ci-toolbar-border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(session.id, event.target.value)}
          placeholder="Commit message"
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            borderRadius: 10,
            border: "1px solid var(--ci-toolbar-border)",
            background: "var(--ci-surface)",
            color: "var(--ci-text)",
            fontSize: 11,
            padding: "8px 10px",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={() => void commitScm(session.id)}
          disabled={busy || commitMessage.trim().length === 0}
          style={{
            alignSelf: "flex-start",
            background: busy || commitMessage.trim().length === 0 ? "var(--ci-btn-ghost-bg)" : "var(--ci-accent-bg)",
            border: `1px solid ${busy || commitMessage.trim().length === 0 ? "var(--ci-toolbar-border)" : "var(--ci-accent-bdr)"}`,
            color: busy || commitMessage.trim().length === 0 ? "var(--ci-text-dim)" : "var(--ci-accent)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            cursor: busy || commitMessage.trim().length === 0 ? "default" : "pointer",
          }}
        >
          {busy ? "处理中…" : "Commit Staged"}
        </button>
        {actionError && (
          <div style={{ fontSize: 11, color: "var(--ci-deleted-text)", lineHeight: 1.6 }}>
            {actionError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 12px" }}>
        {!hasGroupedStatus && snapshot.length === 0 ? (
          <div style={{ padding: "12px 4px", color: "var(--ci-text-dim)", fontSize: 12 }}>
            当前会话暂无代码变更。
          </div>
        ) : (
          <>
            <GroupSection title="Committed in Session" group="committed" files={committedEntries} sessionId={session.id} selectedPath={selectedEntry?.group === "committed" ? selectedEntry.path : null} busy={busy} />
            {hasGroupedStatus && (
              <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 4px 8px" }}>
                Working Tree
              </div>
            )}
            <GroupSection title="Conflicts" group="conflicts" files={groups.conflicts} sessionId={session.id} selectedPath={selectedEntry?.group === "conflicts" ? selectedEntry.path : null} busy={busy} />
            <GroupSection title="Staged" group="staged" files={groups.staged} sessionId={session.id} selectedPath={selectedEntry?.group === "staged" ? selectedEntry.path : null} busy={busy} />
            <GroupSection title="Changes" group="unstaged" files={groups.unstaged} sessionId={session.id} selectedPath={selectedEntry?.group === "unstaged" ? selectedEntry.path : null} busy={busy} />
            <GroupSection title="Untracked" group="untracked" files={groups.untracked} sessionId={session.id} selectedPath={selectedEntry?.group === "untracked" ? selectedEntry.path : null} busy={busy} />
          </>
        )}
      </div>
    </div>
  );
}
