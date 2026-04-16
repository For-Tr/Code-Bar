import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mirroredPersistStorage } from "./persistStorage";
import { useSettingsStore, type RunnerConfig } from "./settingsStore";

// ── 类型定义 ────────────────────────────────────────────────

export type SessionStatus = "idle" | "running" | "waiting" | "suspended" | "done" | "error";

export interface DiffFile {
  path: string;
  type: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary?: boolean;
  note?: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "added" | "deleted";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface ClaudeSession {
  id: string;
  name: string;
  workspaceId: string;   // 归属的 Workspace ID
  workdir: string;       // 冗余存储，方便直接传给 PTY
  status: SessionStatus;
  currentTask: string;
  createdAt: number;
  diffFiles: DiffFile[];
  output: string[];
  runner: RunnerConfig;
  pid?: number;
  branchName?: string;     // AI 在本 session 中使用的 git 分支名（如 ci/1a2b3c/session-3）
  baseBranch?: string;     // 任务开始时的基础分支（如 main/master）
  worktreePath?: string;   // git worktree 路径
  providerSessionId?: string; // 绑定的 provider 原生会话 ID（用于 codex/claude resume）
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedSessionId: string | null;
  sessionOrderByWorkspace: Record<string, string[]>;
  splitDetailItemId: string;
  splitCardItemIdsBySlot: Record<string, string>;

  // worktreeReady：记录 worktree 是否已就绪（创建完成或确认不是 git 仓库）
  // 不持久化，每次应用启动重置；持久化的 session 重新打开时从 worktreePath 推断
  worktreeReadyIds: Set<string>;

  addSession: (id: string, workspaceId: string, workdir: string, name: string | undefined, runner: RunnerConfig) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  setExpandedSession: (id: string | null) => void;
  removeSessionsByWorkspace: (workspaceId: string) => void;
  markWorktreeReady: (id: string) => void;
  mergeRecoveredSessions: (sessions: ClaudeSession[]) => void;
  reorderWorkspaceSessions: (workspaceId: string, orderedSessionIds: string[]) => void;
  reorderWorkspaceSessionsByVisibleMove: (workspaceId: string, activeId: string, overId: string) => void;
  swapSplitDetailWithCard: (slotId: string) => void;
}

// ── 工厂函数 ─────────────────────────────────────────────────

const STATUS_PRIORITY: Partial<Record<SessionStatus, number>> = {
  waiting: 0,
  running: 1,
  suspended: 2,
};

function getStatusPriority(status: SessionStatus): number {
  return STATUS_PRIORITY[status] ?? 3;
}

function dedupeSessionIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }

  return deduped;
}

function normalizeSessionIdentityValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isSameLogicalSession(existing: ClaudeSession, incoming: ClaudeSession): boolean {
  const existingWorktree = normalizeSessionIdentityValue(existing.worktreePath);
  const incomingWorktree = normalizeSessionIdentityValue(incoming.worktreePath);
  if (existingWorktree && incomingWorktree) {
    return existing.workspaceId === incoming.workspaceId && existingWorktree === incomingWorktree;
  }

  const existingProviderSessionId = normalizeSessionIdentityValue(existing.providerSessionId);
  const incomingProviderSessionId = normalizeSessionIdentityValue(incoming.providerSessionId);
  if (existingProviderSessionId && incomingProviderSessionId) {
    return existing.workspaceId === incoming.workspaceId
      && existing.runner.type === incoming.runner.type
      && existingProviderSessionId === incomingProviderSessionId;
  }

  const existingBranchName = normalizeSessionIdentityValue(existing.branchName);
  const incomingBranchName = normalizeSessionIdentityValue(incoming.branchName);
  if (existingBranchName && incomingBranchName) {
    return existing.workspaceId === incoming.workspaceId && existingBranchName === incomingBranchName;
  }

  return existing.workspaceId === incoming.workspaceId && existing.createdAt === incoming.createdAt;
}

function buildWorkspaceManualOrder(
  sessions: ClaudeSession[],
  workspaceId: string,
  persistedOrder: string[] | undefined
): string[] {
  const workspaceSessions = sessions.filter((s) => s.workspaceId === workspaceId);
  const workspaceIds = workspaceSessions.map((s) => s.id);
  const validSet = new Set(workspaceIds);
  const normalizedPersisted = dedupeSessionIds(
    (persistedOrder ?? []).filter((id) => validSet.has(id))
  );
  const normalizedSet = new Set(normalizedPersisted);
  const missing = workspaceIds.filter((id) => !normalizedSet.has(id));
  return [...normalizedPersisted, ...missing];
}

