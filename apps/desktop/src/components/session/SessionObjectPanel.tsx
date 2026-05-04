import { useMemo } from "react";
import { type ClaudeSession } from "../../store/sessionStore";
import { useWorkbenchStore, type SessionObjectTab } from "../../store/workbenchStore";
import { useDaemonData } from "../../daemon/DaemonDataProvider";
import { selectSessionView } from "../../daemon/selectors";
import { SessionDetail } from "../SessionDetail";
import { GitFreshnessBadge } from "../git/GitFreshnessBadge";
import { ScmSidebar } from "../scm/ScmSidebar";
import { SessionFilesView } from "./SessionFilesView";
import { SessionLinkedWorkflowView } from "./SessionLinkedWorkflowView";

const SESSION_TABS: Array<{ id: SessionObjectTab; label: string }> = [
  { id: "run", label: "Run" },
  { id: "changes", label: "Changes" },
  { id: "files", label: "Files" },
  { id: "linked_workflow", label: "Linked Workflow" },
];

function tabButtonStyle(active: boolean) {
  return {
    borderRadius: 999,
    border: active ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-toolbar-border)",
    background: active ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
    color: active ? "var(--ci-accent)" : "var(--ci-text-dim)",
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  } as const;
}

export function SessionObjectPanel({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const centerSurface = useWorkbenchStore((s) => s.centerSurface);
  const sessionTab = useWorkbenchStore((s) => s.sessionTab);
  const setSessionTab = useWorkbenchStore((s) => s.setSessionTab);
  const daemon = useDaemonData();

  const sessionView = useMemo(
    () => (session ? selectSessionView(daemon.state, session.id) : null),
    [daemon.state, session],
  );

  if (!session) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ci-text-dim)",
        fontSize: 12,
      }}>
        Select a session to continue.
      </div>
    );
  }

  const branchName = sessionView?.worktree?.branchName ?? session.branchName ?? null;
  const baseBranch = sessionView?.worktree?.baseBranch ?? session.baseBranch ?? null;
  const activeTab = centerSurface === "editor"
    ? "files"
    : centerSurface === "diff"
      ? "changes"
      : sessionTab;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, background: "var(--ci-bg)" }}>
      <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Session
            </div>
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sessionView?.task?.title ?? session.name}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <GitFreshnessBadge
              workdir={sessionView?.worktree?.path ?? session.worktreePath ?? session.workdir}
              baseBranch={baseBranch}
            />
            {branchName ? (
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--ci-text-dim)" }}>
                {branchName}
              </span>
            ) : null}
            {baseBranch ? (
              <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>
                base {baseBranch}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SESSION_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSessionTab(tab.id)}
              style={tabButtonStyle(activeTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "run" ? (
          <SessionDetail mode="embedded" openSessionId={session.id} showPanelHeader={false} />
        ) : activeTab === "changes" ? (
          <ScmSidebar session={session} showBackButton={false} />
        ) : activeTab === "files" ? (
          <SessionFilesView session={session} onRefreshDiff={onRefreshDiff} onOpenChanges={() => setSessionTab("changes")} />
        ) : (
          <SessionLinkedWorkflowView session={session} />
        )}
      </div>
    </div>
  );
}
