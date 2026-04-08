import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RunnerConfig } from "./settingsStore";

// ── 类型定义 ────────────────────────────────────────────────

export type SessionStatus = "idle" | "running" | "waiting" | "done" | "error";

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
  runner?: RunnerConfig;
  pid?: number;
  branchName?: string;     // AI 在本 session 中使用的 git 分支名（如 ci/session-3）
  baseBranch?: string;     // 任务开始时的基础分支（如 main/master）
  worktreePath?: string;   // git worktree 路径
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedSessionId: string | null;

  // worktreeReady：记录 worktree 是否已就绪（创建完成或确认不是 git 仓库）
  // 不持久化，每次应用启动重置；持久化的 session 重新打开时从 worktreePath 推断
  worktreeReadyIds: Set<string>;

  addSession: (workspaceId: string, workdir: string, name?: string, runner?: RunnerConfig) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  setExpandedSession: (id: string | null) => void;
  removeSessionsByWorkspace: (workspaceId: string) => void;
  markWorktreeReady: (id: string) => void;
}

// ── 工厂函数 ─────────────────────────────────────────────────

let _counter = 1;

function makeSession(overrides: Partial<ClaudeSession> & { workspaceId: string; workdir: string }): ClaudeSession {
  const id = String(_counter++);
  return {
    id,
    name: `会话 ${id}`,
    status: "idle",
    currentTask: "",
    createdAt: Date.now(),
    diffFiles: [],
    output: [],
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
      worktreeReadyIds: new Set<string>(),

      addSession: (workspaceId, workdir, name, runner) => {
        const s = makeSession({
          workspaceId,
          workdir,
          ...(name ? { name } : {}),
          ...(runner ? { runner: { ...runner } } : {}),
        });
        set((state) => ({
          sessions: [...state.sessions, s],
          activeSessionId: s.id,
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
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          worktreeReadyIds.delete(id);
          return { sessions, activeSessionId, worktreeReadyIds };
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
          const removedIds = state.sessions
            .filter((s) => s.workspaceId === workspaceId)
            .map((s) => s.id);
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          removedIds.forEach((id) => worktreeReadyIds.delete(id));
          return { sessions, activeSessionId, worktreeReadyIds };
        }),

      markWorktreeReady: (id) =>
        set((state) => {
          const worktreeReadyIds = new Set(state.worktreeReadyIds);
          worktreeReadyIds.add(id);
          return { worktreeReadyIds };
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
        })),
        activeSessionId: state.activeSessionId,
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
        const readyIds = new Set<string>(
          state.sessions.filter((s) => s.worktreePath).map((s) => s.id)
        );
        state.worktreeReadyIds = readyIds;
      },
    }
  )
);
