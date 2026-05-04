import { useEffect, useMemo, useState } from "react";
import type { TaskDagDocument, WorkflowLifecycle, WorkflowTaskSummary } from "@codebar/contracts";
import type { ClaudeSession } from "../../store/sessionStore";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSessionStore } from "../../store/sessionStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useWorkflowExecutionStore } from "../../store/workflowExecutionStore";
import { useWorkflowStore, selectWorkflowNodeById } from "../../store/workflowStore";
import { GitFreshnessBadge } from "../git/GitFreshnessBadge";
import { WorkflowDetailSheet } from "./WorkflowDetailSheet";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowOverviewTab } from "./WorkflowOverviewTab";
import { WorkflowActivityTab } from "./WorkflowActivityTab";
import { WorkflowExecutionTab } from "./WorkflowExecutionTab";
import { canRunWorkflowExecutionSetupActions, collectWorkflowExecutionSessions } from "./workflowObjectModel";

function providerForSession(session: ClaudeSession | null): "claude_code" | "codex" {
  return session?.runner.type === "codex" ? "codex" : "claude_code";
}

function resolveLifecycle(document: TaskDagDocument | undefined, summary?: WorkflowTaskSummary): WorkflowLifecycle {
  const lifecycle = document?.task.lifecycle ?? summary?.lifecycle;
  if (lifecycle === "draft" || lifecycle === "in_review" || lifecycle === "confirmed" || lifecycle === "running") {
    return lifecycle;
  }
  const status = document?.task.status ?? summary?.status;
  if (status === "draft") return "draft";
  if (status === "ready") return "confirmed";
  if (status === "active") return "running";
  return "in_review";
}

function lifecycleLabel(lifecycle: WorkflowLifecycle) {
  if (lifecycle === "in_review") return "in review";
  return lifecycle;
}

function lifecycleHint(lifecycle: WorkflowLifecycle) {
  if (lifecycle === "draft") return "Define and split work before assigning sessions.";
  if (lifecycle === "in_review") return "Review decomposition and ownership before confirmation.";
  if (lifecycle === "confirmed") return "Bind CLI sessions for parallel execution, then explicitly start.";
  return "Workflow is running across assigned sessions.";
}

