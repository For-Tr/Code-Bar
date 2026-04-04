import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  pid?: number;
  // Git 分支信息（保留供未来功能使用；当前 PTY 流程通过 CODING_ISLAND_* 环境变量
  // 透传 session 上下文，由 AI CLI 自主管理 git 分支，不依赖下列字段）
  branchName?: string;     // AI 在本 session 中使用的 git 分支名（如 ci/session-3）
  baseBranch?: string;     // 任务开始时的基础分支（如 main/master）
  worktreePath?: string;   // git worktree 路径（预留，当前未使用）
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedSessionId: string | null;

  addSession: (workspaceId: string, workdir: string, name?: string) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  setExpandedSession: (id: string | null) => void;
  removeSessionsByWorkspace: (workspaceId: string) => void;
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

      addSession: (workspaceId, workdir, name) => {
        const s = makeSession({ workspaceId, workdir, ...(name ? { name } : {}) });
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
          return { sessions, activeSessionId };
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
          return { sessions, activeSessionId };
        }),
    }),
    {
      name: "coding-island-sessions",
      // expandedSessionId 不持久化（每次打开都回到首页）
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
      // 恢复时修复 _counter，避免 id 冲突
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const ids = state.sessions.map((s) => Number(s.id)).filter((n) => !isNaN(n));
        if (ids.length > 0) {
          _counter = Math.max(...ids) + 1;
        }
      },
    }
  )
);
