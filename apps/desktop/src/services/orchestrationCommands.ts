import { invoke } from "@tauri-apps/api/core";
import type {
  AttachWorkflowSessionRequest,
  BlockWorkflowStepRequest,
  ClaimWorkflowStepRequest,
  ClaimWorkflowStepResponse,
  CompleteWorkflowStepRequest,
  GetWorkflowSnapshotRequest,
  GetWorkflowSnapshotResponse,
  ResolveWorkflowApprovalRequest,
  TaskDagEvent,
  TaskDagNextAction,
  UpdateWorkflowProgressRequest,
} from "@codebar/contracts";

export interface WorkflowNextActionResponse {
  taskId: string;
  nextAction: TaskDagNextAction;
}

export function getWorkflowSnapshot(input: GetWorkflowSnapshotRequest) {
  return invoke<GetWorkflowSnapshotResponse>("orchestration_get_workflow_snapshot", { input });
}

export function listWorkflowEvents(taskId: string) {
  return invoke<TaskDagEvent[]>("orchestration_list_task_events", { taskId });
}

export function getWorkflowNextAction(sessionId: string) {
  return invoke<WorkflowNextActionResponse>("orchestration_get_session_next_action", { sessionId });
}

export function claimWorkflowStep(input: ClaimWorkflowStepRequest) {
  return invoke<ClaimWorkflowStepResponse>("orchestration_claim_step", { input });
}

export function updateWorkflowProgress(input: UpdateWorkflowProgressRequest) {
  return invoke<void>("orchestration_update_step_progress", { input });
}

export function completeWorkflowStep(input: CompleteWorkflowStepRequest) {
  return invoke<void>("orchestration_complete_step", { input });
}

export function blockWorkflowStep(input: BlockWorkflowStepRequest) {
  return invoke<void>("orchestration_block_step", { input });
}

export function attachWorkflowSession(input: AttachWorkflowSessionRequest) {
  return invoke("orchestration_attach_session", { input });
}

export function resolveWorkflowApproval(input: ResolveWorkflowApprovalRequest) {
  return invoke<void>("orchestration_resolve_approval", { input });
}