export function WorkflowPanel({ session }: { session: ClaudeSession | null }) {
  const workflowTab = useWorkbenchStore((s) => s.workflowTab);
  const setWorkflowTab = useWorkbenchStore((s) => s.setWorkflowTab);

  const snapshotsByTaskId = useWorkflowStore((s) => s.snapshotsByTaskId);
  const eventsByTaskId = useWorkflowStore((s) => s.eventsByTaskId);
  const diagnosticsByTaskId = useWorkflowStore((s) => s.diagnosticsByTaskId);
  const selectedTaskId = useWorkflowStore((s) => s.selectedTaskId);
  const selectedSessionId = useWorkflowStore((s) => s.selectedSessionId);
  const taskIdBySessionId = useWorkflowStore((s) => s.taskIdBySessionId);
  const taskSummariesByTaskId = useWorkflowStore((s) => s.taskSummariesByTaskId);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const errorByTaskId = useWorkflowStore((s) => s.errorByTaskId);
  const loadingTaskIds = useWorkflowStore((s) => s.loadingTaskIds);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const setSelectedTask = useWorkflowStore((s) => s.setSelectedTask);
  const refreshWorkflow = useWorkflowStore((s) => s.refreshWorkflow);
  const attachSessionAndLoad = useWorkflowStore((s) => s.attachSessionAndLoad);
  const submitForReview = useWorkflowStore((s) => s.submitForReview);
  const confirmTask = useWorkflowStore((s) => s.confirmTask);
  const startTask = useWorkflowStore((s) => s.startTask);
  const ensureSessionForTask = useWorkflowStore((s) => s.ensureSessionForTask);
  const claimStep = useWorkflowStore((s) => s.claimStep);
  const completeStep = useWorkflowStore((s) => s.completeStep);
  const blockStep = useWorkflowStore((s) => s.blockStep);
  const resolveApproval = useWorkflowStore((s) => s.resolveApproval);
  const pendingActionByStepId = useWorkflowStore((s) => s.pendingActionByStepId);
  const pendingApprovalIds = useWorkflowStore((s) => s.pendingApprovalIds);

  const executionStateBySessionId = useWorkflowExecutionStore((s) => s.executionStateBySessionId);
  const activeIntentBySessionId = useWorkflowExecutionStore((s) => s.activeIntentBySessionId);
  const autoContinueDecisionBySessionId = useWorkflowExecutionStore((s) => s.lastAutoContinueDecisionBySessionId);

  const focusedWorkflowTaskId = useWorkbenchStore((s) => s.focusedWorkflowTaskId);

  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const allSessions = useSessionStore((s) => s.sessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setExpandedSession = useSessionStore((s) => s.setExpandedSession);
  const markWorktreeReady = useSessionStore((s) => s.markWorktreeReady);

  const [submittingReview, setSubmittingReview] = useState(false);
  const [confirmingTask, setConfirmingTask] = useState(false);
  const [attachingSession, setAttachingSession] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [startingWorkflow, setStartingWorkflow] = useState(false);

  useEffect(() => {
    if (!session?.taskId) return;
    if (selectedTaskId || focusedWorkflowTaskId) return;
    void refreshWorkflow(session.taskId, session.id);
  }, [focusedWorkflowTaskId, refreshWorkflow, selectedTaskId, session?.id, session?.taskId]);

  const isTaskInActiveWorkspace = (taskId: string | null | undefined) => {
    if (!taskId) return false;
    const summary = taskSummariesByTaskId[taskId];
    return !!summary && summary.workspaceId === activeWorkspace?.id;
  };

  useEffect(() => {
    if (!focusedWorkflowTaskId) return;
    if (!isTaskInActiveWorkspace(focusedWorkflowTaskId)) return;
    if (selectedTaskId === focusedWorkflowTaskId) return;
    setSelectedTask(focusedWorkflowTaskId, null);
    void refreshWorkflow(focusedWorkflowTaskId);
  }, [activeWorkspace?.id, focusedWorkflowTaskId, refreshWorkflow, selectedTaskId, setSelectedTask, taskSummariesByTaskId]);

  const sessionTaskId = session ? taskIdBySessionId[session.id] ?? null : null;
  const taskId = isTaskInActiveWorkspace(selectedTaskId)
    ? selectedTaskId
    : isTaskInActiveWorkspace(focusedWorkflowTaskId)
    ? focusedWorkflowTaskId
    : isTaskInActiveWorkspace(sessionTaskId)
    ? sessionTaskId
    : null;
  const document = taskId ? snapshotsByTaskId[taskId] : undefined;
  const taskSummary: WorkflowTaskSummary | undefined = undefined;
  const lifecycle = resolveLifecycle(document, taskSummary);

  const mappedSessionId = session && taskIdBySessionId[session.id] === taskId ? session.id : null;
  const workflowSessionId = selectedSessionId ?? document?.task.activeSessionId ?? mappedSessionId ?? null;
  const linkedWorkflowSession = workflowSessionId
    ? allSessions.find((item) => item.id === workflowSessionId) ?? null
    : null;
  const workflowGitWorkdir = linkedWorkflowSession?.worktreePath ?? linkedWorkflowSession?.workdir ?? activeWorkspace?.path ?? null;
  const workflowGitBase = linkedWorkflowSession?.baseBranch ?? null;

  const documentWithExecutionState = useMemo<TaskDagDocument | undefined>(() => {
    if (!document) return document;
    return {
      ...document,
      nodes: document.nodes.map((item) => {
        if (item.kind !== "step") return item;
        const currentSessionId = item.runtime?.currentSession?.id;
        if (!currentSessionId) return item;
        const currentExecutionState = executionStateBySessionId[currentSessionId];
        if (!currentExecutionState) return item;
        return {
          ...item,
          runtime: {
            ...item.runtime,
            recommendedNextActions: item.runtime?.recommendedNextActions ?? [],
            metadata: {
              ...(item.runtime?.metadata ?? {}),
              executionState: currentExecutionState,
            },
          },
        };
      }),
    };
  }, [document, executionStateBySessionId]);

  const node = useMemo(
    () => selectWorkflowNodeById(documentWithExecutionState, selectedNodeId),
    [documentWithExecutionState, selectedNodeId],
  );

  const nodeSessionId = node?.kind === "step" ? node.runtime?.currentSession?.id ?? null : null;
  const detailSessionId = nodeSessionId ?? workflowSessionId;
  const executionState = detailSessionId ? executionStateBySessionId[detailSessionId] ?? null : null;
  const activeExecutionIntent = detailSessionId ? activeIntentBySessionId[detailSessionId] ?? null : null;
  const autoContinueDecision = detailSessionId ? autoContinueDecisionBySessionId[detailSessionId] ?? null : null;

  const events = taskId ? (eventsByTaskId[taskId] ?? []) : [];
  const diagnostics = taskId ? (diagnosticsByTaskId[taskId] ?? []) : [];

  const filteredEvents = node && "stepId" in node
    ? events.filter((event) => event.stepId === node.stepId || event.taskId === document?.task.id)
    : events;

  const filteredDiagnostics = node && "stepId" in node
    ? diagnostics.filter((diagnostic) => diagnostic.stepId === node.stepId || diagnostic.taskId === document?.task.id)
    : diagnostics;

  const canRunNodeActions = lifecycle === "running" && !!detailSessionId;
  const canRunExecutionSetupActions = canRunWorkflowExecutionSetupActions(lifecycle);
  const canAttachCurrentSession = canRunExecutionSetupActions && !!session && !!document?.capabilities.canAttachSession;
  const canCreateSession = canRunExecutionSetupActions && !!document?.capabilities.canCreateSession;
  const canStartWorkflow = canRunExecutionSetupActions && !!document?.capabilities.canStartWorkflow;

  const handleSubmitForReview = async () => {
    if (!taskId || submittingReview) return;
    setSubmittingReview(true);
    try {
      await submitForReview(taskId);
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleConfirmTask = async () => {
    if (!taskId || confirmingTask) return;
    setConfirmingTask(true);
    try {
      await confirmTask(taskId);
    } finally {
      setConfirmingTask(false);
    }
  };

  const handleAttachCurrentSession = async () => {
    if (!session || attachingSession) return;
    setAttachingSession(true);
    try {
      await attachSessionAndLoad({
        provider: providerForSession(session),
        sessionId: session.id,
        providerSessionId: session.providerSessionId,
        cwd: session.workdir,
        worktreePath: session.worktreePath,
        workspaceId: session.workspaceId,
        workspaceName: activeWorkspace?.name,
        workspacePath: activeWorkspace?.path,
        sessionName: session.name,
        currentTask: session.currentTask,
        branchName: session.branchName,
        baseBranch: session.baseBranch,
        sessionStatus: session.status,
      });
    } finally {
      setAttachingSession(false);
    }
  };

  const handleCreateSession = async () => {
    if (!taskId || creatingSession) return;
    setCreatingSession(true);
    try {
      const created = await ensureSessionForTask(taskId, session?.runner.type === "codex" ? "codex" : "claude");
      const sessionId = created.id;
      markWorktreeReady(sessionId);
      setActiveSession(sessionId);
      setExpandedSession(sessionId);
      useWorkbenchStore.getState().focusSession(sessionId);
      setSelectedTask(taskId, sessionId);
      await refreshWorkflow(taskId, sessionId);
    } finally {
      setCreatingSession(false);
    }
  };

  const handleStartWorkflow = async () => {
    if (!taskId || !workflowSessionId || startingWorkflow) return;
    setStartingWorkflow(true);
    try {
      await startTask(taskId, workflowSessionId);
    } finally {
      setStartingWorkflow(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--ci-bg)" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {!taskId ? (
          <EmptyState text="Workflow is for decomposing complex work and assigning it across multiple CLI sessions before execution. Create/select a task in the left sidebar." />
        ) : !document ? (
          loadingTaskIds[taskId] ? (
            <EmptyState text="Loading workflow…" />
          ) : (
            <EmptyState text={errorByTaskId[taskId] || "No workflow snapshot available yet."} />
          )
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px 10px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-panel-bg)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ci-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {document.task.title}
                  </div>
                  <span style={lifecycleBadgeStyle(lifecycle)}>{lifecycleLabel(lifecycle)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--ci-text-dim)" }}>
                  {lifecycleHint(lifecycle)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <GitFreshnessBadge workdir={workflowGitWorkdir} baseBranch={workflowGitBase} />
                {executionState ? (
                  <span style={executionBadgeStyle(executionState)}>
                    {executionState === "waiting" && activeExecutionIntent ? "auto-continuing" : executionState}
                  </span>
                ) : null}
                {activeExecutionIntent ? <span style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>{activeExecutionIntent.action}</span> : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-panel-bg)" }}>
              {([
                ["overview", "Overview"],
                ["graph", "Graph"],
                ["activity", "Activity"],
                ["execution", "Execution"],
              ] as const).map(([tabId, label]) => (
                <button
                  key={tabId}
                  onClick={() => setWorkflowTab(tabId)}
                  style={{
                    borderRadius: 999,
                    border: workflowTab === tabId ? "1px solid var(--ci-accent-bdr)" : "1px solid var(--ci-toolbar-border)",
                    background: workflowTab === tabId ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
                    color: workflowTab === tabId ? "var(--ci-accent)" : "var(--ci-text-dim)",
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              {workflowTab === "overview" ? (
                <WorkflowOverviewTab
                  document={document}
                  lifecycle={lifecycle}
                  submitForReviewPending={submittingReview}
                  confirmTaskPending={confirmingTask}
                  onSubmitForReview={() => void handleSubmitForReview()}
                  onConfirmTask={() => void handleConfirmTask()}
                  onOpenTab={(tab) => setWorkflowTab(tab)}
                />
              ) : workflowTab === "activity" ? (
                <WorkflowActivityTab lifecycle={lifecycle} diagnostics={diagnostics} events={events} />
              ) : workflowTab === "execution" ? (
                <WorkflowExecutionTab
                  lifecycle={lifecycle}
                  workflowSessionId={workflowSessionId}
                  sessions={collectWorkflowExecutionSessions(document)}
                  canAttachCurrentSession={canAttachCurrentSession}
                  canCreateSession={canCreateSession}
                  canStartWorkflow={canStartWorkflow}
                  attachingSession={attachingSession}
                  creatingSession={creatingSession}
                  startingWorkflow={startingWorkflow}
                  onAttachCurrentSession={() => void handleAttachCurrentSession()}
                  onCreateSession={() => void handleCreateSession()}
                  onStartWorkflow={() => void handleStartWorkflow()}
                />
              ) : (
                <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <WorkflowGraph document={documentWithExecutionState ?? document} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNode} />
                  </div>
                  <WorkflowDetailSheet
                    lifecycle={lifecycle}
                    node={node}
                    onClose={() => setSelectedNode(null)}
                    onClaim={(stepId) => {
                      if (!detailSessionId) return;
                      void claimStep(detailSessionId, stepId);
                    }}
                    onComplete={(stepId) => {
                      if (!detailSessionId) return;
                      void completeStep(detailSessionId, stepId);
                    }}
                    onBlock={(stepId) => {
                      if (!detailSessionId) return;
                      void blockStep(detailSessionId, stepId, `Blocked ${stepId} from workflow surface`);
                    }}
                    onResolveApproval={(approvalId) => void resolveApproval(approvalId, detailSessionId ?? undefined)}
                    diagnostics={filteredDiagnostics}
                    events={filteredEvents}
                    capabilities={{
                      canClaimStep: !!document.capabilities.canClaimStep && canRunNodeActions,
                      canCompleteStep: !!document.capabilities.canCompleteStep && canRunNodeActions,
                      canBlockStep: !!document.capabilities.canBlockStep && canRunNodeActions,
                      canResolveApproval: !!document.capabilities.canResolveApproval && canRunNodeActions,
                    }}
                    pendingAction={node && node.kind === "step" ? pendingActionByStepId[node.stepId] ?? null : null}
                    approvalPending={node && node.kind === "approval_gate" ? pendingApprovalIds[node.approvalRequest.id] ?? false : false}
                    executionState={executionState}
                    activeExecutionAction={activeExecutionIntent?.action ?? null}
                    autoContinueDecision={autoContinueDecision}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function executionBadgeStyle(state: string) {
  const palette: Record<string, { background: string; color: string; border: string }> = {
    queued: { background: "var(--ci-btn-ghost-bg)", color: "var(--ci-text-dim)", border: "1px solid var(--ci-toolbar-border)" },
    dispatching: { background: "var(--ci-accent-bg)", color: "var(--ci-accent)", border: "1px solid var(--ci-accent-bdr)" },
    sent: { background: "var(--ci-accent-bg)", color: "var(--ci-accent)", border: "1px solid var(--ci-accent-bdr)" },
    running: { background: "var(--ci-green-bg)", color: "var(--ci-green-dark)", border: "1px solid var(--ci-green-bdr)" },
    waiting: { background: "var(--ci-yellow-bg)", color: "var(--ci-yellow-dark)", border: "1px solid var(--ci-yellow-bdr)" },
    error: { background: "var(--ci-deleted-bg)", color: "var(--ci-deleted-text)", border: "1px solid var(--ci-border-med)" },
  };
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    ...(palette[state] ?? palette.queued),
  };
}

function lifecycleBadgeStyle(lifecycle: WorkflowLifecycle) {
  if (lifecycle === "running") {
    return {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      background: "var(--ci-green-bg)",
      color: "var(--ci-green-dark)",
      border: "1px solid var(--ci-green-bdr)",
    };
  }
  if (lifecycle === "confirmed") {
    return {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      background: "var(--ci-accent-bg)",
      color: "var(--ci-accent)",
      border: "1px solid var(--ci-accent-bdr)",
    };
  }
  if (lifecycle === "in_review") {
    return {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      background: "var(--ci-yellow-bg)",
      color: "var(--ci-yellow-dark)",
      border: "1px solid var(--ci-yellow-bdr)",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text-dim)",
    border: "1px solid var(--ci-toolbar-border)",
  };
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ci-text-dim)",
        fontSize: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}
