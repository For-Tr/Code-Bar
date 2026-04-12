import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RunnerConfig } from "./settingsStore";
import type { ExternalTerminalApp, TerminalHost } from "./workspaceStore";

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

export interface ExternalTerminalHint {
  app?: ExternalTerminalApp;
  lastKnownCwd?: string;
  titleHint?: string;
  lookupKey?: string;
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
  terminalHost: TerminalHost;
  externalTerminalHint?: ExternalTerminalHint;
  pid?: number;
  branchName?: string;     // AI 在本 session 中使用的 git 分支名（如 ci/session-3）
  baseBranch?: string;     // 任务开始时的基础分支（如 main/master）
  worktreePath?: string;   // git worktree 路径
  providerSessionId?: string; // 绑定的 provider 原生会话 ID（用于 codex/claude resume）
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedSessionId: string | null;
  sessionOrderByWorkspace: Record<string, string[]>;

  // worktreeReady：记录 worktree 是否已就绪（创建完成或确认不是 git 仓库）
  // 不持久化，每次应用启动重置；持久化的 session 重新打开时从 worktreePath 推断
  worktreeReadyIds: Set<string>;

  addSession: (workspaceId: string, workdir: string, name: string | undefined, runner: RunnerConfig, terminalHost?: TerminalHost) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  setExpandedSession: (id: string | null) => void;
  removeSessionsByWorkspace: (workspaceId: string) => void;
  markWorktreeReady: (id: string) => void;
  reorderWorkspaceSessions: (workspaceId: string, orderedSessionIds: string[]) => void;
  reorderWorkspaceSessionsByVisibleMove: (workspaceId: string, activeId: string, overId: string) => void;
}

// ── 工厂函数 ─────────────────────────────────────────────────

let _counter = 1;

const STATUS_PRIORITY: Partial<Record<SessionStatus, number>> = {
  waiting: 0,
  running: 1,
  suspended: 2,
};

function getStatusPriority(status: SessionStatus): number {
  return STATUS_PRIORITY[status] ?? 3;
}

function buildWorkspaceManualOrder(
  sessions: ClaudeSession[],
  workspaceId: string,
  persistedOrder: string[] | undefined
): string[] {
  const workspaceSessions = sessions.filter((s) => s.workspaceId === workspaceId);
  const workspaceIds = workspaceSessions.map((s) => s.id);
  const validSet = new Set(workspaceIds);
  const normalizedPersisted = (persistedOrder ?? []).filter((id) => validSet.has(id));
  const missing = workspaceIds.filter((id) => !normalizedPersisted.includes(id));
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

function makeSession(
  overrides: Partial<ClaudeSession> & Pick<ClaudeSession, "workspaceId" | "workdir" | "runner">
): ClaudeSession {
  const id = String(_counter++);
  return {
    id,
    name: `会话 ${id}`,
    status: "idle",
    currentTask: "",
    createdAt: Date.now(),
    diffFiles: [],
    output: [],
    terminalHost: "embedded",
    ...overrides,
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
      worktreeReadyIds: new Set<string>(),

      addSession: (workspaceId, workdir, name, runner, terminalHost = "embedded") => {
        const s = makeSession({
          workspaceId,
          workdir,
          ...(name ? { name } : {}),
          runner: { ...runner },
          terminalHost,
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
          return { sessions, activeSessionId, expandedSessionId, worktreeReadyIds, sessionOrderByWorkspace };
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
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          removedIds.forEach((id) => worktreeReadyIds.delete(id));
          const { [workspaceId]: _, ...restOrder } = state.sessionOrderByWorkspace;
          return { sessions, activeSessionId, expandedSessionId, worktreeReadyIds, sessionOrderByWorkspace: restOrder };
        }),

      markWorktreeReady: (id) =>
        set((state) => {
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          worktreeReadyIds.add(id);
          return { worktreeReadyIds };
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
          if (oldIndex < 0 || newIndex < 0) return {};

          const activeSession = visibleOrdered[oldIndex];
          const overSession = visibleOrdered[newIndex];
          // 状态分组优先，拖拽只允许调整同优先级分组内部顺序
          if (getStatusPriority(activeSession.status) !== getStatusPriority(overSession.status)) {
            return {};
          }

          const movedVisible = [...visibleOrdered];
          const [moved] = movedVisible.splice(oldIndex, 1);
          movedVisible.splice(newIndex, 0, moved);
          const movedIds = movedVisible.map((s) => s.id);
          const movedIndex = new Map(movedIds.map((id, index) => [id, index]));

          const manualOrder = buildWorkspaceManualOrder(
            state.sessions,
            workspaceId,
            state.sessionOrderByWorkspace[workspaceId]
          );

          const nextManualOrder = [...manualOrder].sort((a, b) => {
            const aIdx = movedIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
            const bIdx = movedIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
            return aIdx - bIdx;
          });

          return {
            sessionOrderByWorkspace: {
              ...state.sessionOrderByWorkspace,
              [workspaceId]: nextManualOrder,
            },
          };
        }),
    }),
    {
      name: "code-bar-sessions",
      // expandedSessionId 和 worktreeReadyIds 不持久化
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          // running/waiting 状态在重启后 PTY 已不存在，重置为 idle
          status: (s.status === "running" || s.status === "waiting") ? "idle" : s.status,
          // output 不持久化（节省空间，PTY 重启后输出会重新产生）
          output: [],
          pid: undefined,
          terminalHost: s.terminalHost ?? "embedded",
        })),
        activeSessionId: state.activeSessionId,
        sessionOrderByWorkspace: state.sessionOrderByWorkspace,
      }),
      // 恢复时：修复 _counter，并将已有 worktreePath 的 session 标记为 worktreeReady
      // 这些 session 的 worktree 可能已存在（或被孤儿清理），但不再新建——直接用持久化路径
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const ids = state.sessions.map((s) => Number(s.id)).filter((n) => !isNaN(n));
        if (ids.length > 0) {
          _counter = Math.max(...ids) + 1;
        }
        // 有 worktreePath 的持久化 session：worktree 已在文件系统中（由启动时的清理机制保证有效性）
        // 直接标记为 ready，不重新创建
        state.sessions = state.sessions.map((s) => ({
          ...s,
          terminalHost: s.terminalHost ?? "embedded",
        }));

        const readyIds = new Set<string>(
          state.sessions.filter((s) => s.worktreePath).map((s) => s.id)
        );
        state.worktreeReadyIds = readyIds;

        // 修复每个 workspace 的 session 顺序：补齐遗漏、去掉无效项
        const byWorkspace = state.sessions.reduce<Record<string, string[]>>((acc, s) => {
          acc[s.workspaceId] = [...(acc[s.workspaceId] ?? []), s.id];
          return acc;
        }, {});
        const normalizedOrder: Record<string, string[]> = {};
        for (const [workspaceId, ids] of Object.entries(byWorkspace)) {
          const validSet = new Set(ids);
          const persisted = (state.sessionOrderByWorkspace?.[workspaceId] ?? []).filter((id) => validSet.has(id));
          const missing = ids.filter((id) => !persisted.includes(id));
          normalizedOrder[workspaceId] = [...persisted, ...missing];
        }
        state.sessionOrderByWorkspace = normalizedOrder;
      },
    }
  )
);
