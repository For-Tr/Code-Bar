import { SplitDetailHost } from "../components/SplitSwapLayout";
import { ExploreEditor } from "../components/ExploreMode";
import { showSessionSurface, showExplorer, showScm } from "../services/workbenchCommands";
import { useSettingsStore } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { useSessionStore, type ClaudeSession } from "../store/sessionStore";

function WelcomeAction({ label, accent = false, onClick }: { label: string; accent?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: "4px 2px",
        color: accent ? "var(--ci-accent)" : "var(--ci-text-muted)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.opacity = "0.8";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.opacity = "1";
      }}
    >
      {label}
    </button>
  );
}

function WelcomeList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ marginTop: 10 }}>
        {children}
      </div>
    </div>
  );
}

function WelcomeEntry({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "10px 0", borderTop: "1px solid var(--ci-toolbar-border)" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ci-text)" }}>{title}</div>
        {detail && <div style={{ marginTop: 3, fontSize: 11, color: "var(--ci-text-dim)", lineHeight: 1.6 }}>{detail}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

function WorkbenchWelcome({ session }: { session: ClaudeSession | null }) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const sessions = useSessionStore((s) => s.sessions);
  const hasWorkspace = workspaces.length > 0;
  const recentSessions = activeWorkspace
    ? sessions.filter((item) => item.workspaceId === activeWorkspace.id).slice(0, 5)
    : [];

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: "36px 30px 44px", boxSizing: "border-box" }}>
        <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Get Started
        </div>
        <div style={{ marginTop: 8, fontSize: 26, fontWeight: 700, color: "var(--ci-text)", letterSpacing: -0.5, lineHeight: 1.15 }}>
          {hasWorkspace ? (activeWorkspace ? activeWorkspace.name : "Welcome") : "No workspace"}
        </div>
        <div style={{ marginTop: 8, maxWidth: 520, fontSize: 12, color: "var(--ci-text-muted)", lineHeight: 1.7 }}>
          {hasWorkspace ? "Choose where to continue." : "Add a project folder to begin."}
        </div>

        <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 36 }}>
          {hasWorkspace ? (
            <>
              <WelcomeList title="Start">
                {session ? (
                  <>
                    <WelcomeEntry title="Open current session" action={<WelcomeAction label="Open" accent onClick={() => showSessionSurface(session.id)} />} />
                    <WelcomeEntry title="Open Explorer" action={<WelcomeAction label="Explorer" onClick={() => showExplorer(session.id)} />} />
                    <WelcomeEntry title="Open Source Control" action={<WelcomeAction label="SCM" onClick={() => showScm(session.id)} />} />
                  </>
                ) : (
                  <WelcomeEntry title="Create or choose a session" detail="Use the sidebar on the left." />
                )}
              </WelcomeList>
              <WelcomeList title="Recent">
                {recentSessions.length > 0 ? recentSessions.map((recent) => (
                  <WelcomeEntry
                    key={recent.id}
                    title={recent.name}
                    detail={recent.currentTask || undefined}
                    action={<WelcomeAction label="Open" onClick={() => showSessionSurface(recent.id)} />}
                  />
                )) : (
                  <WelcomeEntry title="No recent sessions" />
                )}
              </WelcomeList>
            </>
          ) : (
            <>
              <WelcomeList title="Start">
                <WelcomeEntry
                  title="Add workspace"
                  detail="Use the Workspace section in the sidebar."
                  action={<WelcomeAction label="Open Settings" accent onClick={() => openSettings("appearance")} />}
                />
                <WelcomeEntry title="Create a session" detail="Available after a workspace is added." />
              </WelcomeList>
              <WelcomeList title="Overview">
                <WelcomeEntry title="Explorer and SCM" detail="Appear after a workspace is available." />
                <WelcomeEntry title="Split workbench" detail="Sidebar, center editor/detail, and widgets." />
              </WelcomeList>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkbenchCenter({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const centerSurface = useWorkbenchStore((s) => s.centerSurface);

  if (centerSurface === "welcome") {
    return <WorkbenchWelcome session={session} />;
  }

  if (centerSurface === "editor" || centerSurface === "diff") {
    return <ExploreEditor session={session} onRefreshDiff={onRefreshDiff} />;
  }

  return <SplitDetailHost />;
}
