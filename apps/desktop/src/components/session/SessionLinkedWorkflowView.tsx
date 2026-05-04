import { useEffect, useRef, useState } from "react";
import { type ClaudeSession } from "../../store/sessionStore";
import { useWorkflowStore } from "../../store/workflowStore";
import { showWorkflow } from "../../services/workbenchCommands";
import { resolveSessionWorkflowLink } from "./resolveSessionWorkflowLink";

function lifecycleLabel(value: string | null) {
  return value === "in_review" ? "in review" : value;
}

export function SessionLinkedWorkflowView({ session }: { session: ClaudeSession }) {
  const snapshotsByTaskId = useWorkflowStore((s) => s.snapshotsByTaskId);
  const refreshWorkflow = useWorkflowStore((s) => s.refreshWorkflow);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const loadRequestIdRef = useRef(0);

  const taskId = session.taskId ?? null;
  const document = taskId ? snapshotsByTaskId[taskId] : undefined;

  useEffect(() => {
    if (!taskId || document) {
      setIsLoadingDocument(false);
      return;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoadingDocument(true);

    void refreshWorkflow(taskId, session.id).finally(() => {
      if (loadRequestIdRef.current !== requestId) return;
      setIsLoadingDocument(false);
    });
  }, [document, refreshWorkflow, session.id, taskId]);

  if (!taskId) {
    return (
      <div style={{ padding: 20, color: "var(--ci-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
        This session is not linked to a workflow yet.
      </div>
    );
  }

  const link = resolveSessionWorkflowLink({
    sessionId: session.id,
    taskId,
    document,
  });

  if (!document) {
    const message = isLoadingDocument
      ? "Loading workflow details…"
      : "Waiting for workflow details…";

    return (
      <div style={{ padding: 20, color: "var(--ci-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
        {message}
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Workflow
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {link.taskTitle ?? taskId}
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Lifecycle: {lifecycleLabel(link.lifecycle)}
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Current step: {link.stepLabel ?? "No step currently assigned to this session"}
        </div>
        {link.stepStatus ? (
          <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
            Step status: {link.stepStatus}
          </div>
        ) : null}
        <div>
          <button
            onClick={() => showWorkflow(session.id, taskId, "overview")}
            style={{
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              fontWeight: 600,
              background: "var(--ci-accent-bg)",
              color: "var(--ci-accent)",
              border: "1px solid var(--ci-accent-bdr)",
              cursor: "pointer",
            }}
          >
            Open workflow
          </button>
        </div>
      </div>
    </div>
  );
}
