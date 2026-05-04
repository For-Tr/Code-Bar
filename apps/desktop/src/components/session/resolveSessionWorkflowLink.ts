import type { TaskDagDocument, TaskDagStepNode, WorkflowLifecycle } from "@codebar/contracts";

export interface SessionWorkflowLink {
  taskId: string | null;
  taskTitle: string | null;
  lifecycle: WorkflowLifecycle | null;
  stepId: string | null;
  stepLabel: string | null;
  stepStatus: string | null;
}

function resolveLifecycle(document: TaskDagDocument | undefined): WorkflowLifecycle | null {
  const lifecycle = document?.task.lifecycle;
  if (lifecycle === "draft" || lifecycle === "in_review" || lifecycle === "confirmed" || lifecycle === "running") {
    return lifecycle;
  }
  const status = document?.task.status;
  if (status === "draft") return "draft";
  if (status === "ready") return "confirmed";
  if (status === "active") return "running";
  return document ? "in_review" : null;
}

export function resolveSessionWorkflowLink(input: {
  sessionId: string;
  taskId?: string | null;
  document?: TaskDagDocument;
}): SessionWorkflowLink {
  const taskId = input.taskId ?? input.document?.task.id ?? null;
  const taskTitle = input.document?.task.title ?? null;
  const lifecycle = resolveLifecycle(input.document);
  const stepNode = input.document?.nodes.find((node): node is TaskDagStepNode => {
    return node.kind === "step" && node.runtime?.currentSession?.id === input.sessionId;
  }) ?? null;

  return {
    taskId,
    taskTitle,
    lifecycle,
    stepId: stepNode?.stepId ?? null,
    stepLabel: stepNode?.label ?? null,
    stepStatus: stepNode?.status ?? null,
  };
}
