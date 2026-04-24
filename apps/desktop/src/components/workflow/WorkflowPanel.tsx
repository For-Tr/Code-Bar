import { useEffect, useMemo } from "react";
import type { ClaudeSession } from "../../store/sessionStore";
import { useWorkspacesSorted } from "../../store/workspaceStore";
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
  const node = useMemo(() => selectWorkflowNodeById(document, selectedNodeId), [document, selectedNodeId]);

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
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <WorkflowGraph document={document} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNode} />
      </div>
      <WorkflowDetailSheet
        node={node}
        onClose={() => setSelectedNode(null)}
        onClaim={(stepId) => void claimStep(session.id, stepId)}
        onComplete={(stepId) => void completeStep(session.id, stepId)}
        onBlock={(stepId) => void blockStep(session.id, stepId, "Blocked from workflow surface")}
        onResolveApproval={(approvalId) => void resolveApproval(approvalId, session.id)}
        diagnostics={filteredDiagnostics}
        events={filteredEvents}
        capabilities={{
          canClaimStep: document.capabilities.canClaimStep,
          canCompleteStep: document.capabilities.canCompleteStep,
          canBlockStep: document.capabilities.canBlockStep,
          canResolveApproval: document.capabilities.canResolveApproval,
        }}
      />
    </div>
  );
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
