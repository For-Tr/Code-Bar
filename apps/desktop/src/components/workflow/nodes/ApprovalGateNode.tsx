import type { TaskDagApprovalGateNode } from "@codebar/contracts";
import type { WorkflowGraphNodeData } from "../transformWorkflowToReactFlow";

export function ApprovalGateNode({ data, selected }: { data: WorkflowGraphNodeData; selected?: boolean }) {
  const node = data.workflowNode as TaskDagApprovalGateNode;
  return (
    <div
      style={{
        minWidth: 220,
        borderRadius: 14,
        border: selected ? "1px solid #f59e0b" : "1px solid #fcd34d",
        background: "#fffbeb",
        padding: 14,
        boxShadow: selected ? "0 0 0 1px rgba(245,158,11,0.22)" : "none",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#92400e" }}>
        Approval
      </div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#78350f" }}>{node.label}</div>
      {node.approvalRequest.summary ? (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: "#92400e" }}>{node.approvalRequest.summary}</div>
      ) : null}
      <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: "#b45309" }}>
        {node.approvalRequest.status}
      </div>
    </div>
  );
}
