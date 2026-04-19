import { create } from "zustand";

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface ExplorerNode {
  id: string;
  path: string;
  parentPath: string | null;
  name: string;
  kind: "file" | "dir";
}

export interface ExplorerRenamePair {
  oldPath: string;
  newPath: string;
}

export interface ExplorerWatcherEvent {
  eventType: "create" | "delete" | "rename" | "change" | "git" | "batch";
  paths: string[];
  pathKinds?: Record<string, ExplorerEntry["kind"]>;
  renamePairs?: ExplorerRenamePair[];
}

export type ExplorerVisibleRow = {
  type: "file";
  id: string;
  key: string;
  name: string;
  path: string;
  parentPath: string | null;
  depth: number;
  entry: ExplorerEntry;
} | {
  type: "dir";
  id: string;
  key: string;
  name: string;
  path: string;
  parentPath: string | null;
  depth: number;
  loading: boolean;
  error: string | null;
};

export interface ExplorerViewModel {
  expandedDirs: string[];
  selectedPath: string | null;
  rootLoading: boolean;
  rootError: string | null;
  hasRootSnapshot: boolean;
  visibleRows: ExplorerVisibleRow[];
}

export interface ExplorerNodeState {
  expandedDirsBySession: Record<string, string[]>;
  selectedPathBySession: Record<string, string | null>;
}

export interface ExplorerDirectoryCache {
  childrenBySessionPath: Record<string, ExplorerEntry[]>;
  loadingBySessionPath: Record<string, boolean>;
  errorBySessionPath: Record<string, string | null>;
}

export interface ExplorerNodeGraph {
  nodesBySessionPath: Record<string, ExplorerNode>;
  childPathsBySessionDir: Record<string, string[]>;
}

interface ExplorerStore extends ExplorerNodeState, ExplorerDirectoryCache, ExplorerNodeGraph {
  touchedPathsBySession: Record<string, string[]>;

  setExpandedDirs: (sessionId: string, dirs: string[]) => void;
  toggleDir: (sessionId: string, dir: string) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
  setDirectoryLoading: (sessionId: string, dir: string, loading: boolean) => void;
  setDirectoryEntries: (sessionId: string, dir: string, entries: ExplorerEntry[]) => void;
  setDirectoryError: (sessionId: string, dir: string, error: string | null) => void;
  invalidateSessionDirectories: (sessionId: string, dirs?: string[]) => void;
  markTouchedPaths: (sessionId: string, paths: string[]) => void;
  clearTouchedPaths: (sessionId: string) => void;
  applyWatcherEvent: (sessionId: string, event: ExplorerWatcherEvent) => boolean;
}

function dirKey(sessionId: string, dir: string) {
  return `${sessionId}:${dir}`;
}

function matchesSessionDir(key: string, sessionId: string, dirs: string[]) {
  if (!key.startsWith(`${sessionId}:`)) return false;
  if (dirs.length === 0) return true;
  const path = key.slice(sessionId.length + 1);
  return dirs.includes(path);
}

