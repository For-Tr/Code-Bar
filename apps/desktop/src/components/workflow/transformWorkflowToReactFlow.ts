import { Position, type Edge, type Node } from "@xyflow/react";
import type { TaskDagDocument, TaskDagNode } from "@codebar/contracts";

export type WorkflowGraphNodeData = Record<string, unknown> & {
  workflowNode: TaskDagNode;
};

function labelForNode(node: TaskDagNode): string {
  return node.label;
}

export function transformWorkflowToReactFlow(document: TaskDagDocument) {
  const nodes: Node<WorkflowGraphNodeData>[] = document.nodes.map((node: TaskDagNode) => ({
    id: node.id,
    position: { x: node.x, y: node.y },
    type: node.kind,
    data: { workflowNode: node },
    draggable: false,
    selectable: true,
    connectable: false,
    deletable: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    ariaLabel: labelForNode(node),
  }));

  const edges: Edge[] = document.edges.map((edge: TaskDagDocument["edges"][number]) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.kind === "spawns_approval",
    style: {
      stroke: edge.kind === "spawns_approval" ? "#f59e0b" : "var(--ci-border-strong)",
      strokeWidth: edge.kind === "spawns_approval" ? 2 : 1.5,
    },
  }));

  return { nodes, edges };
}
