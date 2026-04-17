import type { ReactNode } from "react";
import { Files, GitBranchPlus, MessageSquareCode } from "lucide-react";
import { TitleBar } from "../components/TitleBar";
import { StatusBar } from "../components/StatusBar";
import { ExploreSidebar } from "../components/ExploreMode";
import { ScmSidebar } from "../components/scm/ScmSidebar";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";
import { showExplorer, showScm, showSessionSurface } from "../services/workbenchCommands";
import { WorkbenchTooltip } from "../components/ui/WorkbenchTooltip";

function ActivityButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <WorkbenchTooltip label={label}>
      <button
        onClick={onClick}
        style={{
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: active ? "var(--ci-accent-bg)" : "transparent",
          border: "none",
          borderLeft: active ? "2px solid var(--ci-accent)" : "2px solid transparent",
          color: active ? "var(--ci-text)" : "var(--ci-text-dim)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {icon}
      </button>
    </WorkbenchTooltip>
  );
}

export function WorkbenchSidebar({
  session,
  menuContent,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  menuContent: ReactNode;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const sidebarSection = useWorkbenchStore((s) => s.sidebarSection);

  return (
    <>
      <TitleBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {session && (
          <div style={{ width: 48, display: "flex", flexDirection: "column", alignItems: "stretch", borderRight: "1px solid var(--ci-toolbar-border)", background: "var(--ci-toolbar-bg)" }}>
            <ActivityButton label="Sessions" active={sidebarSection === "sessions"} onClick={() => showSessionSurface(session.id)} icon={<MessageSquareCode size={20} strokeWidth={1.9} />} />
            <ActivityButton label="Explorer" active={sidebarSection === "explorer"} onClick={() => showExplorer(session.id)} icon={<Files size={20} strokeWidth={1.9} />} />
            <ActivityButton label="Source Control" active={sidebarSection === "scm"} onClick={() => showScm(session.id)} icon={<GitBranchPlus size={20} strokeWidth={1.9} />} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {sidebarSection === "explorer"
            ? <ExploreSidebar session={session} onRefreshDiff={onRefreshDiff} />
            : sidebarSection === "scm"
            ? <ScmSidebar session={session} />
            : menuContent}
        </div>
      </div>
      <StatusBar session={session ?? undefined} />
    </>
  );
}
