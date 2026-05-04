import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { WorkflowLifecycle } from "@codebar/contracts";
import { MessageSquareCode, Workflow } from "lucide-react";
import { TitleBar } from "../components/TitleBar";
import { StatusBar } from "../components/StatusBar";
import { useAppI18n } from "../i18n";
import { useWorkflowStore } from "../store/workflowStore";
import { useDaemonData } from "../daemon/DaemonDataProvider";
import { selectSessionView } from "../daemon/selectors";
import { useWorkbenchStore } from "../store/workbenchStore";
import { type ClaudeSession } from "../store/sessionStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { resetWorkbenchMode, showSessionSurface, showWorkflow } from "../services/workbenchCommands";
import { GitFreshnessBadge } from "../components/git/GitFreshnessBadge";
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

function workflowLifecycleLabel(lifecycle: WorkflowLifecycle) {
  if (lifecycle === "in_review") return "in review";
  return lifecycle;
}

function workflowLifecycleBadgeStyle(lifecycle: WorkflowLifecycle, active: boolean) {
  const tone = lifecycle === "running"
    ? { background: "var(--ci-green-bg)", color: "var(--ci-green-dark)", border: "1px solid var(--ci-green-bdr)" }
    : lifecycle === "confirmed"
    ? { background: "var(--ci-accent-bg)", color: "var(--ci-accent)", border: "1px solid var(--ci-accent-bdr)" }
    : lifecycle === "in_review"
    ? { background: "var(--ci-yellow-bg)", color: "var(--ci-yellow-dark)", border: "1px solid var(--ci-yellow-bdr)" }
    : { background: "var(--ci-btn-ghost-bg)", color: "var(--ci-text-dim)", border: "1px solid var(--ci-toolbar-border)" };
  return {
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: active ? 700 : 600,
    ...tone,
  } as const;
}

