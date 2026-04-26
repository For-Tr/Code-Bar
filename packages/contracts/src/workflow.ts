export type WorkflowMetadata = Record<string, unknown>;

export type TaskDagNodeKind = "task_root" | "step" | "approval_gate";
export type TaskDagEdgeKind = "depends_on" | "spawns_approval";
export type TaskDagProvider = "claude_code" | "codex";
export type TaskDagStepStatus = "idle" | "ready" | "running" | "blocked" | "waiting_input" | "completed" | "failed";
export type TaskDagSessionState = "idle" | "created" | "launching" | "running" | "waiting_input" | "paused" | "completed" | "failed" | "stopped";
export type TaskDagApprovalStatus = "pending" | "approved" | "rejected";
export type TaskDagEventLevel = "info" | "warning" | "error";
export type TaskDagDiagnosticSeverity = "info" | "warning" | "error";

export interface TaskDagTask {
  id: string;
  title: string;
  prompt: string;
  goal?: string;
  status: string;
  workspaceId: string;
  activeSessionId?: string;
  activePlanId?: string;
  metadata?: WorkflowMetadata;
}

export interface TaskDagPlan {
  id: string;
  mode: string;
  status: string;
  activeStepId?: string;
  stepIds: string[];
  metadata?: WorkflowMetadata;
}

export interface TaskDagSession {
  id: string;
  provider: TaskDagProvider;
  state: TaskDagSessionState;
  providerSessionId?: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: string;
}

export interface TaskDagApprovalRequest {
  id: string;
  status: TaskDagApprovalStatus;
  title?: string;
  summary?: string;
  requestedAt?: string;
  respondedAt?: string;
}

export interface TaskDagLease {
  ownerSessionId?: string;
  token?: string;
  expiresAt?: string;
}

export interface TaskDagStepRuntime {
  currentSession?: TaskDagSession;
  activeApproval?: TaskDagApprovalRequest;
  lease?: TaskDagLease;
  latestProgressSummary?: string;
  progressDetails?: WorkflowMetadata;
  outputs?: WorkflowMetadata;
  blockedReason?: string;
  recommendedNextActions: string[];
  metadata?: WorkflowMetadata;
}

export interface TaskDagTaskRootNode {
  kind: "task_root";
  id: string;
  taskId: string;
  label: string;
  description?: string;
  status?: string;
  x: number;
  y: number;
}

export interface TaskDagStepNode {
  kind: "step";
  id: string;
  stepId: string;
  label: string;
  description?: string;
  status: TaskDagStepStatus;
  dependsOn: string[];
  requiredSkills: string[];
  allowedProviders: TaskDagProvider[];
  parallelizable: boolean;
  x: number;
  y: number;
  runtime?: TaskDagStepRuntime;
}

export interface TaskDagApprovalGateNode {
  kind: "approval_gate";
  id: string;
  stepId: string;
  label: string;
  x: number;
  y: number;
  approvalRequest: TaskDagApprovalRequest;
}

export type TaskDagNode = TaskDagTaskRootNode | TaskDagStepNode | TaskDagApprovalGateNode;

export interface TaskDagEdge {
  id: string;
  kind: TaskDagEdgeKind;
  source: string;
  target: string;
  label?: string;
}

export interface TaskDagCapabilities {
  canRefresh: boolean;
  canClaimStep: boolean;
  canCompleteStep: boolean;
  canBlockStep: boolean;
  canResolveApproval: boolean;
  canAttachSession: boolean;
  canLaunchSession: boolean;
  canSendSessionInput: boolean;
}

export interface TaskDagDocument {
  graphId: string;
  revision: string;
  task: TaskDagTask;
  plan?: TaskDagPlan;
  nodes: TaskDagNode[];
  edges: TaskDagEdge[];
  layoutVersion: number;
  capabilities: TaskDagCapabilities;
  metadata?: WorkflowMetadata;
}

export interface TaskDagEvent {
  id: string;
  taskId: string;
  stepId?: string;
  sessionId?: string;
  kind: string;
  level: TaskDagEventLevel;
  message: string;
  createdAt: string;
  data?: WorkflowMetadata;
}

export interface TaskDagDiagnostic {
  id: string;
  taskId: string;
  stepId?: string;
  severity: TaskDagDiagnosticSeverity;
  summary: string;
  detail?: string;
  createdAt?: string;
  data?: WorkflowMetadata;
}

export interface TaskDagNextAction {
  taskId: string;
  mode: string;
  stepId?: string;
  label?: string;
  description?: string;
  activeSkills: string[];
  recommendedSequence: string[];
}

export interface GetWorkflowNextActionRequest {
  sessionId: string;
}

export interface GetWorkflowNextActionResponse {
  taskId: string;
  nextAction: TaskDagNextAction;
}

export interface GetWorkflowSnapshotRequest {
  taskId: string;
  sessionId?: string;
  includeEvents?: boolean;
  includeDiagnostics?: boolean;
}

export interface GetWorkflowSnapshotResponse {
  document: TaskDagDocument;
  events: TaskDagEvent[];
  diagnostics: TaskDagDiagnostic[];
}

export interface ClaimWorkflowStepRequest {
  sessionId: string;
  stepId?: string;
}

export interface ClaimWorkflowStepResponse {
  stepId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface UpdateWorkflowProgressRequest {
  sessionId: string;
  stepId: string;
  leaseToken?: string;
  summary: string;
  details?: WorkflowMetadata;
}

export interface CompleteWorkflowStepRequest {
  sessionId: string;
  stepId: string;
  leaseToken?: string;
  outputs?: WorkflowMetadata;
}

export interface CompleteWorkflowStepResponse {
  nextStepId?: string;
}

export interface BlockWorkflowStepRequest {
  sessionId: string;
  stepId: string;
  reason: string;
}

export interface ResolveWorkflowApprovalRequest {
  approvalId: string;
  decision: string;
  sessionId?: string;
}

export interface ResolveWorkflowApprovalResponse {
  taskId: string;
  sessionId?: string;
}

export interface AttachWorkflowSessionRequest {
  provider: TaskDagProvider;
  sessionId?: string;
  providerSessionId?: string;
  cwd?: string;
  worktreePath?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  sessionName?: string;
  currentTask?: string;
  branchName?: string;
  baseBranch?: string;
  sessionStatus?: string;
}

export interface AttachWorkflowSessionResponse {
  taskId: string;
  sessionId?: string;
  document: TaskDagDocument;
}
