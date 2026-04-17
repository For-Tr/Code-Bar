import { invoke } from "@tauri-apps/api/core";
import { openDiff } from "./editorCommands";
import { type ScmEntryGroup, useScmStore } from "../store/scmStore";
import { useSessionStore } from "../store/sessionStore";
import { useEditorStore } from "../store/editorStore";
import { useExplorerStore } from "../store/explorerStore";
import { useWorkbenchStore } from "../store/workbenchStore";

function openScmFileInEditor(sessionId: string, path: string) {
  useEditorStore.getState().openFile(sessionId, path, true);
  useExplorerStore.getState().setSelectedPath(sessionId, path);
  const workbench = useWorkbenchStore.getState();
  workbench.focusSession(sessionId);
  workbench.setSidebarSection("scm");
  workbench.setCenterSurface("editor");
}

export function selectScmFile(sessionId: string, group: ScmEntryGroup, path: string) {
  useScmStore.getState().setSelectedEntry(sessionId, { group, path });
  useScmStore.getState().setDiffOverride(sessionId, null);
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);

  if (group === "untracked") {
    openScmFileInEditor(sessionId, path);
    return;
  }

  if (session && (group === "staged" || group === "unstaged")) {
    invoke("get_git_diff_side", {
      sessionId,
      workdir: session.workdir,
      path,
      mode: group === "staged" ? "staged" : "unstaged",
    }).catch(() => {});
  }

  openDiff(sessionId, path);
}
