import { useEffect, useMemo } from "react";
import type { ClaudeSession } from "../../store/sessionStore";
import { useWorkspacesSorted } from "../../store/workspaceStore";
import { useWorkflowExecutionStore } from "../../store/workflowExecutionStore";
import { useWorkflowStore, selectWorkflowNodeById } from "../../store/workflowStore";
import { WorkflowDetailSheet } from "./WorkflowDetailSheet";
import { WorkflowGraph } from "./WorkflowGraph";

function providerForSession(session: ClaudeSession | null): "claude_code" | "codex" {
  return session?.runner.type === "codex" ? "codex" : "claude_code";
}

export function WorkflowPanel({ session }: { session: ClaudeSession | null }) {
  const snapshotsByTaskId = useWorkflowStore((s) => s.snapshotsByTaskId);
  const eventsByTaskId = useWorkflowStore((s) => s.eventsByTaskId);
  const diagnosticsByTaskId = useWorkflowStore((s) => s.diagnosticsByTaskId);
  const selectedTaskId = useWorkflowStore((s) => s.selectedTaskId);
  const taskIdBySessionId = useWorkflowStore((s) => s.taskIdBySessionId);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const errorByTaskId = useWorkflowStore((s) => s.errorByTaskId);
  const loadingTaskIds = useWorkflowStore((s) => s.loadingTaskIds);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const attachSessionAndLoad = useWorkflowStore((s) => s.attachSessionAndLoad);
  const workspaces = useWorkspacesSorted();
  const claimStep = useWorkflowStore((s) => s.claimStep);
  const completeStep = useWorkflowStore((s) => s.completeStep);
  const blockStep = useWorkflowStore((s) => s.blockStep);
  const resolveApproval = useWorkflowStore((s) => s.resolveApproval);
  const pendingActionByStepId = useWorkflowStore((s) => s.pendingActionByStepId);
  const pendingApprovalIds = useWorkflowStore((s) => s.pendingApprovalIds);
  const executionState = useWorkflowExecutionStore((s) => (session ? s.executionStateBySessionId[session.id] ?? null : null));
  const activeExecutionIntent = useWorkflowExecutionStore((s) => (session ? s.activeIntentBySessionId[session.id] ?? null : null));
  const autoContinueDecision = useWorkflowExecutionStore((s) => (session ? s.lastAutoContinueDecisionBySessionId[session.id] ?? null : null));

  const workspace = workspaces.find((item) => item.id === session?.workspaceId) ?? null;

  useEffect(() => {
    if (!session) return;
    void attachSessionAndLoad({
      provider: providerForSession(session),
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      cwd: session.workdir,
      worktreePath: session.worktreePath,
      workspaceId: session.workspaceId,
      workspaceName: workspace?.name,
      workspacePath: workspace?.path,
      sessionName: session.name,
      currentTask: session.currentTask,
      branchName: session.branchName,
      baseBranch: session.baseBranch,
      sessionStatus: session.status,
    });
  }, [attachSessionAndLoad, session, workspace?.name, workspace?.path]);

  const taskId = session ? taskIdBySessionId[session.id] ?? selectedTaskId : selectedTaskId;
  const document = taskId ? snapshotsByTaskId[taskId] : undefined;
  const events = taskId ? eventsByTaskId[taskId] ?? [] : [];
  const diagnostics = taskId ? diagnosticsByTaskId[taskId] ?? [] : [];
  const documentWithExecutionState = useMemo(() => {
    if (!document || !session || !executionState) return document;
    return {
      ...document,
      nodes: document.nodes.map((item) => {
        if (item.kind !== "step") return item;
        if (item.runtime?.currentSession?.id !== session.id) return item;
        return {
          ...item,
          runtime: {
            ...item.runtime,
            metadata: {
              ...(item.runtime?.metadata ?? {}),
              executionState,
            },
          },
        };
      }),
    };
  }, [document, executionState, session]);
  const node = useMemo(() => selectWorkflowNodeById(documentWithExecutionState, selectedNodeId), [documentWithExecutionState, selectedNodeId]);

  if (!session) {
    return <EmptyState text="Choose a session to inspect workflow orchestration." />;
  }

  if (!taskId || !document) {
    const loading = loadingTaskIds[taskId ?? ""];
    if (loading) {
      return <EmptyState text="Loading workflow…" />;
    }
    return <EmptyState text={errorByTaskId[taskId ?? ""] || "No workflow snapshot available yet."} />;
  }

  const filteredEvents = node && "stepId" in node
    ? events.filter((event) => event.stepId === node.stepId || event.taskId === document.task.id)
    : events;
  const filteredDiagnostics = node && "stepId" in node
    ? diagnostics.filter((diagnostic) => diagnostic.stepId === node.stepId || diagnostic.taskId === document.task.id)
    : diagnostics;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--ci-bg)" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--ci-toolbar-border)", background: "var(--ci-panel-bg)" }}>
          <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
            Workflow execution
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {executionState ? (
              <span style={executionBadgeStyle(executionState)}>
                {executionState === "waiting" && activeExecutionIntent ? "auto-continuing" : executionState}
              </span>
            ) : null}
            {activeExecutionIntent ? (
              <span style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>{activeExecutionIntent.action}</span>
            ) : null}
            {autoContinueDecision ? (
              <span style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
                {autoContinueDecision.state === "continued" ? "continued" : "stopped"} · {autoContinueDecision.reason}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WorkflowGraph document={documentWithExecutionState ?? document} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNode} />
        </div>
      </div>
      <WorkflowDetailSheet
        node={node}
        onClose={() => setSelectedNode(null)}
        onClaim={(stepId) => void claimStep(session.id, stepId)}
        onComplete={(stepId) => void completeStep(session.id, stepId)}
        onBlock={(stepId) => void blockStep(session.id, stepId, `Blocked ${stepId} from workflow surface`)}
        onResolveApproval={(approvalId) => void resolveApproval(approvalId, session.id)}
        diagnostics={filteredDiagnostics}
        events={filteredEvents}
        capabilities={{
          canClaimStep: document.capabilities.canClaimStep,
          canCompleteStep: document.capabilities.canCompleteStep,
          canBlockStep: document.capabilities.canBlockStep,
          canResolveApproval: document.capabilities.canResolveApproval,
        }}
        pendingAction={node && node.kind === "step" ? pendingActionByStepId[node.stepId] ?? null : null}
        approvalPending={node && node.kind === "approval_gate" ? pendingApprovalIds[node.approvalRequest.id] ?? false : false}
        executionState={executionState}
        activeExecutionAction={activeExecutionIntent?.action ?? null}
        autoContinueDecision={autoContinueDecision}
      />
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
      }}
    >
      {text}
    </div>
  );
}