function normalizePath(path: string) {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function parentDirForPath(path: string) {
  return normalizePath(path.split("/").slice(0, -1).join("/"));
}

function baseName(path: string) {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function sortEntries(entries: ExplorerEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "dir" ? -1 : 1;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

function buildEntry(path: string, kind: ExplorerEntry["kind"]): ExplorerEntry {
  const normalized = normalizePath(path);
  return {
    name: baseName(normalized),
    path: normalized,
    kind,
  };
}

function replacePathPrefix(path: string, oldPath: string, newPath: string) {
  const normalizedPath = normalizePath(path);
  const normalizedOldPath = normalizePath(oldPath);
  const normalizedNewPath = normalizePath(newPath);
  if (normalizedPath === normalizedOldPath) {
    return normalizedNewPath;
  }
  if (normalizedPath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`;
  }
  return normalizedPath;
}

function buildNodeGraph(cache: ExplorerDirectoryCache, sessionId: string): ExplorerNodeGraph {
  const nodesBySessionPath: Record<string, ExplorerNode> = {};
  const childPathsBySessionDir: Record<string, string[]> = {};

  Object.entries(cache.childrenBySessionPath).forEach(([key, entries]) => {
    if (!key.startsWith(`${sessionId}:`)) return;
    const dir = key.slice(sessionId.length + 1);
    childPathsBySessionDir[key] = entries.map((entry) => entry.path);
    entries.forEach((entry) => {
      nodesBySessionPath[dirKey(sessionId, entry.path)] = {
        id: `${sessionId}:${entry.path}`,
        path: entry.path,
        parentPath: dir || null,
        name: entry.name,
        kind: entry.kind,
      };
    });
  });

  return { nodesBySessionPath, childPathsBySessionDir };
}

function replaceSessionGraph(
  state: ExplorerStore,
  sessionId: string,
  nextGraph: ExplorerNodeGraph,
) {
  return {
    nodesBySessionPath: Object.fromEntries([
      ...Object.entries(state.nodesBySessionPath).filter(([key]) => !key.startsWith(`${sessionId}:`)),
      ...Object.entries(nextGraph.nodesBySessionPath),
    ]),
    childPathsBySessionDir: Object.fromEntries([
      ...Object.entries(state.childPathsBySessionDir).filter(([key]) => !key.startsWith(`${sessionId}:`)),
      ...Object.entries(nextGraph.childPathsBySessionDir),
    ]),
  };
}

function patchSessionGraphCreate(
  state: ExplorerStore,
  sessionId: string,
  path: string,
  kind: ExplorerEntry["kind"],
) {
  const parentDir = parentDirForPath(path);
  const normalizedPath = normalizePath(path);
  return {
    nodesBySessionPath: {
      ...state.nodesBySessionPath,
      [dirKey(sessionId, normalizedPath)]: {
        id: `${sessionId}:${normalizedPath}`,
        path: normalizedPath,
        parentPath: parentDir || null,
        name: baseName(normalizedPath),
        kind,
      },
    },
    childPathsBySessionDir: {
      ...state.childPathsBySessionDir,
      [dirKey(sessionId, parentDir)]: (state.childPathsBySessionDir[dirKey(sessionId, parentDir)] ?? EMPTY_DIRS).includes(normalizedPath)
        ? state.childPathsBySessionDir[dirKey(sessionId, parentDir)] ?? EMPTY_DIRS
        : [...(state.childPathsBySessionDir[dirKey(sessionId, parentDir)] ?? EMPTY_DIRS), normalizedPath],
    },
  };
}

function patchSessionGraphDelete(
  state: ExplorerStore,
  sessionId: string,
  path: string,
  kind: ExplorerEntry["kind"],
) {
  const normalizedPath = normalizePath(path);
  const parentDir = parentDirForPath(normalizedPath);
  const nextNodesBySessionPath = Object.fromEntries(
    Object.entries(state.nodesBySessionPath).filter(([key]) => {
      const sessionPrefix = `${sessionId}:`;
      if (!key.startsWith(sessionPrefix)) return true;
      const nodePath = key.slice(sessionPrefix.length);
      return nodePath !== normalizedPath && !(kind === "dir" && nodePath.startsWith(`${normalizedPath}/`));
    }),
  );
  const nextChildPathsBySessionDir = Object.fromEntries(
    Object.entries(state.childPathsBySessionDir).filter(([key, childPaths]) => {
      const sessionPrefix = `${sessionId}:`;
      if (!key.startsWith(sessionPrefix)) return true;
      const dir = key.slice(sessionPrefix.length);
      if (dir === normalizedPath || (kind === "dir" && dir.startsWith(`${normalizedPath}/`))) {
        return false;
      }
      return true;
    }).map(([key, childPaths]) => {
      const nextChildPaths = childPaths.filter((childPath) => childPath !== normalizedPath && !(kind === "dir" && childPath.startsWith(`${normalizedPath}/`)));
      return [key, nextChildPaths];
    }),
  );
  return {
    nodesBySessionPath: nextNodesBySessionPath,
    childPathsBySessionDir: {
      ...nextChildPathsBySessionDir,
      [dirKey(sessionId, parentDir)]: nextChildPathsBySessionDir[dirKey(sessionId, parentDir)] ?? EMPTY_DIRS,
    },
  };
}

function patchSessionGraphRename(
  state: ExplorerStore,
  sessionId: string,
  oldPath: string,
  newPath: string,
  kind: ExplorerEntry["kind"],
) {
  const normalizedOldPath = normalizePath(oldPath);
  const normalizedNewPath = normalizePath(newPath);
  const oldParentDir = parentDirForPath(normalizedOldPath);
  const newParentDir = parentDirForPath(normalizedNewPath);

  const nextNodesBySessionPath: Record<string, ExplorerNode> = {};
  Object.entries(state.nodesBySessionPath).forEach(([key, node]) => {
    const sessionPrefix = `${sessionId}:`;
    if (!key.startsWith(sessionPrefix)) {
      nextNodesBySessionPath[key] = node;
      return;
    }

    const nodePath = key.slice(sessionPrefix.length);
    if (nodePath === normalizedOldPath || nodePath.startsWith(`${normalizedOldPath}/`)) {
      const nextPath = replacePathPrefix(nodePath, normalizedOldPath, normalizedNewPath);
      nextNodesBySessionPath[dirKey(sessionId, nextPath)] = {
        ...node,
        id: `${sessionId}:${nextPath}`,
        path: nextPath,
        parentPath: nodePath === normalizedOldPath
          ? (newParentDir || null)
          : parentDirForPath(nextPath) || null,
        name: baseName(nextPath),
        kind: nodePath === normalizedOldPath ? kind : node.kind,
      };
      return;
    }

    nextNodesBySessionPath[key] = node;
  });

  if (!nextNodesBySessionPath[dirKey(sessionId, normalizedNewPath)]) {
    nextNodesBySessionPath[dirKey(sessionId, normalizedNewPath)] = {
      id: `${sessionId}:${normalizedNewPath}`,
      path: normalizedNewPath,
      parentPath: newParentDir || null,
      name: baseName(normalizedNewPath),
      kind,
    };
  }

  const nextChildPathsBySessionDir: Record<string, string[]> = {};
  Object.entries(state.childPathsBySessionDir).forEach(([key, childPaths]) => {
    const sessionPrefix = `${sessionId}:`;
    if (!key.startsWith(sessionPrefix)) {
      nextChildPathsBySessionDir[key] = childPaths;
      return;
    }

    const dir = key.slice(sessionPrefix.length);
    const nextDir = replacePathPrefix(dir, normalizedOldPath, normalizedNewPath);
    const nextKey = dirKey(sessionId, nextDir);
    nextChildPathsBySessionDir[nextKey] = childPaths.map((childPath) => replacePathPrefix(childPath, normalizedOldPath, normalizedNewPath));
  });

  const oldParentKey = dirKey(sessionId, oldParentDir);
  if (nextChildPathsBySessionDir[oldParentKey]) {
    nextChildPathsBySessionDir[oldParentKey] = nextChildPathsBySessionDir[oldParentKey].filter((childPath) => childPath !== normalizedOldPath);
  }

  const newParentKey = dirKey(sessionId, newParentDir);
  const nextNewParentChildren = nextChildPathsBySessionDir[newParentKey] ?? [];
  if (!nextNewParentChildren.includes(normalizedNewPath)) {
    nextChildPathsBySessionDir[newParentKey] = [...nextNewParentChildren, normalizedNewPath];
  }

  return {
    nodesBySessionPath: nextNodesBySessionPath,
    childPathsBySessionDir: nextChildPathsBySessionDir,
  };
}

function buildVisibleRows(state: ExplorerStore, sessionId: string, expandedDirSet: Set<string>): ExplorerVisibleRow[] {
  const rows: ExplorerVisibleRow[] = [];
  const getLoading = (dir: string) => state.loadingBySessionPath[dirKey(sessionId, dir)] ?? false;
  const getError = (dir: string) => state.errorBySessionPath[dirKey(sessionId, dir)] ?? null;
  const getEntries = (dir: string) => state.childrenBySessionPath[dirKey(sessionId, dir)] ?? EMPTY_ENTRIES;
  const getChildPaths = (dir: string) => state.childPathsBySessionDir[dirKey(sessionId, dir)] ?? EMPTY_DIRS;

  const walk = (dir: string, depth: number) => {
    const entriesByPath = new Map(getEntries(dir).map((entry) => [entry.path, entry]));
    getChildPaths(dir).forEach((childPath) => {
      const node = state.nodesBySessionPath[dirKey(sessionId, childPath)];
      const entry = entriesByPath.get(childPath);
      if (!node || !entry) return;

      if (node.kind === "dir") {
        rows.push({
          type: "dir",
          id: node.id,
          key: `dir:${node.id}`,
          name: node.name,
          path: node.path,
          parentPath: node.parentPath,
          depth,
          loading: getLoading(node.path),
          error: getError(node.path),
        });
        if (expandedDirSet.has(node.path)) {
          walk(node.path, depth + 1);
        }
        return;
      }

      rows.push({
        type: "file",
        id: node.id,
        key: `file:${node.id}`,
        name: node.name,
        path: node.path,
        parentPath: node.parentPath,
        depth,
        entry,
      });
    });
  };

  walk("", 0);
  return rows;
}

export function hasExplorerDirectorySnapshot(state: ExplorerDirectoryCache, sessionId: string, dir = "") {
  return dirKey(sessionId, dir) in state.childrenBySessionPath;
}

export function getExplorerDirectoryLoading(state: ExplorerDirectoryCache, sessionId: string, dir = "") {
  return state.loadingBySessionPath[dirKey(sessionId, dir)] ?? false;
}

export function getExplorerDirectoryError(state: ExplorerDirectoryCache, sessionId: string, dir = "") {
  return state.errorBySessionPath[dirKey(sessionId, dir)] ?? null;
}

export function selectExplorerNodeState(state: ExplorerNodeState, sessionId: string) {
  return {
    expandedDirs: state.expandedDirsBySession[sessionId] ?? EMPTY_DIRS,
    selectedPath: state.selectedPathBySession[sessionId] ?? null,
  };
}

export function selectExplorerDirectoryCache(state: ExplorerDirectoryCache, sessionId: string) {
  return {
    rootLoading: getExplorerDirectoryLoading(state, sessionId, ""),
    rootError: getExplorerDirectoryError(state, sessionId, ""),
    hasRootSnapshot: hasExplorerDirectorySnapshot(state, sessionId, ""),
  };
}

export function selectExplorerViewModel(state: ExplorerStore, sessionId: string): ExplorerViewModel {
  const nodeState = selectExplorerNodeState(state, sessionId);
  const cacheState = selectExplorerDirectoryCache(state, sessionId);
  return {
    ...nodeState,
    ...cacheState,
    visibleRows: buildVisibleRows(state, sessionId, new Set(nodeState.expandedDirs)),
  };
}

const EMPTY_DIRS: string[] = [];
const EMPTY_ENTRIES: ExplorerEntry[] = [];

function hasSnapshot(childrenBySessionPath: Record<string, ExplorerEntry[]>, sessionId: string, dir: string) {
  return dirKey(sessionId, dir) in childrenBySessionPath;
}

function getEntries(childrenBySessionPath: Record<string, ExplorerEntry[]>, sessionId: string, dir: string) {
  return childrenBySessionPath[dirKey(sessionId, dir)] ?? EMPTY_ENTRIES;
}

function inferKind(state: ExplorerStore, sessionId: string, path: string, pathKinds?: Record<string, ExplorerEntry["kind"]>) {
  return pathKinds?.[path]
    ?? state.nodesBySessionPath[dirKey(sessionId, path)]?.kind;
}

function patchCreate(
  childrenBySessionPath: Record<string, ExplorerEntry[]>,
  sessionId: string,
  path: string,
  kind: ExplorerEntry["kind"],
) {
  const parentDir = parentDirForPath(path);
  if (!hasSnapshot(childrenBySessionPath, sessionId, parentDir)) {
    return { nextChildrenBySessionPath: childrenBySessionPath, changed: false };
  }

  const parentEntries = getEntries(childrenBySessionPath, sessionId, parentDir);
  const nextEntries = sortEntries([
    ...parentEntries.filter((entry) => entry.path !== path),
    buildEntry(path, kind),
  ]);

  return {
    nextChildrenBySessionPath: {
      ...childrenBySessionPath,
      [dirKey(sessionId, parentDir)]: nextEntries,
    },
    changed: true,
  };
}

function patchDelete(
  childrenBySessionPath: Record<string, ExplorerEntry[]>,
  sessionId: string,
  path: string,
  kind: ExplorerEntry["kind"],
) {
  const parentDir = parentDirForPath(path);
  let nextChildrenBySessionPath = childrenBySessionPath;
  let changed = false;

  if (hasSnapshot(nextChildrenBySessionPath, sessionId, parentDir)) {
    const parentEntries = getEntries(nextChildrenBySessionPath, sessionId, parentDir);
    const filteredEntries = parentEntries.filter((entry) => entry.path !== path);
    if (filteredEntries.length !== parentEntries.length) {
      nextChildrenBySessionPath = {
        ...nextChildrenBySessionPath,
        [dirKey(sessionId, parentDir)]: filteredEntries,
      };
      changed = true;
    }
  }

  if (kind === "dir") {
    const filteredChildrenBySessionPath = Object.fromEntries(
      Object.entries(nextChildrenBySessionPath).filter(([key]) => {
        if (!key.startsWith(`${sessionId}:`)) return true;
        const dir = key.slice(sessionId.length + 1);
        return dir !== path && !dir.startsWith(`${path}/`);
      }),
    );
    if (Object.keys(filteredChildrenBySessionPath).length !== Object.keys(nextChildrenBySessionPath).length) {
      nextChildrenBySessionPath = filteredChildrenBySessionPath;
      changed = true;
    }
  }

  return { nextChildrenBySessionPath, changed };
}

function patchRename(
  childrenBySessionPath: Record<string, ExplorerEntry[]>,
  sessionId: string,
  oldPath: string,
  newPath: string,
  kind: ExplorerEntry["kind"],
) {
  const oldParentDir = parentDirForPath(oldPath);
  const newParentDir = parentDirForPath(newPath);
  let nextChildrenBySessionPath = childrenBySessionPath;
  let changed = false;

  if (kind === "dir") {
    const renamedChildrenBySessionPath: Record<string, ExplorerEntry[]> = {};
    Object.entries(nextChildrenBySessionPath).forEach(([key, entries]) => {
      if (!key.startsWith(`${sessionId}:`)) {
        renamedChildrenBySessionPath[key] = entries;
        return;
      }
      const dir = key.slice(sessionId.length + 1);
      const nextDir = replacePathPrefix(dir, oldPath, newPath);
      const nextKey = dirKey(sessionId, nextDir);
      renamedChildrenBySessionPath[nextKey] = entries.map((entry) => {
        const nextEntryPath = replacePathPrefix(entry.path, oldPath, newPath);
        if (nextEntryPath === entry.path) return entry;
        changed = true;
        return {
          ...entry,
          path: nextEntryPath,
          name: baseName(nextEntryPath),
        };
      });
      if (nextKey !== key) {
        changed = true;
      }
    });
    nextChildrenBySessionPath = renamedChildrenBySessionPath;
  }

  if (hasSnapshot(nextChildrenBySessionPath, sessionId, oldParentDir)) {
    const oldParentEntries = getEntries(nextChildrenBySessionPath, sessionId, oldParentDir);
    const filteredOldEntries = oldParentEntries.filter((entry) => entry.path !== oldPath);
    if (filteredOldEntries.length !== oldParentEntries.length || oldParentDir === newParentDir) {
      const replacementEntries = oldParentDir === newParentDir
        ? sortEntries([...filteredOldEntries, buildEntry(newPath, kind)])
        : filteredOldEntries;
      nextChildrenBySessionPath = {
        ...nextChildrenBySessionPath,
        [dirKey(sessionId, oldParentDir)]: replacementEntries,
      };
      changed = true;
    }
  }

  if (oldParentDir !== newParentDir && hasSnapshot(nextChildrenBySessionPath, sessionId, newParentDir)) {
    const newParentEntries = getEntries(nextChildrenBySessionPath, sessionId, newParentDir);
    nextChildrenBySessionPath = {
      ...nextChildrenBySessionPath,
      [dirKey(sessionId, newParentDir)]: sortEntries([
        ...newParentEntries.filter((entry) => entry.path !== newPath),
        buildEntry(newPath, kind),
      ]),
    };
    changed = true;
  }

  return { nextChildrenBySessionPath, changed };
}

export const useExplorerStore = create<ExplorerStore>()((set, get) => ({
  expandedDirsBySession: {},
  selectedPathBySession: {},
  childrenBySessionPath: {},
  loadingBySessionPath: {},
  errorBySessionPath: {},
  nodesBySessionPath: {},
  childPathsBySessionDir: {},
  touchedPathsBySession: {},

  setExpandedDirs: (sessionId, dirs) =>
    set((state) => {
      const nextDirs = [...new Set(dirs)].sort();
      const currentDirs = state.expandedDirsBySession[sessionId] ?? [];
      if (currentDirs.length === nextDirs.length && currentDirs.every((value, index) => value === nextDirs[index])) {
        return {};
      }
      return {
        expandedDirsBySession: {
          ...state.expandedDirsBySession,
          [sessionId]: nextDirs,
        },
      };
    }),

  toggleDir: (sessionId, dir) =>
    set((state) => {
      const current = new Set(state.expandedDirsBySession[sessionId] ?? []);
      if (current.has(dir)) {
        current.delete(dir);
      } else {
        current.add(dir);
      }
      const nextDirs = [...current].sort();
      const currentDirs = state.expandedDirsBySession[sessionId] ?? [];
      if (currentDirs.length === nextDirs.length && currentDirs.every((value, index) => value === nextDirs[index])) {
        return {};
      }
      return {
        expandedDirsBySession: {
          ...state.expandedDirsBySession,
          [sessionId]: nextDirs,
        },
      };
    }),

  setSelectedPath: (sessionId, path) =>
    set((state) => {
      if ((state.selectedPathBySession[sessionId] ?? null) === path) {
        return {};
      }
      return {
        selectedPathBySession: {
          ...state.selectedPathBySession,
          [sessionId]: path,
        },
      };
    }),

  setDirectoryLoading: (sessionId, dir, loading) =>
    set((state) => ({
      loadingBySessionPath: {
        ...state.loadingBySessionPath,
        [dirKey(sessionId, dir)]: loading,
      },
    })),

  setDirectoryEntries: (sessionId, dir, entries) =>
    set((state) => {
      const nextChildrenBySessionPath = {
        ...state.childrenBySessionPath,
        [dirKey(sessionId, dir)]: sortEntries(entries),
      };
      const nextGraph = buildNodeGraph({
        childrenBySessionPath: nextChildrenBySessionPath,
        loadingBySessionPath: state.loadingBySessionPath,
        errorBySessionPath: state.errorBySessionPath,
      }, sessionId);
      return {
        childrenBySessionPath: nextChildrenBySessionPath,
        errorBySessionPath: {
          ...state.errorBySessionPath,
          [dirKey(sessionId, dir)]: null,
        },
        loadingBySessionPath: {
          ...state.loadingBySessionPath,
          [dirKey(sessionId, dir)]: false,
        },
        ...replaceSessionGraph(state, sessionId, nextGraph),
      };
    }),

  setDirectoryError: (sessionId, dir, error) =>
    set((state) => ({
      errorBySessionPath: {
        ...state.errorBySessionPath,
        [dirKey(sessionId, dir)]: error,
      },
      loadingBySessionPath: {
        ...state.loadingBySessionPath,
        [dirKey(sessionId, dir)]: false,
      },
    })),

  invalidateSessionDirectories: (sessionId, dirs = []) =>
    set((state) => {
      const nextChildrenBySessionPath = Object.fromEntries(
        Object.entries(state.childrenBySessionPath).filter(([key]) => !matchesSessionDir(key, sessionId, dirs)),
      );
      const nextGraph = buildNodeGraph({
        childrenBySessionPath: nextChildrenBySessionPath,
        loadingBySessionPath: state.loadingBySessionPath,
        errorBySessionPath: state.errorBySessionPath,
      }, sessionId);
      return {
        childrenBySessionPath: nextChildrenBySessionPath,
        loadingBySessionPath: Object.fromEntries(
          Object.entries(state.loadingBySessionPath).filter(([key]) => !matchesSessionDir(key, sessionId, dirs)),
        ),
        errorBySessionPath: Object.fromEntries(
          Object.entries(state.errorBySessionPath).filter(([key]) => !matchesSessionDir(key, sessionId, dirs)),
        ),
        ...replaceSessionGraph(state, sessionId, nextGraph),
      };
    }),

  markTouchedPaths: (sessionId, paths) =>
    set((state) => ({
      touchedPathsBySession: {
        ...state.touchedPathsBySession,
        [sessionId]: [...new Set([...(state.touchedPathsBySession[sessionId] ?? EMPTY_DIRS), ...paths])],
      },
    })),

  clearTouchedPaths: (sessionId) =>
    set((state) => ({
      touchedPathsBySession: {
        ...state.touchedPathsBySession,
        [sessionId]: EMPTY_DIRS,
      },
    })),

  applyWatcherEvent: (sessionId, event) => {
    if (event.eventType === "change") {
      const touched = event.paths
        .map((path) => normalizePath(path))
        .filter((path) => !!get().nodesBySessionPath[dirKey(sessionId, path)]);
      if (touched.length > 0) {
        get().markTouchedPaths(sessionId, touched);
        return true;
      }
      return false;
    }

    if (event.eventType === "git" || event.eventType === "batch") {
      return false;
    }

    const state = get();
    let nextChildrenBySessionPath = state.childrenBySessionPath;
    let changed = false;

    let graphPatch: Pick<ExplorerNodeGraph, "nodesBySessionPath" | "childPathsBySessionDir"> | null = null;

    if (event.eventType === "rename" && event.renamePairs && event.renamePairs.length > 0) {
      event.renamePairs.forEach(({ oldPath, newPath }) => {
        const normalizedOldPath = normalizePath(oldPath);
        const normalizedNewPath = normalizePath(newPath);
        const kind = inferKind(state, sessionId, normalizedNewPath, event.pathKinds)
          ?? inferKind(state, sessionId, normalizedOldPath, event.pathKinds)
          ?? "file";
        const result = patchRename(nextChildrenBySessionPath, sessionId, normalizedOldPath, normalizedNewPath, kind);
        nextChildrenBySessionPath = result.nextChildrenBySessionPath;
        if (result.changed) {
          graphPatch = patchSessionGraphRename(graphPatch ? { ...state, ...graphPatch } as ExplorerStore : state, sessionId, normalizedOldPath, normalizedNewPath, kind);
        }
        changed = changed || result.changed;
      });
    } else if (event.eventType === "create") {
      event.paths.forEach((path) => {
        const normalizedPath = normalizePath(path);
        const kind = inferKind(state, sessionId, normalizedPath, event.pathKinds) ?? "file";
        const result = patchCreate(nextChildrenBySessionPath, sessionId, normalizedPath, kind);
        nextChildrenBySessionPath = result.nextChildrenBySessionPath;
        if (result.changed) {
          graphPatch = patchSessionGraphCreate(graphPatch ? { ...state, ...graphPatch } as ExplorerStore : state, sessionId, normalizedPath, kind);
        }
        changed = changed || result.changed;
      });
    } else if (event.eventType === "delete") {
      event.paths.forEach((path) => {
        const normalizedPath = normalizePath(path);
        const kind = inferKind(state, sessionId, normalizedPath, event.pathKinds) ?? "file";
        const result = patchDelete(nextChildrenBySessionPath, sessionId, normalizedPath, kind);
        nextChildrenBySessionPath = result.nextChildrenBySessionPath;
        if (result.changed) {
          graphPatch = patchSessionGraphDelete(graphPatch ? { ...state, ...graphPatch } as ExplorerStore : state, sessionId, normalizedPath, kind);
        }
        changed = changed || result.changed;
      });
    }

    if (!changed) {
      return false;
    }

    if (!graphPatch) {
      const nextGraph = buildNodeGraph({
        childrenBySessionPath: nextChildrenBySessionPath,
        loadingBySessionPath: state.loadingBySessionPath,
        errorBySessionPath: state.errorBySessionPath,
      }, sessionId);
      graphPatch = replaceSessionGraph(state, sessionId, nextGraph);
    }

    set(() => ({
      childrenBySessionPath: nextChildrenBySessionPath,
      ...graphPatch,
    }));

    return true;
  },
}));
