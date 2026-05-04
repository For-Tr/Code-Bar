import { invoke } from "@tauri-apps/api/core";
import { openDiff, revealExplorerPath } from "./editorCommands";
import { useEditorStore } from "../store/editorStore";
import { type ScmActionMode, type ScmEntryGroup, useScmStore } from "../store/scmStore";
import { useSessionStore } from "../store/sessionStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { requestDangerousSessionAction } from "./daemonCommands";
import { getLatestDaemonState } from "../daemon/DaemonDataProvider";
import { resolveEffectiveSessionWorkdir, selectSessionView } from "../daemon/selectors";
import { useWorkspaceStore } from "../store/workspaceStore";

interface ConflictVersion {
  label: "base" | "ours" | "theirs" | "working";
  content: string;
  isBinary: boolean;
  missing: boolean;
}

function isDevHelperPath(path: string) {
  return path === ".codebar-worktree-dev" || path.startsWith(".codebar-worktree-dev/")
}

interface ConflictPayload {
  path: string;
  versions: ConflictVersion[];
}

function getSession(sessionId: string) {
  return useSessionStore.getState().sessions.find((item) => item.id === sessionId) ?? null;
}

function getSessionRuntime(sessionId: string) {
  const session = getSession(sessionId)
  if (!session) return null
  const daemon = getLatestDaemonState()
  const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === session.workspaceId) ?? null
  const workdir = daemon
    ? resolveEffectiveSessionWorkdir(daemon, sessionId, session, workspace)
    : (session.worktreePath ?? session.workdir)
  if (!workdir || isDevHelperPath(workdir)) return null
  const sessionView = daemon ? selectSessionView(daemon, sessionId) : null
  return {
    session,
    workdir,
    baseBranch: sessionView?.worktree?.baseBranch ?? session.baseBranch,
  }
}

function openScmFileInEditor(sessionId: string, path: string, preview = true) {
  useEditorStore.getState().openFile(sessionId, path, preview);
  revealExplorerPath(sessionId, path, "focusNoScroll", "scm");
  const workbench = useWorkbenchStore.getState();
  workbench.showScm(sessionId);
  workbench.setCenterSurface("editor");
}

async function withRefresh(sessionId: string, action: (runtime: NonNullable<ReturnType<typeof getSessionRuntime>>) => Promise<void>) {
  const runtime = getSessionRuntime(sessionId);
  if (!runtime) return;
  const scm = useScmStore.getState();
  scm.setActionPending(sessionId, true);
  scm.setActionError(sessionId, null);
  try {
    await action(runtime);
    await Promise.all([
      invoke("get_git_status", { sessionId, workdir: runtime.workdir }),
      runtime.baseBranch
        ? invoke("get_git_diff_session_worktree", { sessionId, workdir: runtime.workdir, baseBranch: runtime.baseBranch })
        : invoke("get_git_diff", { sessionId, workdir: runtime.workdir }),
    ]);
  } catch (error) {
    scm.setActionError(sessionId, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    scm.setActionPending(sessionId, false);
  }
}

export function selectScmFile(sessionId: string, group: ScmEntryGroup, path: string) {
  useScmStore.getState().setSelectedEntry(sessionId, { group, path });
  useScmStore.getState().setDiffOverride(sessionId, null);
  const runtime = getSessionRuntime(sessionId);

  if (group === "untracked") {
    openScmFileInEditor(sessionId, path, true);
    return;
  }

  if (group === "conflicts" && runtime) {
    void invoke<ConflictPayload>("git_read_conflict_file", {
      workdir: runtime.workdir,
      path,
    }).then((payload) => {
      useScmStore.getState().setConflictPayload(sessionId, payload);
    }).catch((error) => {
      useScmStore.getState().setActionError(sessionId, error instanceof Error ? error.message : String(error));
    });
  } else {
    useScmStore.getState().setConflictPayload(sessionId, null);
  }

  if (runtime && (group === "staged" || group === "unstaged")) {
    void invoke("get_git_diff_side", {
      sessionId,
      workdir: runtime.workdir,
      path,
      mode: group === "staged" ? "staged" : "unstaged",
    }).catch(() => {});
  }

  openDiff(sessionId, path, "focusNoScroll");
}

export async function stageScmFile(sessionId: string, path: string) {
  await withRefresh(sessionId, async (runtime) => {
    await invoke("git_stage_file", { workdir: runtime.workdir, path });
  });
}

export async function unstageScmFile(sessionId: string, path: string) {
  await withRefresh(sessionId, async (runtime) => {
    await invoke("git_unstage_file", { workdir: runtime.workdir, path });
  });
}

export async function discardScmFile(sessionId: string, path: string, mode: "staged" | "unstaged" | "untracked") {
  const session = getSession(sessionId);
  if (!session) return;
  await requestDangerousSessionAction({
    sessionId,
    actionType: 'delete',
    title: mode === 'untracked' ? 'Delete untracked file' : 'Discard file changes',
    description: `${path} (${mode}) requires approval before discarding local changes.`,
    payload: { path, mode },
  }).catch(() => {});
}

export async function commitScm(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return;
  const message = useScmStore.getState().commitMessageBySessionId[sessionId] ?? "";
  await requestDangerousSessionAction({
    sessionId,
    actionType: 'write',
    title: 'Commit staged changes',
    description: `Committing staged changes requires approval. Message: ${message || '(empty)'}`,
    payload: { message },
  }).catch(() => {});
}

export async function stageAllScm(sessionId: string, paths?: string[]) {
  await withRefresh(sessionId, async (runtime) => {
    if (paths && paths.length > 0) {
      await invoke("git_stage_paths", { workdir: runtime.workdir, paths });
      return;
    }
    await invoke("git_stage_all", { workdir: runtime.workdir });
  });
}

export async function unstageAllScm(sessionId: string) {
  await withRefresh(sessionId, async (runtime) => {
    await invoke("git_unstage_all", { workdir: runtime.workdir });
  });
}

export async function applyScmHunk(sessionId: string, path: string, mode: ScmActionMode, hunkIndex: number, action: "stage" | "unstage" | "discard") {
  await withRefresh(sessionId, async (runtime) => {
    if (action === "stage") {
      await invoke("git_stage_hunk", { workdir: runtime.workdir, path, hunkIndex });
      return;
    }
    if (action === "unstage") {
      await invoke("git_unstage_hunk", { workdir: runtime.workdir, path, hunkIndex });
      return;
    }
    if (mode !== "unstaged") {
      throw new Error("当前只支持从未暂存变更中 discard hunk");
    }
    await invoke("git_discard_hunk", { workdir: runtime.workdir, path, hunkIndex });
  });

  if (mode === "staged" || mode === "unstaged") {
    void selectScmFile(sessionId, mode, path);
  }
}

export async function resolveConflict(sessionId: string, path: string, strategy: "ours" | "theirs") {
  await withRefresh(sessionId, async (runtime) => {
    await invoke("git_resolve_conflict", { workdir: runtime.workdir, path, strategy });
  });
  useScmStore.getState().setConflictPayload(sessionId, null);
  useScmStore.getState().setSelectedEntry(sessionId, null);
  openScmFileInEditor(sessionId, path, false);
}
