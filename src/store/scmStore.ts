import { create } from "zustand";
import { type DiffFile } from "./sessionStore";

export type ScmStatusKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface ScmStatusEntry {
  path: string;
  kind: ScmStatusKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  oldPath?: string | null;
}

export interface ScmStatusGroups {
  conflicts: ScmStatusEntry[];
  staged: ScmStatusEntry[];
  unstaged: ScmStatusEntry[];
  untracked: ScmStatusEntry[];
}

export type ScmGroupKey = keyof ScmStatusGroups;
export type ScmEntryGroup = "committed" | ScmGroupKey;

export interface ScmSelectedEntry {
  group: ScmEntryGroup;
  path: string;
}

export interface ScmSnapshot {
  files: DiffFile[];
  loadedAt: number | null;
}

interface ScmStore {
  snapshotBySessionId: Record<string, ScmSnapshot>;
  statusBySessionId: Record<string, ScmStatusGroups>;
  selectedPathBySessionId: Record<string, string | null>;
  selectedEntryBySessionId: Record<string, ScmSelectedEntry | null>;
  diffOverrideBySessionId: Record<string, DiffFile | null>;

  setSnapshot: (sessionId: string, files: DiffFile[]) => void;
  setStatus: (sessionId: string, groups: ScmStatusGroups) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
  setSelectedEntry: (sessionId: string, entry: ScmSelectedEntry | null) => void;
  setDiffOverride: (sessionId: string, file: DiffFile | null) => void;
}

export const EMPTY_SCM_GROUPS: ScmStatusGroups = {
  conflicts: [],
  staged: [],
  unstaged: [],
  untracked: [],
};

export const useScmStore = create<ScmStore>()((set) => ({
  snapshotBySessionId: {},
  statusBySessionId: {},
  selectedPathBySessionId: {},
  selectedEntryBySessionId: {},
  diffOverrideBySessionId: {},

  setSnapshot: (sessionId, files) => set((state) => ({
    snapshotBySessionId: {
      ...state.snapshotBySessionId,
      [sessionId]: {
        files,
        loadedAt: Date.now(),
      },
    },
  })),

  setStatus: (sessionId, groups) => set((state) => ({
    statusBySessionId: {
      ...state.statusBySessionId,
      [sessionId]: groups,
    },
  })),

  setSelectedPath: (sessionId, path) => set((state) => ({
    selectedPathBySessionId: {
      ...state.selectedPathBySessionId,
      [sessionId]: path,
    },
  })),

  setSelectedEntry: (sessionId, entry) => set((state) => ({
    selectedEntryBySessionId: {
      ...state.selectedEntryBySessionId,
      [sessionId]: entry,
    },
    selectedPathBySessionId: {
      ...state.selectedPathBySessionId,
      [sessionId]: entry?.path ?? null,
    },
  })),

  setDiffOverride: (sessionId, file) => set((state) => ({
    diffOverrideBySessionId: {
      ...state.diffOverrideBySessionId,
      [sessionId]: file,
    },
  })),
}));
