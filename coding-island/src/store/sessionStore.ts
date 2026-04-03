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
  workdir: string;
  status: SessionStatus;
  currentTask: string;
  createdAt: number;
  diffFiles: DiffFile[];
  output: string[];     // Claude Code 实时输出行
  pid?: number;         // 子进程 PID
}

interface SessionStore {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  expandedDiffFileId: string | null;
  expandedSessionId: string | null;  // 放大展开的 session

  addSession: (workdir: string, name?: string) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<ClaudeSession>) => void;
  appendOutput: (id: string, line: string) => void;
  clearOutput: (id: string) => void;
  setDiffFiles: (id: string, files: DiffFile[]) => void;
  toggleDiffFile: (path: string) => void;
  setExpandedSession: (id: string | null) => void;
}

// ── Mock diff 数据（后续由 git diff 实时替换）────────────────

const MOCK_DIFF: DiffFile[] = [
  {
    path: "src/api/auth.ts",
    type: "modified",
    additions: 12,
    deletions: 5,
    hunks: [
      {
        header: "@@ -24,7 +24,14 @@ export async function login(credentials: Credentials) {",
        lines: [
          { type: "context",  content: "  const response = await fetch('/api/login', {", oldLineNo: 24, newLineNo: 24 },
          { type: "context",  content: "    method: 'POST',",                             oldLineNo: 25, newLineNo: 25 },
          { type: "deleted",  content: "    body: JSON.stringify(credentials),",           oldLineNo: 26 },
          { type: "added",    content: "    body: JSON.stringify({",                       newLineNo: 26 },
          { type: "added",    content: "      ...credentials,",                            newLineNo: 27 },
          { type: "added",    content: "      timestamp: Date.now(),",                     newLineNo: 28 },
          { type: "added",    content: "    }),",                                          newLineNo: 29 },
          { type: "context",  content: "  });",                                            oldLineNo: 27, newLineNo: 30 },
          { type: "deleted",  content: "  return response.json();",                        oldLineNo: 28 },
          { type: "added",    content: "  if (!response.ok) throw new Error('Auth failed');", newLineNo: 31 },
          { type: "added",    content: "  return response.json();",                        newLineNo: 32 },
        ],
      },
    ],
  },
  {
    path: "src/components/LoginForm.tsx",
    type: "modified",
    additions: 3,
    deletions: 1,
    hunks: [
      {
        header: "@@ -8,5 +8,7 @@ export function LoginForm() {",
        lines: [
          { type: "context", content: "  const [loading, setLoading] = useState(false);", oldLineNo: 8,  newLineNo: 8 },
          { type: "deleted", content: "  const [error, setError] = useState('');",         oldLineNo: 9 },
          { type: "added",   content: "  const [error, setError] = useState<string | null>(null);", newLineNo: 9 },
          { type: "added",   content: "  const [attempts, setAttempts] = useState(0);",    newLineNo: 10 },
        ],
      },
    ],
  },
  {
    path: "src/utils/token.ts",
    type: "added",
    additions: 10,
    deletions: 0,
    hunks: [
      {
        header: "@@ -0,0 +1,10 @@",
        lines: [
          { type: "added", content: "import { jwtDecode } from 'jwt-decode';",              newLineNo: 1 },
          { type: "added", content: "",                                                      newLineNo: 2 },
          { type: "added", content: "export function isTokenExpired(token: string): boolean {", newLineNo: 3 },
          { type: "added", content: "  try {",                                               newLineNo: 4 },
          { type: "added", content: "    const { exp } = jwtDecode<{ exp: number }>(token);", newLineNo: 5 },
          { type: "added", content: "    return Date.now() >= exp * 1000;",                  newLineNo: 6 },
          { type: "added", content: "  } catch { return true; }",                            newLineNo: 7 },
          { type: "added", content: "}",                                                     newLineNo: 8 },
        ],
      },
    ],
  },
];

// ── 工厂函数 ─────────────────────────────────────────────────

let _counter = 1;

function makeSession(overrides?: Partial<ClaudeSession>): ClaudeSession {
  const id = String(_counter++);
  return {
    id,
    name: `会话 ${id}`,
    workdir: "~/projects/my-app",
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
  sessions: [
    makeSession({
      name: "修复登录 Bug",
      workdir: "~/projects/my-app",
      status: "running",
      currentTask: "正在修改 auth.ts 的错误处理逻辑...",
      diffFiles: MOCK_DIFF,
      output: [
        "> 分析代码结构...",
        "> 发现 auth.ts 中错误处理缺失",
        "> 正在生成修复方案...",
      ],
    }),
    makeSession({
      name: "重构 API 层",
      workdir: "~/projects/my-app",
      status: "waiting",
      currentTask: "等待用户确认删除操作",
      diffFiles: [],
      output: [],
    }),
  ],
  activeSessionId: "1",
  expandedDiffFileId: null,
  expandedSessionId: null,

  addSession: (workdir: string, name?: string) => {
    const s = makeSession({ workdir, ...(name ? { name } : {}) });
    set((state) => ({
      sessions: [...state.sessions, s],
      activeSessionId: s.id,
    }));
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

  // 追加一行输出，最多保留 300 行
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
}));
