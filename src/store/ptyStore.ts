import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { buildRunnerPtyId, buildTerminalPtyId } from "../services/ptyIdentity";
import { mirroredPersistStorage } from "./persistStorage";
import type { ClaudeSession } from "./sessionStore";
import type { SplitWidgetTerminalTab } from "./settingsStore";

export type PtyKind = "runner" | "terminal" | "ephemeral";
export type PtyCwdMode = "sessionWorktree" | "repoPath" | "customPath";
export type PtyRuntimeStatus = "idle" | "starting" | "running" | "waiting" | "error" | "exited";

export interface PtyDescriptor {
  ptyId: string;
  sessionId: string;
  workspaceId: string;
  kind: PtyKind;
  title: string;
  cwdMode: PtyCwdMode;
  cwdPath?: string;
  pinned: boolean;
  createdAt: number;
  widgetTabKey?: string;
}

export interface PtyRuntimeSnapshot {
  ptyId: string;
  sessionId?: string;
  kind?: PtyKind;
  status: PtyRuntimeStatus;
  lastActiveAt: number;
  lastDetachedAt?: number;
  lastCols?: number;
  lastRows?: number;
  attachedViewIds: string[];
  visibleViewIds: string[];
  error?: string;
  live: boolean;
  evictable: boolean;
  protectedReason?: string;
}

export interface BackendPtySessionInfo {
  ptyId: string;
  sessionId?: string | null;
  kind: string;
  runnerType: string;
  workdir: string;
  createdAtMs: number;
  lastActiveAtMs: number;
  status: string;
}

interface PtyStore {
  descriptors: PtyDescriptor[];
  runtimeById: Record<string, PtyRuntimeSnapshot>;

