import type { ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { StatusBar } from "../components/StatusBar";
import { ExploreSidebar } from "../components/ExploreMode";
import { ScmSidebar } from "../components/scm/ScmSidebar";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";

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
      <div style={{ flex: 1, minHeight: 0 }}>
        {sidebarSection === "explorer"
          ? <ExploreSidebar session={session} onRefreshDiff={onRefreshDiff} />
          : sidebarSection === "scm"
          ? <ScmSidebar session={session} />
          : menuContent}
      </div>
      <StatusBar session={session ?? undefined} />
    </>
  );
}