export function orderWorkspaceSessions(
  sessions: ClaudeSession[],
  workspaceId: string,
  sessionOrderByWorkspace: Record<string, string[]>
): ClaudeSession[] {
  const workspaceSessions = sessions.filter((s) => s.workspaceId === workspaceId);
  const manualOrder = buildWorkspaceManualOrder(
    sessions,
    workspaceId,
    sessionOrderByWorkspace[workspaceId]
  );
  const manualIndex = new Map(manualOrder.map((id, index) => [id, index]));

  return [...workspaceSessions].sort((a, b) => {
    const priorityDelta = getStatusPriority(a.status) - getStatusPriority(b.status);
    if (priorityDelta !== 0) return priorityDelta;

    const aIndex = manualIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = manualIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;

    return a.createdAt - b.createdAt;
  });
}

function resolveRunnerField(current: string | undefined, fallback: string | undefined): string | undefined {
  return current && current.trim() ? current : fallback;
}

function hydrateRunnerConfig(runner: RunnerConfig): RunnerConfig {
  const resolved = useSettingsStore.getState().getRunnerConfigForType(runner.type);
  return {
    type: runner.type,
    cliPath: resolveRunnerField(runner.cliPath, resolved.cliPath),
    cliArgs: resolveRunnerField(runner.cliArgs, resolved.cliArgs),
    apiBaseUrl: resolveRunnerField(runner.apiBaseUrl, resolved.apiBaseUrl),
    apiKeyOverride: resolveRunnerField(runner.apiKeyOverride, resolved.apiKeyOverride),
  };
}

function makeSession(
  overrides: Partial<Omit<ClaudeSession, "runner">> & { id: string; workspaceId: string; workdir: string; runner: RunnerConfig }
): ClaudeSession {
  return {
    name: `会话 ${overrides.id}`,
    status: "idle",
    currentTask: "",
    createdAt: Date.now(),
    diffFiles: [],
    output: [],
    ...overrides,
    runner: hydrateRunnerConfig(overrides.runner),
  };
}

