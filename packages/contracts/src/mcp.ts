import type { PlanMode, ProviderKind } from "./domain";

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
