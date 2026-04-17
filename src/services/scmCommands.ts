import { invoke } from "@tauri-apps/api/core";
import { openDiff } from "./editorCommands";
import { useEditorStore } from "../store/editorStore";
import { useExplorerStore } from "../store/explorerStore";
import { type ScmActionMode, type ScmEntryGroup, useScmStore } from "../store/scmStore";
import { useSessionStore } from "../store/sessionStore";
import { useWorkbenchStore } from "../store/workbenchStore";

interface ConflictVersion {
  label: "base" | "ours" | "theirs" | "working";
  content: string;
  isBinary: boolean;
  missing: boolean;
}

interface ConflictPayload {
  path: string;
  versions: ConflictVersion[];
}

function getSession(sessionId: string) {
  return useSessionStore.getState().sessions.find((item) => item.id === sessionId) ?? null;
}

function openScmFileInEditor(sessionId: string, path: string, preview = true) {
  useEditorStore.getState().openFile(sessionId, path, preview);
  useExplorerStore.getState().setSelectedPath(sessionId, path);
  const workbench = useWorkbenchStore.getState();
  workbench.showScm(sessionId);
  workbench.setCenterSurface("editor");
}

async function withRefresh(sessionId: string, action: () => Promise<void>) {
  const session = getSession(sessionId);
  if (!session) return;
  const scm = useScmStore.getState();
  scm.setActionPending(sessionId, true);
  scm.setActionError(sessionId, null);
  try {
    await action();
    await Promise.all([
      invoke("get_git_status", { sessionId, workdir: session.workdir }),
      session.baseBranch
        ? invoke("get_git_diff_session_worktree", { sessionId, workdir: session.workdir, baseBranch: session.baseBranch })
        : invoke("get_git_diff", { sessionId, workdir: session.workdir }),
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
  const session = getSession(sessionId);

  if (group === "untracked") {
    openScmFileInEditor(sessionId, path, true);
    return;
  }

  if (group === "conflicts" && session) {
    void invoke<ConflictPayload>("git_read_conflict_file", {
      workdir: session.workdir,
      path,
    }).then((payload) => {
      useScmStore.getState().setConflictPayload(sessionId, payload);
    }).catch((error) => {
      useScmStore.getState().setActionError(sessionId, error instanceof Error ? error.message : String(error));
    });
  } else {
    useScmStore.getState().setConflictPayload(sessionId, null);
  }

  if (session && (group === "staged" || group === "unstaged")) {
    void invoke("get_git_diff_side", {
      sessionId,
      workdir: session.workdir,
      path,
      mode: group === "staged" ? "staged" : "unstaged",
    }).catch(() => {});
  }

  openDiff(sessionId, path);
}

export async function stageScmFile(sessionId: string, path: string) {
  const session = getSession(sessionId);
  if (!session) return;
  await withRefresh(sessionId, async () => {
    await invoke("git_stage_file", { workdir: session.workdir, path });
  });
}

export async function unstageScmFile(sessionId: string, path: string) {
  const session = getSession(sessionId);
  if (!session) return;
  await withRefresh(sessionId, async () => {
    await invoke("git_unstage_file", { workdir: session.workdir, path });
  });
}

export async function discardScmFile(sessionId: string, path: string, mode: "staged" | "unstaged" | "untracked") {
  const session = getSession(sessionId);
  if (!session) return;
  await withRefresh(sessionId, async () => {
    await invoke("git_discard_file", { workdir: session.workdir, path, mode });
  });
}

export async function commitScm(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return;
  const message = useScmStore.getState().commitMessageBySessionId[sessionId] ?? "";
  await withRefresh(sessionId, async () => {
    await invoke("git_commit_staged", { workdir: session.workdir, message });
  });
  useScmStore.getState().setCommitMessage(sessionId, "");
}

export async function applyScmHunk(sessionId: string, path: string, mode: ScmActionMode, hunkIndex: number, action: "stage" | "unstage" | "discard") {
  const session = getSession(sessionId);
  if (!session) return;
  await withRefresh(sessionId, async () => {
    if (action === "stage") {
      await invoke("git_stage_hunk", { workdir: session.workdir, path, hunkIndex });
      return;
    }
    if (action === "unstage") {
      await invoke("git_unstage_hunk", { workdir: session.workdir, path, hunkIndex });
      return;
    }
    if (mode !== "unstaged") {
      throw new Error("当前只支持从未暂存变更中 discard hunk");
    }
    await invoke("git_discard_hunk", { workdir: session.workdir, path, hunkIndex });
  });

  if (mode === "staged" || mode === "unstaged") {
    void selectScmFile(sessionId, mode, path);
  }
}

export async function resolveConflict(sessionId: string, path: string, strategy: "ours" | "theirs") {
  const session = getSession(sessionId);
  if (!session) return;
  await withRefresh(sessionId, async () => {
    await invoke("git_resolve_conflict", { workdir: session.workdir, path, strategy });
  });
  useScmStore.getState().setConflictPayload(sessionId, null);
  useScmStore.getState().setSelectedEntry(sessionId, null);
  openScmFileInEditor(sessionId, path, false);
}
