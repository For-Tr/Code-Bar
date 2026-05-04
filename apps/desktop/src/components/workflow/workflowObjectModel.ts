import type { TaskDagDocument, TaskDagStepNode, WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowObjectTab } from "../../store/workbenchStore";

export interface WorkflowExecutionSessionSummary {
  sessionId: string;
  provider: string;
  state: string;
  stepId: string;
  stepLabel: string;
}

export function collectWorkflowExecutionSessions(document: TaskDagDocument | undefined): WorkflowExecutionSessionSummary[] {
  if (!document) return [];

  return document.nodes.flatMap((node) => {
    if (node.kind !== "step") return [];
    const step = node as TaskDagStepNode;
    const currentSession = step.runtime?.currentSession;
    if (!currentSession) return [];
    return [{
      sessionId: currentSession.id,
      provider: currentSession.provider,
      state: currentSession.state,
      stepId: step.stepId,
      stepLabel: step.label,
    }];
  });
}

export function canRunWorkflowExecutionSetupActions(lifecycle: WorkflowLifecycle): boolean {
  return lifecycle === "confirmed";
}

export function resolveWorkflowOverviewCta(lifecycle: WorkflowLifecycle): {
  title: string;
  detail: string;
  buttonLabel: string;
  targetTab: WorkflowObjectTab;
} {
  switch (lifecycle) {
    case "draft":
      return {
        title: "Draft the workflow",
        detail: "Refine scope and decomposition before sending it for review.",
        buttonLabel: "Review Graph",
        targetTab: "graph",
      };
    case "in_review":
      return {
        title: "Confirm the workflow",
        detail: "Inspect the graph and blockers before confirming the plan.",
        buttonLabel: "Open Graph",
        targetTab: "graph",
      };
    case "confirmed":
      return {
        title: "Prepare execution",
        detail: "Attach or create sessions before starting the workflow.",
        buttonLabel: "Open Execution",
        targetTab: "execution",
      };
    case "running":
      return {
        title: "Monitor execution",
        detail: "Track sessions, blockers, approvals, and progress from the control plane.",
        buttonLabel: "Open Activity",
        targetTab: "activity",
      };
  }
}
