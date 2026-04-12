import type { RunnerConfig, RunnerType } from "../store/settingsStore";
import type { ClaudeSession } from "../store/sessionStore";
import type { Workspace, TerminalHost } from "../store/workspaceStore";

export interface SessionLaunchContext {
  session: ClaudeSession;
  workspace?: Workspace;
  runner: RunnerConfig;
  settingsApiKeys?: {
    anthropic?: string;
    openai?: string;
  };
  siblingRunningCount?: number;
}

export interface SessionLaunchRecipe {
  terminalHost: TerminalHost;
  cwd: string;
  command: string;
  baseArgs: string[];
  resumeSessionId: string;
  launchArgs: string[];
  displayCommand: string;
  contextEnv: [string, string][];
  runnerType: RunnerType;
  canResume: boolean;
}

export function getSessionLaunchCwd(session: Pick<ClaudeSession, "worktreePath" | "workdir">): string {
  return session.worktreePath?.trim() || session.workdir;
}

export function getRunnerCommand(runner: RunnerConfig): string {
  return runner.type === "claude-code"
    ? runner.cliPath || "claude"
    : runner.cliPath || "codex";
}

export function getResumeSessionId(session: Pick<ClaudeSession, "providerSessionId" | "runner">): string {
  if (session.runner.type !== "claude-code" && session.runner.type !== "codex") {
    return "";
  }
  return session.providerSessionId?.trim() ?? "";
}

export function getRunnerBaseArgs(
  runner: RunnerConfig,
  resumeSessionId: string
): string[] {
  if (runner.type === "claude-code") {
    return resumeSessionId
      ? ["--resume", resumeSessionId, "--dangerously-skip-permissions"]
      : ["--dangerously-skip-permissions"];
  }

  return resumeSessionId ? ["resume", resumeSessionId] : [];
}

export function buildSessionContextEnv({
  session,
  workspace,
  runner,
  settingsApiKeys,
  siblingRunningCount = 0,
}: SessionLaunchContext): [string, string][] {
  const env: [string, string][] = [
    ["CODE_BAR_SESSION_ID", session.id],
    ["CODE_BAR_RUNNER_TYPE", runner.type],
    ["CODE_BAR_SESSION_NAME", session.name],
    ["CODE_BAR_WORKDIR", session.workdir],
    ["CODE_BAR_WORKSPACE_ID", session.workspaceId],
    ["CODE_BAR_WORKSPACE_NAME", workspace?.name ?? ""],
    ["CODE_BAR_CONCURRENT_SESSIONS", String(siblingRunningCount)],
    ["CODE_BAR_SUGGESTED_BRANCH", `ci/session-${session.id}`],
  ];

  if (session.worktreePath) {
    env.push(
      ["CODE_BAR_WORKTREE_PATH", session.worktreePath],
      ["CODE_BAR_BASE_BRANCH", session.baseBranch ?? ""],
      ["CODE_BAR_BRANCH", session.branchName ?? ""]
    );
  }

  if (workspace) {
    env.push(
      ["CODE_BAR_WORKSPACE_TARGET", workspace.target.kind],
      ["CODE_BAR_TERMINAL_HOST", session.terminalHost]
    );
    if (workspace.target.kind === "ssh") {
      env.push(
        ["CODE_BAR_REMOTE_HOST", workspace.target.host],
        ["CODE_BAR_REMOTE_PATH", workspace.target.remotePath],
        ["CODE_BAR_REMOTE_USER", workspace.target.user ?? ""],
        ["CODE_BAR_REMOTE_PORT", workspace.target.port ? String(workspace.target.port) : ""]
      );
    }
  }

  const apiKey = runner.apiKeyOverride?.trim()
    || settingsApiKeys?.[runner.type === "claude-code" ? "anthropic" : "openai"]
    || "";
  const apiBaseUrl = runner.apiBaseUrl?.trim() ?? "";

  if (runner.type === "claude-code") {
    if (apiKey) env.push(["ANTHROPIC_API_KEY", apiKey]);
    if (apiBaseUrl) env.push(["ANTHROPIC_BASE_URL", apiBaseUrl]);
  } else {
    if (apiKey) env.push(["OPENAI_API_KEY", apiKey]);
    if (apiBaseUrl) env.push(["OPENAI_BASE_URL", apiBaseUrl]);
  }

  return env;
}

export function buildSessionLaunchRecipe(context: SessionLaunchContext): SessionLaunchRecipe {
  const terminalHost = context.session.terminalHost;
  const cwd = getSessionLaunchCwd(context.session);
  const command = getRunnerCommand(context.runner);
  const resumeSessionId = getResumeSessionId(context.session);
  const baseArgs = getRunnerBaseArgs(context.runner, resumeSessionId);
  const launchArgs = [...baseArgs];
  const displayCommand = [command, ...launchArgs].join(" ");
  const contextEnv = buildSessionContextEnv(context);

  return {
    terminalHost,
    cwd,
    command,
    baseArgs,
    resumeSessionId,
    launchArgs,
    displayCommand,
    contextEnv,
    runnerType: context.runner.type,
    canResume: resumeSessionId.length > 0,
  };
}
