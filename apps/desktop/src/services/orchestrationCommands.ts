import { daemonRequest } from "./tauriDaemonRequest";
import type {
  AttachWorkflowSessionRequest,
  AttachWorkflowSessionResponse,
  BlockWorkflowStepRequest,
  ClaimWorkflowStepRequest,
  ClaimWorkflowStepResponse,
  CompleteWorkflowStepRequest,
  CompleteWorkflowStepResponse,
  GetWorkflowNextActionRequest,
  GetWorkflowNextActionResponse,
  GetWorkflowSnapshotRequest,
  GetWorkflowSnapshotResponse,
  ResolveWorkflowApprovalRequest,
  ResolveWorkflowApprovalResponse,
  TaskDagEvent,
  UpdateWorkflowProgressRequest,
} from "@codebar/contracts";

export function getWorkflowSnapshot(input: GetWorkflowSnapshotRequest) {
  return daemonRequest<GetWorkflowSnapshotResponse>("getWorkflowSnapshot", input);
}

export async function listWorkflowEvents(taskId: string) {
  const snapshot = await getWorkflowSnapshot({ taskId, includeEvents: true, includeDiagnostics: false });
  return snapshot.events satisfies TaskDagEvent[];
}

export function getWorkflowNextAction(sessionId: string) {
  const input: GetWorkflowNextActionRequest = { sessionId };
  return daemonRequest<GetWorkflowNextActionResponse>("getWorkflowNextAction", input);
}

export function claimWorkflowStep(input: ClaimWorkflowStepRequest) {
  return daemonRequest<ClaimWorkflowStepResponse>("claimWorkflowStep", input);
}

export function updateWorkflowProgress(input: UpdateWorkflowProgressRequest) {
  return daemonRequest<{ accepted: boolean }>("updateWorkflowProgress", input);
}

export function completeWorkflowStep(input: CompleteWorkflowStepRequest) {
  return daemonRequest<CompleteWorkflowStepResponse>("completeWorkflowStep", input);
}

export function blockWorkflowStep(input: BlockWorkflowStepRequest) {
  return daemonRequest<{ accepted: boolean }>("blockWorkflowStep", input);
}

export function attachWorkflowSession(input: AttachWorkflowSessionRequest) {
  return daemonRequest<AttachWorkflowSessionResponse>("attachWorkflowSession", input);
}

export function resolveWorkflowApproval(input: ResolveWorkflowApprovalRequest) {
  return daemonRequest<ResolveWorkflowApprovalResponse>("resolveWorkflowApproval", input);
}
