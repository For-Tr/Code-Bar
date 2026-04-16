import { SplitDetailHost } from "../components/SplitSwapLayout";
import { ExploreEditor } from "../components/ExploreMode";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";

export function WorkbenchCenter({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const centerSurface = useWorkbenchStore((s) => s.centerSurface);

  if (centerSurface === "editor" || centerSurface === "diff") {
    return <ExploreEditor session={session} onRefreshDiff={onRefreshDiff} />;
  }

  return <SplitDetailHost />;
}
