import { useEffect, useMemo } from "react";
import type { ClaudeSession } from "../../store/sessionStore";
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
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const errorByTaskId = useWorkflowStore((s) => s.errorByTaskId);
  const loadingTaskIds = useWorkflowStore((s) => s.loadingTaskIds);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const attachSessionAndLoad = useWorkflowStore((s) => s.attachSessionAndLoad);
  const claimStep = useWorkflowStore((s) => s.claimStep);
  const completeStep = useWorkflowStore((s) => s.completeStep);
  const blockStep = useWorkflowStore((s) => s.blockStep);
  const resolveApproval = useWorkflowStore((s) => s.resolveApproval);

  useEffect(() => {
    if (!session) return;
    void attachSessionAndLoad({
      provider: providerForSession(session),
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      cwd: session.workdir,
      worktreePath: session.worktreePath,
    });
  }, [attachSessionAndLoad, session]);

  const document = selectedTaskId ? snapshotsByTaskId[selectedTaskId] : undefined;
  const events = selectedTaskId ? eventsByTaskId[selectedTaskId] ?? [] : [];
  const diagnostics = selectedTaskId ? diagnosticsByTaskId[selectedTaskId] ?? [] : [];
  const node = useMemo(() => selectWorkflowNodeById(document, selectedNodeId), [document, selectedNodeId]);

  if (!session) {
    return <EmptyState text="Choose a session to inspect workflow orchestration." />;
  }

  if (!selectedTaskId || !document) {
    const loading = loadingTaskIds[selectedTaskId ?? ""];
    if (loading) {
      return <EmptyState text="Loading workflow…" />;
    }
    return <EmptyState text={errorByTaskId[selectedTaskId ?? ""] || "No workflow snapshot available yet."} />;
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
