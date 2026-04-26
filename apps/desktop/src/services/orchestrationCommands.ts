import { invoke } from "@tauri-apps/api/core";
import { daemonRequest } from "./tauriDaemonRequest";
import type {
  AttachWorkflowSessionRequest,
  AttachWorkflowSessionResponse,
  BlockWorkflowStepRequest,
  ClaimWorkflowStepRequest,
  ClaimWorkflowStepResponse,
  CompleteWorkflowStepRequest,
  CompleteWorkflowStepResponse,
  ConfirmWorkflowRequest,
  ConfirmWorkflowResponse,
  CreateTaskInput,
  CreateWorkflowDraftRequest,
  CreateWorkflowDraftResponse,
  GetTaskInput,
  GetTaskOutput,
  GetWorkflowNextActionRequest,
  GetWorkflowNextActionResponse,
  GetWorkflowSnapshotRequest,
  GetWorkflowSnapshotResponse,
  ListTasksInput,
  ListTasksOutput,
  ListWorkflowTasksRequest,
  ListWorkflowTasksResponse,
  ResolveWorkflowApprovalRequest,
  ResolveWorkflowApprovalResponse,
  StartWorkflowRequest,
  StartWorkflowResponse,
  SubmitWorkflowReviewRequest,
  SubmitWorkflowReviewResponse,
  Task,
  TaskDagEvent,
  UpdateTaskInput,
  UpdateTaskOutput,
  UpdateWorkflowProgressRequest,
  WorkflowLifecycle,
  WorkflowTaskSummary,
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

function taskStatusToLifecycle(status: Task["status"]): WorkflowLifecycle {
  if (status === "draft") return "draft";
  if (status === "ready") return "confirmed";
  if (status === "active") return "running";
  return "in_review";
}

function mapTaskToWorkflowSummary(task: Task): WorkflowTaskSummary {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    title: task.title,
    status: task.status,
    lifecycle: taskStatusToLifecycle(task.status),
    updatedAt: task.updatedAt,
  };
}

export async function listWorkflowTasks(input: ListWorkflowTasksRequest) {
  const listInput: ListTasksInput = {
    workspaceId: input.workspaceId,
    status: undefined,
  };

  const loadTasks = async () => {
    try {
      return await daemonRequest<ListTasksOutput>("listTasks", listInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("unknown rpc method listworkflowtasks")) {
        throw error;
      }
      return invoke<ListTasksOutput>("daemon_request", {
        method: "listTasks",
        params: listInput,
      });
    }
  };

  const response = await loadTasks();
  let tasks = response.tasks;
  if (input.lifecycle && input.lifecycle.length > 0) {
    const allowed = new Set(input.lifecycle);
    tasks = tasks.filter((task) => allowed.has(taskStatusToLifecycle(task.status)));
  }
  const mapped: ListWorkflowTasksResponse = {
    tasks: tasks.map(mapTaskToWorkflowSummary),
  };
  return mapped;
}

export async function createWorkflowDraft(input: CreateWorkflowDraftRequest) {
  const createInput: CreateTaskInput = {
    workspaceId: input.workspaceId,
    title: input.title,
    prompt: input.prompt,
    goal: input.goal,
    requestedProvider: input.provider === "codex" ? "codex" : "claude",
  };
  const created = await daemonRequest<{ task: Task }>("createTask", createInput);
  const snapshot = await getWorkflowSnapshot({ taskId: created.task.id, includeEvents: true, includeDiagnostics: true });
  const mapped: CreateWorkflowDraftResponse = {
    taskId: created.task.id,
    document: snapshot.document,
  };
  return mapped;
}

export async function submitWorkflowReview(input: SubmitWorkflowReviewRequest) {
  const getInput: GetTaskInput = { taskId: input.taskId };
  const current = await daemonRequest<GetTaskOutput>("getTask", getInput);
  const mapped: SubmitWorkflowReviewResponse = {
    taskId: current.task.id,
    lifecycle: "in_review",
  };
  return mapped;
}

export async function confirmWorkflow(input: ConfirmWorkflowRequest) {
  const updateInput: UpdateTaskInput = { taskId: input.taskId, status: "ready" };
  const updated = await daemonRequest<UpdateTaskOutput>("updateTask", updateInput);
  const mapped: ConfirmWorkflowResponse = {
    taskId: updated.task.id,
    lifecycle: taskStatusToLifecycle(updated.task.status),
  };
  return mapped;
}

export async function startWorkflow(input: StartWorkflowRequest) {
  const getInput: GetTaskInput = { taskId: input.taskId };
  await daemonRequest<GetTaskOutput>("getTask", getInput);
  const updateInput: UpdateTaskInput = { taskId: input.taskId, status: "active" };
  const updated = await daemonRequest<UpdateTaskOutput>("updateTask", updateInput);
  const mapped: StartWorkflowResponse = {
    taskId: updated.task.id,
    lifecycle: taskStatusToLifecycle(updated.task.status),
  };
  return mapped;
}
