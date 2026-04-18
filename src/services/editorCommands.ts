import { invoke } from "@tauri-apps/api/core";
import { useEditorBufferStore } from "../store/editorBufferStore";
import { useEditorStore } from "../store/editorStore";
import { type ExplorerEntry, useExplorerStore } from "../store/explorerStore";
import { useWorkbenchStore } from "../store/workbenchStore";

interface SessionFileReadResult {
  content: string;
  versionToken: string | null;
  isBinary: boolean;
  missing: boolean;
}

interface SessionFileWriteResult {
  versionToken: string | null;
}

interface SessionDirectoryListResult {
  path: string;
  entries: ExplorerEntry[];
}

function collectAncestorDirs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
}

export function openFile(sessionId: string, path: string, preview = true) {
  const tabId = useEditorStore.getState().openFile(sessionId, path, preview);
  const explorerStore = useExplorerStore.getState();
  const currentExpanded = explorerStore.expandedDirsBySession[sessionId] ?? [];
  const ancestors = collectAncestorDirs(path);
  const missing = ancestors.filter((dir) => !currentExpanded.includes(dir));
  if (missing.length > 0) {
    explorerStore.setExpandedDirs(sessionId, [...currentExpanded, ...missing]);
  }
  explorerStore.setSelectedPath(sessionId, path);
  useWorkbenchStore.getState().showExplorer(sessionId);
  return tabId;
}

export function openDiff(sessionId: string, path: string) {
  const tabId = useEditorStore.getState().openDiff(sessionId, path);
  useExplorerStore.getState().setSelectedPath(sessionId, path);
  useWorkbenchStore.getState().showScm(sessionId);
  return tabId;
}

export async function loadFile(tabId: string) {
  const tab = useEditorStore.getState().tabsById[tabId];
  if (!tab || tab.viewMode !== "code") return;
  const buffer = useEditorBufferStore.getState().buffersByTabId[tabId];
  if (buffer?.loaded || buffer?.loading) return;

  useEditorBufferStore.getState().patchBuffer(tabId, { loading: true, error: null });
  try {
    const payload = await invoke<SessionFileReadResult>("read_session_file", {
      sessionId: tab.sessionId,
      relativePath: tab.path,
    });
    useEditorBufferStore.getState().patchBuffer(tabId, {
      loading: false,
      loaded: true,
      content: payload.content,
      originalContent: payload.content,
      versionToken: payload.versionToken,
      dirty: false,
      error: null,
      isBinary: payload.isBinary,
      missing: payload.missing,
    });
  } catch (error) {
    useEditorBufferStore.getState().patchBuffer(tabId, {
      loading: false,
      loaded: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function saveTab(tabId: string) {
  const tab = useEditorStore.getState().tabsById[tabId];
  const buffer = useEditorBufferStore.getState().buffersByTabId[tabId];
  if (!tab || tab.viewMode !== "code" || !buffer || !buffer.dirty || buffer.saving) return;

  useEditorBufferStore.getState().patchBuffer(tabId, { saving: true, error: null });
  try {
    const payload = await invoke<SessionFileWriteResult>("write_session_file", {
      sessionId: tab.sessionId,
      relativePath: tab.path,
      content: buffer.content,
      expectedVersionToken: buffer.versionToken,
    });
    useEditorBufferStore.getState().markSaved(tabId, buffer.content, payload.versionToken);
  } catch (error) {
    useEditorBufferStore.getState().patchBuffer(tabId, {
      saving: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadDirectory(sessionId: string, dir = "") {
  const store = useExplorerStore.getState();
  store.setDirectoryLoading(sessionId, dir, true);
  try {
    const payload = await invoke<SessionDirectoryListResult>("list_session_directory", {
      sessionId,
      relativePath: dir,
    });
    store.setDirectoryEntries(sessionId, dir, payload.entries);
    return payload.entries;
  } catch (error) {
    store.setDirectoryError(sessionId, dir, error instanceof Error ? error.message : String(error));
    return [];
  }
}

export function closeTab(tabId: string) {
  useEditorStore.getState().closeTab(tabId);
  useEditorBufferStore.getState().removeBuffer(tabId);
}
