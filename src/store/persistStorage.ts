import type { StateStorage } from "zustand/middleware";

const PERSIST_KEYS = [
  "code-bar-sessions",
  "code-bar-workspaces",
  "code-bar-settings",
] as const;

type PersistKey = typeof PERSIST_KEYS[number];

interface DeletedUiState {
  sessionIds?: string[];
  workspaceIds?: string[];
}

interface PersistedSessionLike {
  id: string;
  workspaceId: string;
  createdAt?: number;
}

interface PersistedSessionsState {
  state?: {
    sessions?: PersistedSessionLike[];
    activeSessionId?: string | null;
    sessionOrderByWorkspace?: Record<string, string[]>;
  };
  version?: number;
}

interface PersistedWorkspaceLike {
  id: string;
  order?: number;
}

interface PersistedWorkspacesState {
  state?: {
    workspaces?: PersistedWorkspaceLike[];
    activeWorkspaceId?: string | null;
  };
  version?: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeSafe<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  values.forEach((value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    next.push(value);
  });

  return next;
}

function mergeSessionValue(
  fileValue: string | null,
  localValue: string | null,
  deleted: { sessionIds: Set<string>; workspaceIds: Set<string> }
): string | null {
  const fileState = parseJson<PersistedSessionsState>(fileValue);
  const localState = parseJson<PersistedSessionsState>(localValue);
  if (!fileState && !localState) {
    return localValue ?? fileValue ?? null;
  }

  const shouldKeepSession = (session: PersistedSessionLike) =>
    !!session?.id
    && !deleted.sessionIds.has(session.id)
    && !deleted.workspaceIds.has(session.workspaceId);

  const localSessions = (localState?.state?.sessions ?? []).filter(shouldKeepSession);
  const fileSessions = (fileState?.state?.sessions ?? []).filter(shouldKeepSession);
  const mergedSessions = [...localSessions];
  const existingIds = new Set(localSessions.map((session) => session.id));

  fileSessions.forEach((session) => {
    if (existingIds.has(session.id)) return;
    existingIds.add(session.id);
    mergedSessions.push(session);
  });

  const validIds = new Set(mergedSessions.map((session) => session.id));
  const workspaceIds = uniqueStrings([
    ...mergedSessions.map((session) => session.workspaceId),
    ...Object.keys(localState?.state?.sessionOrderByWorkspace ?? {}),
    ...Object.keys(fileState?.state?.sessionOrderByWorkspace ?? {}),
  ]);

  const sessionOrderByWorkspace = workspaceIds.reduce<Record<string, string[]>>((acc, workspaceId) => {
    const preferred = (localState?.state?.sessionOrderByWorkspace?.[workspaceId] ?? [])
      .filter((id) => validIds.has(id));
    const fallback = (fileState?.state?.sessionOrderByWorkspace?.[workspaceId] ?? [])
      .filter((id) => validIds.has(id));
    const owned = mergedSessions
      .filter((session) => session.workspaceId === workspaceId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((session) => session.id);
    const mergedOrder = uniqueStrings([...preferred, ...fallback, ...owned]);

    if (mergedOrder.length > 0) {
      acc[workspaceId] = mergedOrder;
    }
    return acc;
  }, {});

  const activeSessionId = [localState?.state?.activeSessionId, fileState?.state?.activeSessionId]
    .find((id): id is string => !!id && validIds.has(id))
    ?? mergedSessions[0]?.id
    ?? null;

  return JSON.stringify({
    state: {
      sessions: mergedSessions,
      activeSessionId,
      sessionOrderByWorkspace,
    },
    version: localState?.version ?? fileState?.version ?? 0,
  });
}

function mergeWorkspaceValue(
  fileValue: string | null,
  localValue: string | null,
  deletedWorkspaceIds: Set<string>
): string | null {
  const fileState = parseJson<PersistedWorkspacesState>(fileValue);
  const localState = parseJson<PersistedWorkspacesState>(localValue);
  if (!fileState && !localState) {
    return localValue ?? fileValue ?? null;
  }

  const shouldKeepWorkspace = (workspace: PersistedWorkspaceLike) =>
    !!workspace?.id && !deletedWorkspaceIds.has(workspace.id);

  const sortByOrder = <T extends { order?: number }>(items: T[]) =>
    [...items].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  const localWorkspaces = sortByOrder((localState?.state?.workspaces ?? []).filter(shouldKeepWorkspace));
  const fileWorkspaces = sortByOrder((fileState?.state?.workspaces ?? []).filter(shouldKeepWorkspace));
  const mergedWorkspaces = [...localWorkspaces];
  const existingIds = new Set(localWorkspaces.map((workspace) => workspace.id));

  fileWorkspaces.forEach((workspace) => {
    if (existingIds.has(workspace.id)) return;
    existingIds.add(workspace.id);
    mergedWorkspaces.push(workspace);
  });

  const normalizedWorkspaces = mergedWorkspaces.map((workspace, index) => ({
    ...workspace,
    order: index,
  }));
  const validIds = new Set(normalizedWorkspaces.map((workspace) => workspace.id));
  const activeWorkspaceId = [localState?.state?.activeWorkspaceId, fileState?.state?.activeWorkspaceId]
    .find((id): id is string => !!id && validIds.has(id))
    ?? normalizedWorkspaces[0]?.id
    ?? null;

  return JSON.stringify({
    state: {
      workspaces: normalizedWorkspaces,
      activeWorkspaceId,
    },
    version: localState?.version ?? fileState?.version ?? 0,
  });
}

function mergePersistedValue(
  key: PersistKey,
  fileValue: string | null,
  localValue: string | null,
  deletedState: DeletedUiState
): string | null {
  const deletedSessionIds = new Set(deletedState.sessionIds ?? []);
  const deletedWorkspaceIds = new Set(deletedState.workspaceIds ?? []);

  switch (key) {
    case "code-bar-sessions":
      return mergeSessionValue(fileValue, localValue, {
        sessionIds: deletedSessionIds,
        workspaceIds: deletedWorkspaceIds,
      });
    case "code-bar-workspaces":
      return mergeWorkspaceValue(fileValue, localValue, deletedWorkspaceIds);
    case "code-bar-settings":
      return localValue ?? fileValue ?? null;
    default:
      return localValue ?? fileValue ?? null;
  }
}

export async function bootstrapPersistState(): Promise<void> {
  if (typeof window === "undefined" || !("localStorage" in window)) return;

  const fromFile = await invokeSafe<Record<string, string | null>>("load_ui_states", {
    keys: [...PERSIST_KEYS],
  });
  const deletedState = (await invokeSafe<DeletedUiState>("load_deleted_ui_state", {})) ?? {};

  for (const key of PERSIST_KEYS) {
    const fileValue = fromFile?.[key] ?? null;
    const localValue = window.localStorage.getItem(key);
    const mergedValue = mergePersistedValue(key, fileValue, localValue, deletedState);

    if (mergedValue !== null) {
      if (window.localStorage.getItem(key) !== mergedValue) {
        window.localStorage.setItem(key, mergedValue);
      }
      if (fileValue !== mergedValue) {
        void invokeSafe("save_ui_state", { key, value: mergedValue });
      }
      continue;
    }

    if (localValue !== null) {
      void invokeSafe("save_ui_state", { key, value: localValue });
    }
  }
}

export const mirroredPersistStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined" || !("localStorage" in window)) return null;
    return window.localStorage.getItem(name);
  },

  setItem: (name, value) => {
    if (typeof window === "undefined" || !("localStorage" in window)) return;

    window.localStorage.setItem(name, value);
    void invokeSafe("save_ui_state", { key: name, value });
  },

  removeItem: (name) => {
    if (typeof window === "undefined" || !("localStorage" in window)) return;

    window.localStorage.removeItem(name);
    void invokeSafe("remove_ui_state", { key: name });
  },
};
