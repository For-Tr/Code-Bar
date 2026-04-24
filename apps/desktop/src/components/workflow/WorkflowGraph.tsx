import { Background, BackgroundVariant, MiniMap, ReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import type { TaskDagDocument } from "@codebar/contracts";
import { transformWorkflowToReactFlow } from "./transformWorkflowToReactFlow";
import { ApprovalGateNode } from "./nodes/ApprovalGateNode";
import { StepNode } from "./nodes/StepNode";
import { TaskRootNode } from "./nodes/TaskRootNode";

const nodeTypes: NodeTypes = {
  task_root: TaskRootNode,
  step: StepNode,
  approval_gate: ApprovalGateNode,
};

export function WorkflowGraph({
  document,
  selectedNodeId,
  onSelectNode,
}: {
  document: TaskDagDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const { nodes, edges } = transformWorkflowToReactFlow(document);

  return (
    <ReactFlow
      nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelectNode(String(node.id))}
      onPaneClick={() => onSelectNode(null)}
    >
      <MiniMap pannable zoomable />
      <Background bgColor="transparent" variant={BackgroundVariant.Dots} />
    </ReactFlow>
  );
}
