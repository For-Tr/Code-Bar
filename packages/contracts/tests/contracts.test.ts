import type { RunAttempt, Session, Task, Workspace } from "../src/domain";
import type { ErrorEnvelope } from "../src/errors";
import type { CreateTaskInput, SessionFileReadResult } from "../src/rpc";

const workspace: Workspace = {
  id: "ws_123",
  displayName: "CodeBar",
  rootPath: "/repo",
  vcsType: "git",
  trustLevel: "trusted",
  createdAt: "2026-04-24T00:00:00Z",
  updatedAt: "2026-04-24T00:00:00Z",
};

const task: Task = {
  id: "task_123",
  workspaceId: workspace.id,
  title: "Ship contracts",
  prompt: "Add shared contracts",
  status: "ready",
  createdAt: "2026-04-24T00:00:00Z",
  updatedAt: "2026-04-24T00:00:00Z",
};

const session: Session = {
  id: "sess_123",
  taskId: task.id,
  workspaceId: workspace.id,
  provider: "claude",
  launchMode: "new",
  state: "ready",
  createdAt: "2026-04-24T00:00:00Z",
  updatedAt: "2026-04-24T00:00:00Z",
};

const runAttempt: RunAttempt = {
  id: "run_123",
  sessionId: session.id,
  attemptNo: 1,
  launcherType: "pty",
  command: "claude",
  args: ["resume", "ext_123"],
  cwd: "/repo/.code-bar-worktrees/session-1",
  status: "running",
};

const error: ErrorEnvelope = {
  code: "APPROVAL_REQUIRED",
  message: "approval needed",
  retryable: false,
};

const createTaskInput: CreateTaskInput = {
  workspaceId: workspace.id,
  title: task.title,
  prompt: task.prompt,
};

const fileRead: SessionFileReadResult = {
  path: "src/lib.rs",
  content: "fn main() {}",
  versionToken: "1:2",
  isBinary: false,
  missing: false,
};

void { session, runAttempt, error, createTaskInput, fileRead };
