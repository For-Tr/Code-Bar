import type { PlanMode, ProviderKind } from "./domain";

export type RecommendedSequenceItemType = "skill" | "tool";
export type SkillArtifactType = "text" | "json" | "file" | "command" | "url";

export interface SessionAttachInput {
  provider: ProviderKind;
  providerSessionId?: string;
  cwd: string;
}

export interface SessionAttachOutput {
  sessionId: string;
  taskId: string;
  mode: PlanMode;
  activeStepId?: string;
  activeSkillProfileId?: string;
  recommendedNextCalls: string[];
}

export interface ContextGetCurrentInput {
  sessionId: string;
}

export interface ContextTaskView {
  id: string;
  title: string;
  prompt: string;
  goal?: string;
  constraints?: string[];
}

export interface ContextWorkspaceView {
  id: string;
  rootPath: string;
}

export interface ContextWorktreeView {
  id: string;
  path: string;
  branchName?: string;
}

export interface ContextSessionView {
  id: string;
  provider: ProviderKind;
  state: string;
}

export interface ContextGetCurrentOutput {
  task: ContextTaskView;
  workspace: ContextWorkspaceView;
  worktree?: ContextWorktreeView;
  session: ContextSessionView;
}

export interface RecommendedSequenceItem {
  type: RecommendedSequenceItemType;
  name: string;
}

export interface TaskGetNextActionInput {
  sessionId: string;
}

export interface TaskGetNextActionStep {
  id: string;
  title: string;
  description?: string;
  successCriteria?: string[];
  leaseToken?: string;
}

export interface TaskGetNextActionOutput {
  mode: PlanMode;
  step?: TaskGetNextActionStep;
  activeSkills: string[];
  recommendedSequence?: RecommendedSequenceItem[];
}

export interface TaskUpdateProgressInput {
  sessionId: string;
  stepId?: string;
  leaseToken?: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface McpAcceptedOutput {
  accepted: true;
}

export interface TaskCompleteStepInput {
  sessionId: string;
  stepId: string;
  leaseToken?: string;
  summary?: string;
  outputs?: Record<string, unknown>;
}

export interface TaskCompleteStepOutput {
  accepted: true;
  nextStepId?: string;
}

export interface TaskBlockStepInput {
  sessionId: string;
  stepId: string;
  reason: string;
}

export interface SkillListActiveInput {
  sessionId: string;
}

export interface SkillListActiveOutput {
  activeSkills: string[];
  preferredSkills?: string[];
  forbiddenSkills?: string[];
}

export interface SkillInvokeInput {
  sessionId: string;
  stepId?: string;
  skill: string;
  input: Record<string, unknown>;
}

export interface SkillArtifact {
  type: SkillArtifactType;
  uri?: string;
  text?: string;
}

export interface SkillInvokeOutput {
  summary: string;
  result?: Record<string, unknown>;
  artifacts?: SkillArtifact[];
}
