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

export function collectAncestorDirs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
}

export type ExplorerSelectMode = false | true | "force" | "focusNoScroll";
export type ExplorerSelectSource = "explorer" | "editor" | "editor-tabs" | "scm" | "command";

const suppressedEditorRevealBySession = new Set<string>();

function shouldAutoRevealExplorerPath(
  _sessionId: string,
  _path: string,
  reveal: ExplorerSelectMode,
  source: ExplorerSelectSource,
) {
  if (reveal === "force") return "force" as const;
  if (reveal === false) return false;
  if (source === "explorer") {
    return false;
  }
  if (source === "scm") {
    return "focusNoScroll" as const;
  }
  return reveal;
}

export function selectExplorerPath(sessionId: string, path: string, reveal: ExplorerSelectMode = true, source: ExplorerSelectSource = "explorer") {
  const finalReveal = shouldAutoRevealExplorerPath(sessionId, path, reveal, source);
  const explorerStore = useExplorerStore.getState();
  const currentExpanded = explorerStore.expandedDirsBySession[sessionId] ?? [];
  const ancestors = collectAncestorDirs(path);
  const shouldExpandAncestors = finalReveal === true || finalReveal === "force" || finalReveal === "focusNoScroll";
  if (shouldExpandAncestors) {
    const missing = ancestors.filter((dir) => !currentExpanded.includes(dir));
    if (missing.length > 0) {
      explorerStore.setExpandedDirs(sessionId, [...currentExpanded, ...missing]);
    }
  }
  explorerStore.setSelectedPath(sessionId, path, finalReveal);
}

export function revealExplorerPath(sessionId: string, path: string, reveal: ExplorerSelectMode = true, source: ExplorerSelectSource = "explorer") {
  selectExplorerPath(sessionId, path, reveal, source);
}

export function suppressNextEditorReveal(sessionId: string) {
  suppressedEditorRevealBySession.add(sessionId);
}

export function consumeSuppressedEditorReveal(sessionId: string) {
  if (!suppressedEditorRevealBySession.has(sessionId)) {
    return false;
  }
  suppressedEditorRevealBySession.delete(sessionId);
  return true;
}

export function openFile(sessionId: string, path: string, preview = true, reveal: ExplorerSelectMode = true, source: ExplorerSelectSource = "explorer") {
  if (source === "explorer") {
    suppressNextEditorReveal(sessionId);
  }
  const tabId = useEditorStore.getState().openFile(sessionId, path, preview);
  revealExplorerPath(sessionId, path, reveal, source);
  useWorkbenchStore.getState().showExplorer(sessionId);
  return tabId;
}

export function openDiff(sessionId: string, path: string, reveal: ExplorerSelectMode = true, source: ExplorerSelectSource = "explorer") {
  if (source === "explorer") {
    suppressNextEditorReveal(sessionId);
  }
  const tabId = useEditorStore.getState().openDiff(sessionId, path);
  revealExplorerPath(sessionId, path, reveal, source);
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

export async function reloadVisibleDirectories(sessionId: string) {
  const explorer = useExplorerStore.getState();
  const expandedDirs = explorer.expandedDirsBySession[sessionId] ?? [];
  const dirs = [...new Set(["", ...expandedDirs])];
  await Promise.all(dirs.map((dir) => loadDirectory(sessionId, dir)));
}

export function getVisibleExplorerDirectories(sessionId: string) {
  const explorer = useExplorerStore.getState();
  const expandedDirs = explorer.expandedDirsBySession[sessionId] ?? [];
  return new Set(["", ...expandedDirs]);
}

export function filterVisibleExplorerDirectories(sessionId: string, dirs: string[]) {
  const visibleDirs = getVisibleExplorerDirectories(sessionId);
  return [...new Set(dirs.map((dir) => dir.trim().replace(/^\/+|\/+$/g, "")))].filter((dir) => visibleDirs.has(dir));
}

export async function reloadExplorerDirectories(sessionId: string, dirs: string[]) {
  const visibleDirs = getVisibleExplorerDirectories(sessionId);
  const normalizedDirs = [...new Set(dirs.map((dir) => dir.trim().replace(/^\/+|\/+$/g, "")))];
  const targets = normalizedDirs.filter((dir) => visibleDirs.has(dir));
  const visibleTargets = targets.length > 0 ? targets : [""];
  await Promise.all(visibleTargets.map((dir) => loadDirectory(sessionId, dir)));
}

export function closeTab(tabId: string) {
  useEditorStore.getState().closeTab(tabId);
  useEditorBufferStore.getState().removeBuffer(tabId);
}