  syncWithSessions: (sessions: ClaudeSession[], terminalTabs: SplitWidgetTerminalTab[]) => void;
  updateDescriptor: (ptyId: string, patch: Partial<Omit<PtyDescriptor, "ptyId" | "sessionId" | "workspaceId" | "kind" | "createdAt">>) => void;
  togglePinned: (ptyId: string) => void;
  attachView: (ptyId: string, viewId: string) => void;
  detachView: (ptyId: string, viewId: string) => void;
  setViewVisible: (ptyId: string, viewId: string, visible: boolean) => void;
  setRuntimeStatus: (ptyId: string, status: PtyRuntimeStatus, extra?: Partial<PtyRuntimeSnapshot>) => void;
  touchRuntime: (ptyId: string, patch?: Partial<PtyRuntimeSnapshot>) => void;
  markRuntimeExited: (ptyId: string, error?: string) => void;
  setRuntimeSize: (ptyId: string, cols: number, rows: number) => void;
  syncLiveRuntimes: (entries: BackendPtySessionInfo[]) => void;
  removeSessionDescriptors: (sessionId: string) => void;
  removeTerminalDescriptorsByTabKey: (tabKey: string) => void;
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeKind(kind: string): PtyKind {
  if (kind === "runner" || kind === "terminal") return kind;
  return "ephemeral";
}

function ensureRuntimeSnapshot(
  current: PtyRuntimeSnapshot | undefined,
  ptyId: string,
  patch?: Partial<PtyRuntimeSnapshot>
): PtyRuntimeSnapshot {
  return {
    ptyId,
    status: "idle",
    lastActiveAt: Date.now(),
    attachedViewIds: current?.attachedViewIds ?? [],
    visibleViewIds: current?.visibleViewIds ?? [],
    live: current?.live ?? false,
    evictable: current?.evictable ?? false,
    ...current,
    ...(patch ?? {}),
  };
}

function describeProtection(descriptor: PtyDescriptor | undefined, runtime: PtyRuntimeSnapshot | undefined) {
  if (!descriptor) {
    return { evictable: false, protectedReason: undefined as string | undefined };
  }
  if (descriptor.kind === "runner") {
    return { evictable: false, protectedReason: "runner" };
  }
  if (descriptor.pinned) {
    return { evictable: false, protectedReason: "pinned" };
  }
  if (runtime?.visibleViewIds.length) {
    return { evictable: false, protectedReason: "visible" };
  }
  if (runtime?.attachedViewIds.length) {
    return { evictable: false, protectedReason: "attached" };
  }
  if (runtime?.live) {
    return { evictable: true, protectedReason: undefined };
  }
  return { evictable: false, protectedReason: "inactive" };
}

function buildDesiredDescriptors(sessions: ClaudeSession[], terminalTabs: SplitWidgetTerminalTab[], current: PtyDescriptor[]) {
  const currentById = new Map(current.map((descriptor) => [descriptor.ptyId, descriptor]));
  const next: PtyDescriptor[] = [];

  sessions.forEach((session) => {
    const runnerPtyId = buildRunnerPtyId(session.id);
    const existingRunner = currentById.get(runnerPtyId);
    next.push({
      ptyId: runnerPtyId,
      sessionId: session.id,
      workspaceId: session.workspaceId,
      kind: "runner",
      title: session.name,
      cwdMode: "sessionWorktree",
      cwdPath: session.worktreePath ?? session.workdir,
      pinned: existingRunner?.pinned ?? true,
      createdAt: existingRunner?.createdAt ?? session.createdAt,
    });

    terminalTabs.forEach((tab) => {
      const ptyId = buildTerminalPtyId(session.id, tab.ptySessionKey);
      const existingTerminal = currentById.get(ptyId);
      next.push({
        ptyId,
        sessionId: session.id,
        workspaceId: session.workspaceId,
        kind: "terminal",
        title: existingTerminal?.title?.trim() || tab.title,
        cwdMode: existingTerminal?.cwdMode ?? "sessionWorktree",
        cwdPath: existingTerminal?.cwdPath,
        pinned: existingTerminal?.pinned ?? false,
        createdAt: existingTerminal?.createdAt ?? Date.now(),
        widgetTabKey: tab.ptySessionKey,
      });
    });
  });

  return next;
}

export const usePtyStore = create<PtyStore>()(
  persist(
    (set) => ({
      descriptors: [],
      runtimeById: {},

      syncWithSessions: (sessions, terminalTabs) =>
        set((state) => {
          const nextDescriptors = buildDesiredDescriptors(sessions, terminalTabs, state.descriptors);
          const validIds = new Set(nextDescriptors.map((descriptor) => descriptor.ptyId));
          const runtimeById = Object.fromEntries(
            Object.entries(state.runtimeById).filter(([ptyId]) => validIds.has(ptyId))
          );
          return {
            descriptors: nextDescriptors,
            runtimeById,
          };
        }),

      updateDescriptor: (ptyId, patch) =>
        set((state) => ({
          descriptors: state.descriptors.map((descriptor) => (
            descriptor.ptyId === ptyId ? { ...descriptor, ...patch } : descriptor
          )),
        })),

      togglePinned: (ptyId) =>
        set((state) => ({
          descriptors: state.descriptors.map((descriptor) => (
            descriptor.ptyId === ptyId ? { ...descriptor, pinned: !descriptor.pinned } : descriptor
          )),
        })),

      attachView: (ptyId, viewId) =>
        set((state) => {
          const current = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...current,
                attachedViewIds: dedupeStrings([...current.attachedViewIds, viewId]),
                lastActiveAt: Date.now(),
              },
            },
          };
        }),

      detachView: (ptyId, viewId) =>
        set((state) => {
          const current = state.runtimeById[ptyId];
          if (!current) return {};
          const nextRuntime = {
            ...current,
            attachedViewIds: current.attachedViewIds.filter((id) => id !== viewId),
            visibleViewIds: current.visibleViewIds.filter((id) => id !== viewId),
            lastActiveAt: Date.now(),
            lastDetachedAt: Date.now(),
          };
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      setViewVisible: (ptyId, viewId, visible) =>
        set((state) => {
          const current = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId);
          const visibleViewIds = visible
            ? dedupeStrings([...current.visibleViewIds, viewId])
            : current.visibleViewIds.filter((id) => id !== viewId);
          const nextRuntime = {
            ...current,
            visibleViewIds,
            lastActiveAt: Date.now(),
          };
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      setRuntimeStatus: (ptyId, status, extra) =>
        set((state) => {
          const nextRuntime = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId, {
            ...extra,
            status,
            live: status !== "exited",
            lastActiveAt: Date.now(),
          });
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      touchRuntime: (ptyId, patch) =>
        set((state) => {
          const nextRuntime = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId, {
            ...(patch ?? {}),
            lastActiveAt: patch?.lastActiveAt ?? Date.now(),
          });
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      markRuntimeExited: (ptyId, error) =>
        set((state) => {
          const nextRuntime = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId, {
            status: error ? "error" : "exited",
            error,
            live: false,
            lastActiveAt: Date.now(),
          });
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      setRuntimeSize: (ptyId, cols, rows) =>
        set((state) => {
          const nextRuntime = ensureRuntimeSnapshot(state.runtimeById[ptyId], ptyId, {
            lastCols: cols,
            lastRows: rows,
            lastActiveAt: Date.now(),
          });
          const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
          const protection = describeProtection(descriptor, nextRuntime);
          return {
            runtimeById: {
              ...state.runtimeById,
              [ptyId]: {
                ...nextRuntime,
                ...protection,
              },
            },
          };
        }),

      syncLiveRuntimes: (entries) =>
        set((state) => {
          const liveIds = new Set(entries.map((entry) => entry.ptyId));
          const runtimeById = { ...state.runtimeById };

          entries.forEach((entry) => {
            const existing = runtimeById[entry.ptyId];
            const nextRuntime = ensureRuntimeSnapshot(existing, entry.ptyId, {
              sessionId: entry.sessionId ?? undefined,
              kind: normalizeKind(entry.kind),
              status: (entry.status as PtyRuntimeStatus) || "running",
              live: true,
              lastActiveAt: entry.lastActiveAtMs || Date.now(),
            });
            const descriptor = state.descriptors.find((item) => item.ptyId === entry.ptyId);
            runtimeById[entry.ptyId] = {
              ...nextRuntime,
              ...describeProtection(descriptor, nextRuntime),
            };
          });

          Object.keys(runtimeById).forEach((ptyId) => {
            if (liveIds.has(ptyId)) return;
            const existing = runtimeById[ptyId];
            if (!existing?.live) return;
            const nextRuntime = {
              ...existing,
              live: false,
              status: existing.status === "error" ? "error" : "exited",
            };
            const descriptor = state.descriptors.find((item) => item.ptyId === ptyId);
            runtimeById[ptyId] = {
              ...nextRuntime,
              ...describeProtection(descriptor, nextRuntime),
            };
          });

          return { runtimeById };
        }),

      removeSessionDescriptors: (sessionId) =>
        set((state) => {
          const removedIds = new Set(
            state.descriptors
              .filter((descriptor) => descriptor.sessionId === sessionId)
              .map((descriptor) => descriptor.ptyId)
          );
          return {
            descriptors: state.descriptors.filter((descriptor) => descriptor.sessionId !== sessionId),
            runtimeById: Object.fromEntries(
              Object.entries(state.runtimeById).filter(([ptyId]) => !removedIds.has(ptyId))
            ),
          };
        }),

      removeTerminalDescriptorsByTabKey: (tabKey) =>
        set((state) => {
          const removedIds = new Set(
            state.descriptors
              .filter((descriptor) => descriptor.widgetTabKey === tabKey)
              .map((descriptor) => descriptor.ptyId)
          );
          return {
            descriptors: state.descriptors.filter((descriptor) => descriptor.widgetTabKey !== tabKey),
            runtimeById: Object.fromEntries(
              Object.entries(state.runtimeById).filter(([ptyId]) => !removedIds.has(ptyId))
            ),
          };
        }),
    }),
    {
      name: "code-bar-ptys",
      storage: createJSONStorage(() => mirroredPersistStorage),
      partialize: (state) => ({
        descriptors: state.descriptors,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PtyStore>),
        runtimeById: {},
      }),
    }
  )
);
