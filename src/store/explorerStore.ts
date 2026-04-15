import { create } from "zustand";

export interface ExplorerEditorTab {
  key: string;
  sessionId: string;
  path: string;
  title: string;
  preview: boolean;
}

export interface ExplorerFileState {
  content: string;
  originalContent: string;
  versionToken: string | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  isBinary: boolean;
  missing: boolean;
}

interface ExplorerStore {
  expandedDirsBySession: Record<string, string[]>;
  selectedPathBySession: Record<string, string | null>;
  openTabs: ExplorerEditorTab[];
  activeTabKey: string | null;
  fileStateByKey: Record<string, ExplorerFileState>;

  setExpandedDirs: (sessionId: string, dirs: string[]) => void;
  toggleDir: (sessionId: string, dir: string) => void;
  setSelectedPath: (sessionId: string, path: string | null) => void;
  openTab: (sessionId: string, path: string, preview?: boolean) => string;
  closeTab: (key: string) => void;
  setActiveTab: (key: string | null) => void;
  patchFileState: (key: string, patch: Partial<ExplorerFileState>) => void;
  updateDraft: (key: string, content: string) => void;
  markSaved: (key: string, content: string, versionToken: string | null) => void;
}

function tabKey(sessionId: string, path: string) {
  return `${sessionId}:${path}`;
}

function titleFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function defaultFileState(): ExplorerFileState {
  return {
    content: "",
    originalContent: "",
    versionToken: null,
    loaded: false,
    loading: false,
    saving: false,
    dirty: false,
    error: null,
    isBinary: false,
    missing: false,
  };
}

export const useExplorerStore = create<ExplorerStore>()((set, get) => ({
  expandedDirsBySession: {},
  selectedPathBySession: {},
  openTabs: [],
  activeTabKey: null,
  fileStateByKey: {},

  setExpandedDirs: (sessionId, dirs) =>
    set((state) => ({
      expandedDirsBySession: {
        ...state.expandedDirsBySession,
        [sessionId]: [...new Set(dirs)].sort(),
      },
    })),

  toggleDir: (sessionId, dir) =>
    set((state) => {
      const current = new Set(state.expandedDirsBySession[sessionId] ?? []);
      if (current.has(dir)) {
        current.delete(dir);
      } else {
        current.add(dir);
      }
      return {
        expandedDirsBySession: {
          ...state.expandedDirsBySession,
          [sessionId]: [...current].sort(),
        },
      };
    }),

  setSelectedPath: (sessionId, path) =>
    set((state) => ({
      selectedPathBySession: {
        ...state.selectedPathBySession,
        [sessionId]: path,
      },
    })),

  openTab: (sessionId, path, preview = true) => {
    const key = tabKey(sessionId, path);
    const state = get();
    const existing = state.openTabs.find((tab) => tab.key === key);
    if (existing) {
      set({
        activeTabKey: key,
        openTabs: state.openTabs.map((tab) => {
          if (tab.key !== key) return tab;
          return { ...tab, preview: preview ? tab.preview : false };
        }),
      });
      return key;
    }

    const previewIndex = preview ? state.openTabs.findIndex((tab) => tab.preview) : -1;
    const nextTab: ExplorerEditorTab = {
      key,
      sessionId,
      path,
      title: titleFromPath(path),
      preview,
    };

    const nextTabs = [...state.openTabs];
    if (previewIndex >= 0) {
      nextTabs.splice(previewIndex, 1, nextTab);
    } else {
      nextTabs.push(nextTab);
    }

    set((current) => ({
      openTabs: nextTabs,
      activeTabKey: key,
      fileStateByKey: current.fileStateByKey[key]
        ? current.fileStateByKey
        : { ...current.fileStateByKey, [key]: defaultFileState() },
    }));
    return key;
  },

  closeTab: (key) =>
    set((state) => {
      const nextTabs = state.openTabs.filter((tab) => tab.key !== key);
      const activeTabKey = state.activeTabKey === key
        ? (nextTabs[nextTabs.length - 1]?.key ?? null)
        : state.activeTabKey;
      const nextFileState = { ...state.fileStateByKey };
      delete nextFileState[key];
      return {
        openTabs: nextTabs,
        activeTabKey,
        fileStateByKey: nextFileState,
      };
    }),

  setActiveTab: (key) => set({ activeTabKey: key }),

  patchFileState: (key, patch) =>
    set((state) => ({
      fileStateByKey: {
        ...state.fileStateByKey,
        [key]: {
          ...(state.fileStateByKey[key] ?? defaultFileState()),
          ...patch,
        },
      },
    })),

  updateDraft: (key, content) =>
    set((state) => {
      const current = state.fileStateByKey[key] ?? defaultFileState();
      return {
        fileStateByKey: {
          ...state.fileStateByKey,
          [key]: {
            ...current,
            content,
            dirty: content !== current.originalContent,
            error: null,
          },
        },
      };
    }),

  markSaved: (key, content, versionToken) =>
    set((state) => ({
      fileStateByKey: {
        ...state.fileStateByKey,
        [key]: {
          ...(state.fileStateByKey[key] ?? defaultFileState()),
          content,
          originalContent: content,
          versionToken,
          dirty: false,
          loaded: true,
          saving: false,
          error: null,
          missing: false,
        },
      },
    })),

}));
