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
}: {
  node: TaskDagNode | null;
  onClose: () => void;
  onClaim: (stepId: string) => void;
  onComplete: (stepId: string) => void;
  onBlock: (stepId: string) => void;
  onResolveApproval: (approvalId: string) => void;
  diagnostics: TaskDagDiagnostic[];
  events: TaskDagEvent[];
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onClaim(node.stepId)} style={actionButtonStyle("accent")}>Claim</button>
              <button onClick={() => onComplete(node.stepId)} style={actionButtonStyle()}>Complete</button>
              <button onClick={() => onBlock(node.stepId)} style={actionButtonStyle("danger")}>Block</button>
            </div>
          </>
        ) : null}

        {isApproval ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => onResolveApproval(node.approvalRequest.id)} style={actionButtonStyle("accent")}>Approve</button>
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

function actionButtonStyle(variant: "default" | "accent" | "danger" = "default") {
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
    cursor: "pointer",
    ...colors[variant],
  };
}
