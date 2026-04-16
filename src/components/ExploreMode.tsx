import { Component, type ReactNode } from "react";
import { type ClaudeSession } from "../store/sessionStore";
import { ExplorerPane } from "./explore/ExplorerPane";
import { EditorTabs } from "./editor/EditorTabs";
import { EditorHost } from "./editor/EditorHost";

class ExploreErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    console.error("[explore-mode] render crash", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: "100%",
          height: "100%",
          padding: 16,
          boxSizing: "border-box",
          overflow: "auto",
          background: "var(--ci-surface)",
          color: "var(--ci-deleted-text)",
          fontSize: 12,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}>
          {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}

function EmptyEditorState({ message }: { message: string }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 280,
        padding: "22px 24px",
        borderRadius: 18,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-surface)",
        color: "var(--ci-text-dim)",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.7,
      }}>
        {message}
      </div>
    </div>
  );
}

export function ExploreSidebar({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  return (
    <ExploreErrorBoundary>
      <div style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        background: "var(--ci-toolbar-bg)",
        borderRight: "1px solid var(--ci-toolbar-border)",
      }}>
        {session ? <ExplorerPane session={session} onRefreshDiff={onRefreshDiff} /> : <EmptyEditorState message="选择一个会话进入 Explorer。" />}
      </div>
    </ExploreErrorBoundary>
  );
}

export function ExploreEditor({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  return (
    <ExploreErrorBoundary>
      <div style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--ci-surface)",
      }}>
        <EditorTabs session={session} />
        <div style={{ flex: 1, minHeight: 0 }}>
          <EditorHost session={session} onRefreshDiff={onRefreshDiff} />
        </div>
      </div>
    </ExploreErrorBoundary>
  );
}