function WorkflowSidebarTasks({ session }: { session: ClaudeSession | null }) {
  const { t } = useAppI18n();
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const focusWorkflowTask = useWorkbenchStore((s) => s.focusWorkflowTask);

  const taskSummariesByTaskId = useWorkflowStore((s) => s.taskSummariesByTaskId);
  const workflowTaskIdsByWorkspaceId = useWorkflowStore((s) => s.workflowTaskIdsByWorkspaceId);
  const selectedTaskId = useWorkflowStore((s) => s.selectedTaskId);
  const loadingWorkspaceIds = useWorkflowStore((s) => s.loadingWorkspaceIds);
  const errorByWorkspaceId = useWorkflowStore((s) => s.errorByWorkspaceId);
  const listWorkspaceTasks = useWorkflowStore((s) => s.listWorkspaceTasks);
  const createDraftTask = useWorkflowStore((s) => s.createDraftTask);
  const setSelectedTask = useWorkflowStore((s) => s.setSelectedTask);
  const refreshWorkflow = useWorkflowStore((s) => s.refreshWorkflow);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftProvider, setDraftProvider] = useState<"claude_code" | "codex">(
    session?.runner.type === "codex" ? "codex" : "claude_code",
  );
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const workspaceId = activeWorkspace?.id ?? null;
  const loadingWorkspace = workspaceId ? !!loadingWorkspaceIds[workspaceId] : false;
  const workspaceError = workspaceId ? errorByWorkspaceId[workspaceId] : null;

  useEffect(() => {
    if (!workspaceId) return;
    void listWorkspaceTasks(workspaceId);
  }, [listWorkspaceTasks, workspaceId]);

  const taskSummaries = useMemo(() => {
    if (!workspaceId) return [];
    const ids = workflowTaskIdsByWorkspaceId[workspaceId] ?? [];
    return ids
      .map((taskId) => taskSummariesByTaskId[taskId])
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [taskSummariesByTaskId, workflowTaskIdsByWorkspaceId, workspaceId]);

  const lifecycleSections = useMemo(() => {
    const order: WorkflowLifecycle[] = ["draft", "in_review", "confirmed", "running"];
    return order
      .map((lifecycle) => ({
        lifecycle,
        tasks: taskSummaries.filter((task) => task.lifecycle === lifecycle),
      }))
      .filter((section) => section.tasks.length > 0);
  }, [taskSummaries]);

  const handleSelectTask = (taskId: string, activeSessionId?: string) => {
    const sessionId = activeSessionId ?? null;
    focusWorkflowTask(taskId);
    setSelectedTask(taskId, sessionId);
    void refreshWorkflow(taskId, sessionId);
  };

  const handleCreateDraft = async () => {
    if (!workspaceId || creatingDraft) return;
    const prompt = draftPrompt.trim();
    if (!prompt) return;

    setCreatingDraft(true);
    setDraftError(null);
    try {
      const taskId = await createDraftTask({
        workspaceId,
        title: draftTitle.trim() || `Workflow ${new Date().toLocaleString()}`,
        prompt,
        provider: draftProvider,
      });
      setDraftTitle("");
      setDraftPrompt("");
      focusWorkflowTask(taskId);
      setSelectedTask(taskId, null);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingDraft(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "10px 12px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      {!activeWorkspace ? (
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)", padding: "4px 2px" }}>
          {t("workbench.workflowSidebar.noWorkspace")}
        </div>
      ) : null}

      <div style={{
        border: "1px solid var(--ci-toolbar-border)",
        borderRadius: 10,
        background: "var(--ci-panel-bg)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {t("workbench.workflow")}
          </div>
          <div style={{ display: "inline-flex", gap: 4 }}>
            <button
              onClick={() => setDraftProvider("claude_code")}
              style={providerButtonStyle(draftProvider === "claude_code")}
            >
              {t("notifications.claudeCode")}
            </button>
            <button
              onClick={() => setDraftProvider("codex")}
              style={providerButtonStyle(draftProvider === "codex")}
            >
              {t("notifications.codex")}
            </button>
          </div>
        </div>

        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder={t("workbench.workflowSidebar.draftTitlePlaceholder")}
          style={{
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--ci-toolbar-border)",
            background: "var(--ci-btn-ghost-bg)",
            color: "var(--ci-text)",
            padding: "7px 8px",
            fontSize: 11,
            boxSizing: "border-box",
          }}
        />
        <textarea
          value={draftPrompt}
          onChange={(event) => setDraftPrompt(event.target.value)}
          placeholder={t("workbench.workflowSidebar.draftPromptPlaceholder")}
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            borderRadius: 8,
            border: "1px solid var(--ci-toolbar-border)",
            background: "var(--ci-btn-ghost-bg)",
            color: "var(--ci-text)",
            padding: "7px 8px",
            fontSize: 11,
            lineHeight: 1.5,
            boxSizing: "border-box",
            minHeight: 72,
          }}
        />

        <button
          disabled={!workspaceId || !draftPrompt.trim() || creatingDraft}
          onClick={() => void handleCreateDraft()}
          style={{
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 600,
            cursor: !workspaceId || !draftPrompt.trim() || creatingDraft ? "not-allowed" : "pointer",
            opacity: !workspaceId || !draftPrompt.trim() || creatingDraft ? 0.5 : 1,
            background: "var(--ci-accent-bg)",
            color: "var(--ci-accent)",
            border: "1px solid var(--ci-accent-bdr)",
            alignSelf: "flex-start",
          }}
        >
          {creatingDraft ? t("workbench.workflowSidebar.creatingDraft") : t("workbench.workflowSidebar.createDraft")}
        </button>

        {draftError ? <div style={{ fontSize: 11, color: "var(--ci-deleted-text)" }}>{draftError}</div> : null}
      </div>

      <div style={{
        border: "1px solid var(--ci-toolbar-border)",
        borderRadius: 10,
        background: "var(--ci-panel-bg)",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderBottom: "1px solid var(--ci-toolbar-border)",
        }}>
          <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {t("workbench.workflowSidebar.tasks")}
          </div>
          <button
            onClick={() => {
              if (!workspaceId) return;
              void listWorkspaceTasks(workspaceId);
            }}
            style={{
              border: "none",
              background: "none",
              color: "var(--ci-text-dim)",
              fontSize: 10,
              cursor: workspaceId ? "pointer" : "default",
              padding: 0,
            }}
          >
            {t("common.refresh")}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, overflowY: "auto" }}>
          {loadingWorkspace ? (
            <div style={{ fontSize: 11, color: "var(--ci-text-dim)", padding: "6px 2px" }}>{t("common.loading")}</div>
          ) : workspaceError ? (
            <div style={{ fontSize: 11, color: "var(--ci-deleted-text)", padding: "6px 2px" }}>{workspaceError}</div>
          ) : taskSummaries.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--ci-text-dim)", padding: "6px 2px" }}>{t("workbench.workflowSidebar.emptyTasks")}</div>
          ) : lifecycleSections.map((section) => (
            <div key={section.lifecycle} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 2px 0",
              }}>
                <span style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  {workflowLifecycleLabel(section.lifecycle)}
                </span>
                <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>{section.tasks.length}</span>
              </div>

              {section.tasks.map((task) => {
                const active = task.taskId === selectedTaskId;
                return (
                  <button
                    key={task.taskId}
                    onClick={() => handleSelectTask(task.taskId, task.activeSessionId)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: active ? "1px solid var(--ci-accent-bdr)" : "1px solid transparent",
                      background: active ? "var(--ci-list-active-bg)" : "transparent",
                      borderRadius: 8,
                      padding: "7px 8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: active ? 700 : 600,
                        color: "var(--ci-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}>
                        {task.title}
                      </span>
                      <span style={workflowLifecycleBadgeStyle(task.lifecycle, active)}>{workflowLifecycleLabel(task.lifecycle)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 10, color: "var(--ci-text-dim)", fontFamily: "monospace" }}>{task.taskId}</span>
                      <span style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>
                        {task.activeSessionId ? `s-${task.activeSessionId}` : t("workbench.workflowSidebar.unassigned")}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function providerButtonStyle(active: boolean) {
  return {
    borderRadius: 999,
    border: active ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-toolbar-border)",
    background: active ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
    color: active ? "var(--ci-accent)" : "var(--ci-text-dim)",
    padding: "4px 8px",
    fontSize: 10,
    fontWeight: 600,
    cursor: "pointer",
  } as const;
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
  const primaryObject = useWorkbenchStore((s) => s.primaryObject);
  const hasWorkspace = useWorkspaceStore((s) => s.workspaces.length > 0);
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const selectedTaskId = useWorkflowStore((s) => s.selectedTaskId);
  const taskSummariesByTaskId = useWorkflowStore((s) => s.taskSummariesByTaskId);
  const daemon = useDaemonData();
  const sessionView = session ? selectSessionView(daemon.state, session.id) : null;

  void onRefreshDiff;

  const selectedWorkflowSummary = selectedTaskId ? taskSummariesByTaskId[selectedTaskId] ?? null : null;
  const defaultWorkflowTaskId = selectedWorkflowSummary && selectedWorkflowSummary.workspaceId === activeWorkspace?.id
    ? selectedWorkflowSummary.taskId
    : null;

  const workflowMenu = (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "6px 18px 4px" }}>
        {menuContent}
      </div>
      <WorkflowSidebarTasks session={session} />
    </div>
  );

  return (
    <>
      <TitleBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {hasWorkspace && (
          <div style={{ width: 48, display: "flex", flexDirection: "column", alignItems: "stretch", borderInlineEnd: "1px solid var(--ci-toolbar-border)", background: "transparent" }}>
            <ActivityButton
              label={t("workbench.sessions")}
              active={primaryObject === "sessions"}
              onClick={() => hasWorkspace ? showSessionSurface(session?.id ?? null) : resetWorkbenchMode()}
              icon={<MessageSquareCode size={20} strokeWidth={1.9} />}
            />
            <ActivityButton
              label={t("workbench.workflow")}
              active={primaryObject === "workflows"}
              onClick={() => showWorkflow(session?.id ?? null, defaultWorkflowTaskId, "overview")}
              icon={<Workflow size={20} strokeWidth={1.9} />}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {activeWorkspace ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              borderBottom: "1px solid var(--ci-toolbar-border)",
              background: "transparent",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Workspace
                </div>
                <div style={{ marginTop: 3, fontSize: 11, fontWeight: 600, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeWorkspace.name}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 600, whiteSpace: "nowrap" }}>
                  Workspace root
                </span>
                <GitFreshnessBadge workdir={activeWorkspace.path} />
              </div>
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {primaryObject === "workflows" ? workflowMenu : menuContent}
          </div>
        </div>
      </div>
      <StatusBar
        session={session
          ? {
              ...session,
              workdir: sessionView?.worktree?.path ?? session.workdir,
              branchName: sessionView?.worktree?.branchName ?? session.branchName,
              baseBranch: sessionView?.worktree?.baseBranch ?? session.baseBranch,
            }
          : undefined}
      />
    </>
  );
}
