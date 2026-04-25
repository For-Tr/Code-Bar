import type { TaskDagDiagnostic, TaskDagEvent, TaskDagNode } from "@codebar/contracts";
import { WorkflowDiagnosticsPanel } from "./WorkflowDiagnosticsPanel";
import { WorkflowEventTimeline } from "./WorkflowEventTimeline";

export function WorkflowDetailSheet({
  node,
  onClose,
  onClaim,
  onComplete,
  onBlock,
  onResolveApproval,
  diagnostics,
  events,
  capabilities,
  pendingAction,
  approvalPending,
  executionState,
  activeExecutionAction,
  autoContinueDecision,
}: {
  node: TaskDagNode | null;
  onClose: () => void;
  onClaim: (stepId: string) => void;
  onComplete: (stepId: string) => void;
  onBlock: (stepId: string) => void;
  onResolveApproval: (approvalId: string) => void;
  diagnostics: TaskDagDiagnostic[];
  events: TaskDagEvent[];
  capabilities: {
    canClaimStep: boolean;
    canCompleteStep: boolean;
    canBlockStep: boolean;
    canResolveApproval: boolean;
  };
  pendingAction?: string | null;
  approvalPending?: boolean;
  executionState?: string | null;
  activeExecutionAction?: string | null;
  autoContinueDecision?: { state: "continued" | "stopped"; reason: string; detail?: string } | null;
}) {
  if (!node) return null;

  const isStep = node.kind === "step";
  const isApproval = node.kind === "approval_gate";

  return (
    <div
      style={{
        width: 340,
        borderInlineStart: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: 16, borderBottom: "1px solid var(--ci-toolbar-border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
            {node.kind}
          </div>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
            {node.kind === "task_root" ? node.label : node.label}
          </div>
        </div>
        <button onClick={onClose} style={{ border: "none", background: "transparent", color: "var(--ci-text-dim)", cursor: "pointer" }}>
          Close
        </button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
        {isStep ? (
          <>
            {node.description ? <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--ci-text-dim)" }}>{node.description}</div> : null}
            <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>Status: {node.status}</div>
            {executionState ? (
              <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
                Execution: {executionState === "waiting" && activeExecutionAction ? "auto-continuing" : executionState}{activeExecutionAction ? ` · ${activeExecutionAction}` : ""}
              </div>
            ) : null}
            {autoContinueDecision ? (
              <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
                Auto-continue: {autoContinueDecision.state} · {autoContinueDecision.reason}
                {autoContinueDecision.detail ? ` · ${autoContinueDecision.detail}` : ""}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={!capabilities.canClaimStep || pendingAction === "claim"} onClick={() => onClaim(node.stepId)} style={actionButtonStyle("accent", !capabilities.canClaimStep || pendingAction === "claim")}>Claim</button>
              <button disabled={!capabilities.canCompleteStep || pendingAction === "complete"} onClick={() => onComplete(node.stepId)} style={actionButtonStyle("default", !capabilities.canCompleteStep || pendingAction === "complete")}>Complete</button>
              <button disabled={!capabilities.canBlockStep || pendingAction === "block"} onClick={() => onBlock(node.stepId)} style={actionButtonStyle("danger", !capabilities.canBlockStep || pendingAction === "block")}>Block</button>
            </div>
          </>
        ) : null}

        {isApproval ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!capabilities.canResolveApproval || approvalPending} onClick={() => onResolveApproval(node.approvalRequest.id)} style={actionButtonStyle("accent", !capabilities.canResolveApproval || approvalPending)}>Approve</button>
          </div>
        ) : null}

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
            Events
          </div>
          <div style={{ marginTop: 10 }}>
            <WorkflowEventTimeline events={events} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
            Diagnostics
          </div>
          <div style={{ marginTop: 10 }}>
            <WorkflowDiagnosticsPanel diagnostics={diagnostics} />
          </div>
        </div>
      </div>
    </div>
  );
}

function actionButtonStyle(variant: "default" | "accent" | "danger" = "default", disabled = false) {
  const colors = {
    default: {
      background: "var(--ci-btn-ghost-bg)",
      color: "var(--ci-text)",
      border: "1px solid var(--ci-toolbar-border)",
    },
    accent: {
      background: "var(--ci-accent-bg)",
      color: "var(--ci-accent)",
      border: "1px solid var(--ci-accent-bdr)",
    },
    danger: {
      background: "var(--ci-deleted-bg)",
      color: "var(--ci-deleted-text)",
      border: "1px solid var(--ci-border-med)",
    },
  } as const;
  return {
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    ...colors[variant],
  };
}
