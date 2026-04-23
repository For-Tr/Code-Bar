import type { ReactNode } from "react";
import { Files, GitBranch, GitBranchPlus, MessageSquareCode } from "lucide-react";
import { TitleBar } from "../components/TitleBar";
import { StatusBar } from "../components/StatusBar";
import { ExploreSidebar } from "../components/ExploreMode";
import { ScmSidebar } from "../components/scm/ScmSidebar";
import { useAppI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { resetWorkbenchMode, showExplorer, showScm, showSessionSurface } from "../services/workbenchCommands";
import { WorkbenchTooltip } from "../components/ui/WorkbenchTooltip";

function ActivityButton({
  label,
  active,
  disabled = false,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <WorkbenchTooltip label={label}>
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-disabled={disabled}
        style={{
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: active ? "var(--ci-accent-bg)" : "transparent",
          border: "none",
          borderInlineStart: active ? "2px solid var(--ci-accent)" : "2px solid transparent",
          color: active ? "var(--ci-text)" : disabled ? "var(--ci-text-dim)" : "var(--ci-text-dim)",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
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
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const { t } = useAppI18n();
  const sidebarSection = useWorkbenchStore((s) => s.sidebarSection);
  const hasWorkspace = useWorkspaceStore((s) => s.workspaces.length > 0);
  const hasSessionContext = !!session;
  const inWorkbenchSection = sidebarSection !== "sessions";

  return (
    <>
      <TitleBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {hasWorkspace && (
          <div style={{ width: 48, display: "flex", flexDirection: "column", alignItems: "stretch", borderInlineEnd: "1px solid var(--ci-toolbar-border)", background: "transparent" }}>
            <ActivityButton
              label={t("workbench.sessions")}
              active={sidebarSection === "sessions"}
              onClick={() => hasSessionContext ? showSessionSurface(session.id) : resetWorkbenchMode()}
              icon={<MessageSquareCode size={20} strokeWidth={1.9} />}
            />
            <ActivityButton
              label={hasSessionContext ? t("workbench.explorer") : t("workbench.explorerDisabled")}
              active={sidebarSection === "explorer"}
              disabled={!hasSessionContext}
              onClick={() => {
                if (!session) return;
                showExplorer(session.id);
              }}
              icon={<Files size={20} strokeWidth={1.9} />}
            />
            <ActivityButton
              label={hasSessionContext ? t("workbench.sourceControl") : t("workbench.sourceControlDisabled")}
              active={sidebarSection === "scm"}
              disabled={!hasSessionContext}
              onClick={() => {
                if (!session) return;
                showScm(session.id);
              }}
              icon={<GitBranchPlus size={20} strokeWidth={1.9} />}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {session && inWorkbenchSection && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              borderBottom: "1px solid var(--ci-toolbar-border)",
              background: "transparent",
              minHeight: 34,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {sidebarSection === "explorer" ? t("workbench.explorer") : t("workbench.sourceControl")}
                </div>
                <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: "var(--ci-text)", fontSize: 11, fontWeight: 600 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.name}</span>
                  {session.branchName && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ci-text-dim)", fontSize: 10, fontWeight: 500, minWidth: 0 }}>
                      <GitBranch size={11} strokeWidth={1.8} />
                      <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.branchName.replace("ci/", "")}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {sidebarSection === "explorer"
              ? <ExploreSidebar session={session} onRefreshDiff={onRefreshDiff} />
              : sidebarSection === "scm"
              ? <ScmSidebar session={session} />
              : menuContent}
          </div>
        </div>
      </div>
      <StatusBar session={session ?? undefined} />
    </>
  );
}
