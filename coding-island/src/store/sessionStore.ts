import { create } from "zustand";

// ── 类型定义 ────────────────────────────────────────────────

export type SessionStatus = "idle" | "running" | "waiting" | "done" | "error";

export interface DiffFile {
  path: string;
  type: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
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
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedDiffFileId: string | null;
  expandedSessionId: string | null;

  addSession: (workspaceId: string, workdir: string, name?: string) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  toggleDiffFile: (path: string) => void;
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

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  expandedDiffFileId: null,
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
    set({ activeSessionId: id, expandedDiffFileId: null }),

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

  toggleDiffFile: (path) =>
    set((state) => ({
      expandedDiffFileId:
        state.expandedDiffFileId === path ? null : path,
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
}));
