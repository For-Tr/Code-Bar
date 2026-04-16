import { create } from "zustand";

interface ExplorerStore {
  expandedDirsBySession: Record<string, string[]>;
  selectedPathBySession: Record<string, string | null>;

  setExpandedDirs: (sessionId: string, dirs: string[]) => void;
  toggleDir: (sessionId: string, dir: string) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
}

export const useExplorerStore = create<ExplorerStore>()((set) => ({
  expandedDirsBySession: {},
  selectedPathBySession: {},

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
}));
