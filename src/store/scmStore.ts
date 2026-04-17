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
export type ScmActionMode = "staged" | "unstaged" | "conflicts";

export interface ScmSelectedEntry {
  group: ScmEntryGroup;
  path: string;
}

export interface ScmSnapshot {
  files: DiffFile[];
  loadedAt: number | null;
}

export interface ScmConflictVersion {
  label: "base" | "ours" | "theirs" | "working";
  content: string;
  isBinary: boolean;
  missing: boolean;
}

export interface ScmConflictPayload {
  path: string;
  versions: ScmConflictVersion[];
}

interface ScmStore {
  snapshotBySessionId: Record<string, ScmSnapshot>;
  statusBySessionId: Record<string, ScmStatusGroups>;
  selectedPathBySessionId: Record<string, string | null>;
  selectedEntryBySessionId: Record<string, ScmSelectedEntry | null>;
  diffOverrideBySessionId: Record<string, DiffFile | null>;
  commitMessageBySessionId: Record<string, string>;
  actionPendingBySessionId: Record<string, boolean>;
  actionErrorBySessionId: Record<string, string | null>;
  conflictBySessionId: Record<string, ScmConflictPayload | null>;

  setSnapshot: (sessionId: string, files: DiffFile[]) => void;
  setStatus: (sessionId: string, groups: ScmStatusGroups) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
  setSelectedEntry: (sessionId: string, entry: ScmSelectedEntry | null) => void;
  setDiffOverride: (sessionId: string, file: DiffFile | null) => void;
  setCommitMessage: (sessionId: string, message: string) => void;
  setActionPending: (sessionId: string, pending: boolean) => void;
  setActionError: (sessionId: string, error: string | null) => void;
  setConflictPayload: (sessionId: string, payload: ScmConflictPayload | null) => void;
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
  commitMessageBySessionId: {},
  actionPendingBySessionId: {},
  actionErrorBySessionId: {},
  conflictBySessionId: {},

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

  setCommitMessage: (sessionId, message) => set((state) => ({
    commitMessageBySessionId: {
      ...state.commitMessageBySessionId,
      [sessionId]: message,
    },
  })),

  setActionPending: (sessionId, pending) => set((state) => ({
    actionPendingBySessionId: {
      ...state.actionPendingBySessionId,
      [sessionId]: pending,
    },
  })),

  setActionError: (sessionId, error) => set((state) => ({
    actionErrorBySessionId: {
      ...state.actionErrorBySessionId,
      [sessionId]: error,
    },
  })),

  setConflictPayload: (sessionId, payload) => set((state) => ({
    conflictBySessionId: {
      ...state.conflictBySessionId,
      [sessionId]: payload,
    },
  })),
}));
