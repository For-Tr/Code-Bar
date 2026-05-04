import type { WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowExecutionSessionSummary } from "./workflowObjectModel";

export function WorkflowExecutionTab({
  lifecycle,
  workflowSessionId,
  sessions,
  canAttachCurrentSession,
  canCreateSession,
  canStartWorkflow,
  attachingSession,
  creatingSession,
  startingWorkflow,
  onAttachCurrentSession,
  onCreateSession,
  onStartWorkflow,
}: {
  lifecycle: WorkflowLifecycle;
  workflowSessionId: string | null;
  sessions: WorkflowExecutionSessionSummary[];
  canAttachCurrentSession: boolean;
  canCreateSession: boolean;
  canStartWorkflow: boolean;
  attachingSession: boolean;
  creatingSession: boolean;
  startingWorkflow: boolean;
  onAttachCurrentSession: () => void;
  onCreateSession: () => void;
  onStartWorkflow: () => void;
}) {
  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Execution controls
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!canAttachCurrentSession || attachingSession} onClick={onAttachCurrentSession} style={secondaryButtonStyle(!canAttachCurrentSession || attachingSession)}>
            {attachingSession ? "Attaching…" : "Attach current session"}
          </button>
          <button disabled={!canCreateSession || creatingSession} onClick={onCreateSession} style={secondaryButtonStyle(!canCreateSession || creatingSession)}>
            {creatingSession ? "Creating…" : "Create session"}
          </button>
          <button disabled={!workflowSessionId || !canStartWorkflow || startingWorkflow} onClick={onStartWorkflow} style={primaryButtonStyle(!workflowSessionId || !canStartWorkflow || startingWorkflow)}>
            {startingWorkflow ? "Starting…" : "Start workflow"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
          Lifecycle: {lifecycle}. Use this tab to bind sessions before starting execution.
        </div>
      </div>

      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Participating sessions
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            No workflow steps are currently attached to a session.
          </div>
        ) : (
          sessions.map((item) => (
            <div key={`${item.sessionId}:${item.stepId}`} style={{
              borderRadius: 10,
              border: "1px solid var(--ci-toolbar-border)",
              background: "var(--ci-card-bg)",
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ci-text)" }}>
                  s-{item.sessionId}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--ci-text-dim)" }}>
                  {item.stepLabel}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--ci-text-dim)" }}>
                <div>{item.provider}</div>
                <div style={{ marginTop: 4 }}>{item.state}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-accent-bg)",
    color: "var(--ci-accent)",
    border: "1px solid var(--ci-accent-bdr)",
  } as const;
}

function secondaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}
