import type { TaskDagStepNode } from "@codebar/contracts";
import type { WorkflowGraphNodeData } from "../transformWorkflowToReactFlow";

const STATUS_COLORS: Record<TaskDagStepNode["status"], string> = {
  idle: "var(--ci-text-dim)",
  ready: "#2563eb",
  running: "#16a34a",
  blocked: "#dc2626",
  waiting_input: "#d97706",
  completed: "#0284c7",
  failed: "#ef4444",
};

export function StepNode({ data, selected }: { data: WorkflowGraphNodeData; selected?: boolean }) {
  const node = data.workflowNode as TaskDagStepNode;
  return (
    <div
      style={{
        minWidth: 260,
        borderRadius: 14,
        border: selected ? "1px solid var(--ci-accent)" : "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-card-bg)",
        padding: 14,
        boxShadow: selected ? "0 0 0 1px var(--ci-accent-bg)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ci-text)" }}>{node.label}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[node.status] }}>{node.status}</div>
      </div>
      {node.description ? (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: "var(--ci-text-dim)" }}>{node.description}</div>
      ) : null}
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {node.requiredSkills.map((skill) => (
          <span
            key={skill}
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 10,
              background: "var(--ci-btn-ghost-bg)",
              color: "var(--ci-text-dim)",
            }}
          >
            {skill}
          </span>
        ))}
      </div>
      {node.runtime?.currentSession ? (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>
            Session: {node.runtime.currentSession.state}
          </div>
          {typeof node.runtime.metadata?.executionState === "string" ? (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 10,
                background: "var(--ci-btn-ghost-bg)",
                color: "var(--ci-text-dim)",
              }}
            >
              {node.runtime.metadata.executionState}
            </span>
          ) : null}
        </div>
      ) : null}
      {node.runtime?.activeApproval ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "#d97706" }}>
          Approval: {node.runtime.activeApproval.status}
        </div>
      ) : null}
    </div>
  );
}
