import type { TaskDagTaskRootNode } from "@codebar/contracts";
import type { WorkflowGraphNodeData } from "../transformWorkflowToReactFlow";

export function TaskRootNode({ data, selected }: { data: WorkflowGraphNodeData; selected?: boolean }) {
  const node = data.workflowNode as TaskDagTaskRootNode;
  return (
    <div
      style={{
        minWidth: 220,
        borderRadius: 14,
        border: selected ? "1px solid var(--ci-accent)" : "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-card-bg)",
        boxShadow: selected ? "0 0 0 1px var(--ci-accent-bg)" : "none",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
        Task
      </div>
      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>{node.label}</div>
      {node.description ? (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: "var(--ci-text-dim)" }}>{node.description}</div>
      ) : null}
      {node.status ? (
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--ci-accent)" }}>{node.status}</div>
      ) : null}
    </div>
  );
}
