import { ExploreEditor, ExploreSidebar } from "../ExploreMode";
import { type ClaudeSession } from "../../store/sessionStore";

export function SessionFilesView({
  session,
  onRefreshDiff,
  onOpenChanges,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
  onOpenChanges: () => void;
}) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minHeight: 0 }}>
      <div style={{ width: 320, minWidth: 260, maxWidth: 420, minHeight: 0 }}>
        <ExploreSidebar
          session={session}
          onRefreshDiff={onRefreshDiff}
          showBackButton={false}
          onOpenScm={onOpenChanges}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <ExploreEditor session={session} onRefreshDiff={onRefreshDiff} />
      </div>
    </div>
  );
}
