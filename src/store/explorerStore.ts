import { create } from "zustand";

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

interface ExplorerStore {
  expandedDirsBySession: Record<string, string[]>;
  selectedPathBySession: Record<string, string | null>;
  childrenBySessionPath: Record<string, ExplorerEntry[]>;
  loadingBySessionPath: Record<string, boolean>;
  errorBySessionPath: Record<string, string | null>;

  setExpandedDirs: (sessionId: string, dirs: string[]) => void;
  toggleDir: (sessionId: string, dir: string) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
  setDirectoryLoading: (sessionId: string, dir: string, loading: boolean) => void;
  setDirectoryEntries: (sessionId: string, dir: string, entries: ExplorerEntry[]) => void;
  setDirectoryError: (sessionId: string, dir: string, error: string | null) => void;
}

function dirKey(sessionId: string, dir: string) {
  return `${sessionId}:${dir}`;
}

export const useExplorerStore = create<ExplorerStore>()((set) => ({
  expandedDirsBySession: {},
  selectedPathBySession: {},
  childrenBySessionPath: {},
  loadingBySessionPath: {},
  errorBySessionPath: {},

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
    set((state) => ({
      childrenBySessionPath: {
        ...state.childrenBySessionPath,
        [dirKey(sessionId, dir)]: entries,
      },
      errorBySessionPath: {
        ...state.errorBySessionPath,
        [dirKey(sessionId, dir)]: null,
      },
      loadingBySessionPath: {
        ...state.loadingBySessionPath,
        [dirKey(sessionId, dir)]: false,
      },
    })),

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
}));
