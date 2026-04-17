import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, type ClaudeSession } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS, type RunnerConfig, type RunnerType } from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";

export const CLI_INSTALL_CMD: Partial<Record<RunnerType, string>> = {
  "claude-code": "npm install -g @anthropic-ai/claude-code",
  "codex": "npm install -g @openai/codex",
};

export interface SessionRunnerContext {
  sessionId: string;
  runnerType: RunnerType;
}

export function buildRunnerContext(sessionId: string, runnerType: RunnerType): SessionRunnerContext {
  return { sessionId, runnerType };
}

export function hasNativeResumeBinding(
  session: { runner: { type: RunnerType }; providerSessionId?: string } | undefined
): boolean {
  if (!session?.providerSessionId?.trim()) return false;
  const runnerType = session.runner.type;
  return runnerType === "claude-code" || runnerType === "codex";
}

export function getRunnerBadge(runnerType: RunnerType): string {
  return RUNNER_LABELS[runnerType];
}

export function getRunnerInstallCommand(runnerType: RunnerType): string | undefined {
  return CLI_INSTALL_CMD[runnerType];
}

export function getRunnerCliCommand(runner: RunnerConfig): string {
  return runner.type === "claude-code" ? runner.cliPath || "claude" : runner.cliPath || "codex";
}

export async function checkRunnerAvailability(command: string): Promise<boolean> {
  return invoke<boolean>("check_cli", { command });
}

export function switchRunnerForSession(sessionId: string, type: RunnerType) {
  const nextRunner = useSettingsStore.getState().getRunnerConfigForType(type);
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (session) {
    useSessionStore.getState().updateSession(session.id, { runner: { ...nextRunner } });
  }
  useSettingsStore.getState().patchRunner({ type });
  return nextRunner;
}

export function buildRunnerContextEnv(session: ClaudeSession, runner: RunnerConfig): [string, string][] {
  const workspaces = useWorkspaceStore.getState().workspaces;
  const workspace = workspaces.find((w) => w.id === session.workspaceId);
  const allSessions = useSessionStore.getState().sessions;
  const settings = useSettingsStore.getState().settings;
  const siblingSessions = allSessions.filter(
    (s) => s.workspaceId === session.workspaceId && s.id !== session.id && s.status === "running"
  );

  const env: [string, string][] = [
    ["CODE_BAR_SESSION_ID", session.id],
    ["CODE_BAR_RUNNER_TYPE", runner.type],
    ["CODE_BAR_SESSION_NAME", session.name],
    ["CODE_BAR_WORKDIR", session.workdir],
    ["CODE_BAR_WORKSPACE_ID", session.workspaceId],
    ["CODE_BAR_WORKSPACE_NAME", workspace?.name ?? ""],
    ["CODE_BAR_CONCURRENT_SESSIONS", String(siblingSessions.length)],
    ["CODE_BAR_SUGGESTED_BRANCH", session.branchName ?? `ci/session-${session.id}`],
    ...(session.worktreePath ? [
      ["CODE_BAR_WORKTREE_PATH", session.worktreePath] as [string, string],
      ["CODE_BAR_BASE_BRANCH", session.baseBranch ?? ""] as [string, string],
      ["CODE_BAR_BRANCH", session.branchName ?? ""] as [string, string],
    ] : []),
  ];

  const apiKey = runner.apiKeyOverride?.trim()
    || settings.apiKeys?.[runner.type === "claude-code" ? "anthropic" : "openai"]
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
