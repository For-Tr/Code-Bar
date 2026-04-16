import { create } from "zustand";
import { type DiffFile } from "./sessionStore";

export interface ScmSnapshot {
  files: DiffFile[];
  loadedAt: number | null;
}

interface ScmStore {
  snapshotBySessionId: Record<string, ScmSnapshot>;
  selectedPathBySessionId: Record<string, string | null>;

  setSnapshot: (sessionId: string, files: DiffFile[]) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
}

export const useScmStore = create<ScmStore>()((set) => ({
  snapshotBySessionId: {},
  selectedPathBySessionId: {},

  setSnapshot: (sessionId, files) => set((state) => ({
    snapshotBySessionId: {
      ...state.snapshotBySessionId,
      [sessionId]: {
        files,
        loadedAt: Date.now(),
      },
    },
  })),

  setSelectedPath: (sessionId, path) => set((state) => ({
    selectedPathBySessionId: {
      ...state.selectedPathBySessionId,
      [sessionId]: path,
    },
  })),
}));