// ── Store ─────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,
      expandedSessionId: null,
      sessionOrderByWorkspace: {},
      splitDetailItemId: "session-detail",
      splitCardItemIdsBySlot: {},
      worktreeReadyIds: new Set<string>(),

      addSession: (id, workspaceId, workdir, name, runner) => {
        const s = makeSession({
          id,
          workspaceId,
          workdir,
          ...(name ? { name } : {}),
          runner: { ...runner },
        });
        set((state) => ({
          sessions: [...state.sessions, s],
          activeSessionId: s.id,
          sessionOrderByWorkspace: {
            ...state.sessionOrderByWorkspace,
            [workspaceId]: [...(state.sessionOrderByWorkspace[workspaceId] ?? []), s.id],
          },
        }));
        return s.id;
      },

      removeSession: (id) =>
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== id);
          const activeSessionId =
            state.activeSessionId === id
              ? (sessions[0]?.id ?? null)
              : state.activeSessionId;
          const expandedSessionId =
            state.expandedSessionId === id
              ? null
              : state.expandedSessionId;
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          worktreeReadyIds.delete(id);
          const sessionOrderByWorkspace = Object.fromEntries(
            Object.entries(state.sessionOrderByWorkspace).map(([workspaceId, ids]) => [
              workspaceId,
              ids.filter((sid) => sid !== id),
            ])
          );
          const removedItemId = `session-${id}`;
          const splitDetailItemId = state.splitDetailItemId === removedItemId
            ? "session-detail"
            : state.splitDetailItemId;
          const splitCardItemIdsBySlot = Object.fromEntries(
            Object.entries(state.splitCardItemIdsBySlot).filter(([, itemId]) => itemId !== removedItemId)
          );
          return {
            sessions,
            activeSessionId,
            expandedSessionId,
            worktreeReadyIds,
            sessionOrderByWorkspace,
            splitDetailItemId,
            splitCardItemIdsBySlot,
          };
        }),

      setActiveSession: (id) =>
        set({ activeSessionId: id }),

      setExpandedSession: (id) =>
        set({ expandedSessionId: id }),

      updateSession: (id, patch) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, ...patch } : s
          ),
        })),

      appendOutput: (id, line) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? { ...s, output: [...s.output.slice(-299), line] }
              : s
          ),
        })),

      clearOutput: (id) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, output: [] } : s
          ),
        })),

      setDiffFiles: (id, files) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, diffFiles: files } : s
          ),
        })),

      removeSessionsByWorkspace: (workspaceId) =>
        set((state) => {
          const sessions = state.sessions.filter((s) => s.workspaceId !== workspaceId);
          const activeSessionId =
            state.sessions.find((s) => s.id === state.activeSessionId)?.workspaceId === workspaceId
              ? (sessions[0]?.id ?? null)
              : state.activeSessionId;
          const expandedSessionId =
            state.sessions.find((s) => s.id === state.expandedSessionId)?.workspaceId === workspaceId
              ? null
              : state.expandedSessionId;
          const removedIds = state.sessions
            .filter((s) => s.workspaceId === workspaceId)
            .map((s) => s.id);
          const removedItemIds = new Set(removedIds.map((id) => `session-${id}`));
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          removedIds.forEach((id) => worktreeReadyIds.delete(id));
          const { [workspaceId]: _, ...restOrder } = state.sessionOrderByWorkspace;
          const splitDetailItemId = removedItemIds.has(state.splitDetailItemId)
            ? "session-detail"
            : state.splitDetailItemId;
          const splitCardItemIdsBySlot = Object.fromEntries(
            Object.entries(state.splitCardItemIdsBySlot).filter(([, itemId]) => !removedItemIds.has(itemId))
          );
          return {
            sessions,
            activeSessionId,
            expandedSessionId,
            worktreeReadyIds,
            sessionOrderByWorkspace: restOrder,
            splitDetailItemId,
            splitCardItemIdsBySlot,
          };
        }),

      markWorktreeReady: (id) =>
        set((state) => {
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          worktreeReadyIds.add(id);
          return { worktreeReadyIds };
        }),

      mergeRecoveredSessions: (recoveredSessions) =>
        set((state) => {
          if (recoveredSessions.length === 0) return {};

          const sessions = [...state.sessions];
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          const sessionOrderByWorkspace = { ...state.sessionOrderByWorkspace };
          let added = false;
          let merged = false;
          let firstRecoveredSessionId: string | null = null;

          for (const recovered of recoveredSessions) {
            const hydratedRecovered: ClaudeSession = {
              ...recovered,
              runner: hydrateRunnerConfig(recovered.runner),
              diffFiles: [...recovered.diffFiles],
              output: [...recovered.output],
            };
            firstRecoveredSessionId ??= hydratedRecovered.id;

            const existingIndex = sessions.findIndex((session) => session.id === hydratedRecovered.id);
            if (existingIndex >= 0) {
              const existingSession = sessions[existingIndex];
              if (!isSameLogicalSession(existingSession, hydratedRecovered)) {
                console.warn("[session-store] skip recovered session with conflicting duplicate id", {
                  sessionId: hydratedRecovered.id,
                  existingWorkspaceId: existingSession.workspaceId,
                  recoveredWorkspaceId: hydratedRecovered.workspaceId,
                  existingWorktreePath: existingSession.worktreePath,
                  recoveredWorktreePath: hydratedRecovered.worktreePath,
                  existingProviderSessionId: existingSession.providerSessionId,
                  recoveredProviderSessionId: hydratedRecovered.providerSessionId,
                });
                continue;
              }

              sessions[existingIndex] = {
                ...existingSession,
                ...hydratedRecovered,
                runner: hydrateRunnerConfig(hydratedRecovered.runner),
                diffFiles: [...hydratedRecovered.diffFiles],
                output: [...hydratedRecovered.output],
              };
              merged = true;
            } else {
              sessions.push(hydratedRecovered);
              added = true;
            }

            if (hydratedRecovered.worktreePath) {
              worktreeReadyIds.add(hydratedRecovered.id);
            }

            const workspaceId = hydratedRecovered.workspaceId;
            const nextOrder = [...(sessionOrderByWorkspace[workspaceId] ?? []), hydratedRecovered.id];
            sessionOrderByWorkspace[workspaceId] = buildWorkspaceManualOrder(
              sessions,
              workspaceId,
              nextOrder
            );
          }

          if (!added && !merged) return {};

          return {
            sessions,
            worktreeReadyIds,
            sessionOrderByWorkspace,
            activeSessionId: state.activeSessionId ?? firstRecoveredSessionId,
          };
        }),

      reorderWorkspaceSessions: (workspaceId, orderedSessionIds) =>
        set((state) => {
          const manualOrder = buildWorkspaceManualOrder(
            state.sessions,
            workspaceId,
            orderedSessionIds
          );
          return {
            sessionOrderByWorkspace: {
              ...state.sessionOrderByWorkspace,
              [workspaceId]: manualOrder,
            },
          };
        }),

      reorderWorkspaceSessionsByVisibleMove: (workspaceId, activeId, overId) =>
        set((state) => {
          const visibleOrdered = orderWorkspaceSessions(
            state.sessions,
            workspaceId,
            state.sessionOrderByWorkspace
          );
          const oldIndex = visibleOrdered.findIndex((s) => s.id === activeId);
          const newIndex = visibleOrdered.findIndex((s) => s.id === overId);
          if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return {};

          const activeSession = visibleOrdered[oldIndex];
          const overSession = visibleOrdered[newIndex];
          const activePriority = getStatusPriority(activeSession.status);
          const overPriority = getStatusPriority(overSession.status);
          if (activePriority !== overPriority) return {};

          const sameGroupVisible = visibleOrdered.filter(
            (session) => getStatusPriority(session.status) === activePriority
          );
          const groupOldIndex = sameGroupVisible.findIndex((s) => s.id === activeId);
          const groupNewIndex = sameGroupVisible.findIndex((s) => s.id === overId);
          if (groupOldIndex < 0 || groupNewIndex < 0 || groupOldIndex === groupNewIndex) return {};

          const movedGroup = [...sameGroupVisible];
          const [moved] = movedGroup.splice(groupOldIndex, 1);
          movedGroup.splice(groupNewIndex, 0, moved);
          const movedGroupIds = movedGroup.map((s) => s.id);
          const movedGroupIndex = new Map(movedGroupIds.map((id, index) => [id, index]));

          const manualOrder = buildWorkspaceManualOrder(
            state.sessions,
            workspaceId,
            state.sessionOrderByWorkspace[workspaceId]
          );
          const nextOrder = [...manualOrder].sort((a, b) => {
            const aIdx = movedGroupIndex.get(a);
            const bIdx = movedGroupIndex.get(b);
            if (aIdx === undefined && bIdx === undefined) return 0;
            if (aIdx === undefined) return 1;
            if (bIdx === undefined) return -1;
            return aIdx - bIdx;
          });

          if (nextOrder.every((id, index) => id === manualOrder[index])) {
            return {};
          }

          return {
            sessionOrderByWorkspace: {
              ...state.sessionOrderByWorkspace,
              [workspaceId]: nextOrder,
            },
          };
        }),

      swapSplitDetailWithCard: (slotId) =>
        set((state) => {
          const cardItemId = state.splitCardItemIdsBySlot[slotId] ?? slotId;
          const detailItemId = state.splitDetailItemId;
          if (cardItemId === detailItemId) return {};
          return {
            splitDetailItemId: cardItemId,
            splitCardItemIdsBySlot: {
              ...state.splitCardItemIdsBySlot,
              [slotId]: detailItemId,
            },
          };
        }),
    }),
    {
      name: "code-bar-sessions",
      storage: createJSONStorage(() => mirroredPersistStorage),
      // expandedSessionId 和 worktreeReadyIds 不持久化
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          // running/waiting 状态在重启后 PTY 已不存在，重置为 idle
          status: (s.status === "running" || s.status === "waiting") ? "idle" : s.status,
          // output 不持久化（节省空间，PTY 重启后输出会重新产生）
          output: [],
          pid: undefined,
        })),
        activeSessionId: state.activeSessionId,
        sessionOrderByWorkspace: state.sessionOrderByWorkspace,
      }),
      // 恢复时：将已有 worktreePath 的 session 标记为 worktreeReady
      // 这些 session 的 worktree 可能已存在（或被孤儿清理），但不再新建——直接用持久化路径
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const sessionIdCounts = new Map<string, number>();
        for (const session of state.sessions) {
          sessionIdCounts.set(session.id, (sessionIdCounts.get(session.id) ?? 0) + 1);
        }
        const duplicateSessionIds = [...sessionIdCounts.entries()]
          .filter(([, count]) => count > 1)
          .map(([id]) => id);
        if (duplicateSessionIds.length > 0) {
          console.warn("[session-store] duplicate session ids found during rehydrate", {
            sessionIds: duplicateSessionIds,
          });
        }

        // 有 worktreePath 的持久化 session：worktree 已在文件系统中（由启动时的清理机制保证有效性）
        // 直接标记为 ready，不重新创建
        const readyIds = new Set<string>(
          state.sessions.filter((s) => s.worktreePath).map((s) => s.id)
        );
        state.worktreeReadyIds = readyIds;

        // 修复每个 workspace 的 session顺序：补齐遗漏、去掉无效项
        const byWorkspace = state.sessions.reduce<Record<string, string[]>>((acc, s) => {
          acc[s.workspaceId] = [...(acc[s.workspaceId] ?? []), s.id];
          return acc;
        }, {});
        const normalizedOrder: Record<string, string[]> = {};
        for (const [workspaceId, ids] of Object.entries(byWorkspace)) {
          const validSet = new Set(ids);
          const persisted = dedupeSessionIds(
            (state.sessionOrderByWorkspace?.[workspaceId] ?? []).filter((id) => validSet.has(id))
          );
          const persistedSet = new Set(persisted);
          const missing = ids.filter((id) => !persistedSet.has(id));
          normalizedOrder[workspaceId] = [...persisted, ...missing];
        }
        state.sessionOrderByWorkspace = normalizedOrder;
      },
    }
  )
);
