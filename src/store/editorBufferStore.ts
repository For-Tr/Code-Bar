import { create } from "zustand";

export interface EditorBufferState {
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

interface EditorBufferStore {
  buffersByTabId: Record<string, EditorBufferState>;

  patchBuffer: (tabId: string, patch: Partial<EditorBufferState>) => void;
  updateDraft: (tabId: string, content: string) => void;
  markSaved: (tabId: string, content: string, versionToken: string | null) => void;
  removeBuffer: (tabId: string) => void;
}

function defaultBufferState(): EditorBufferState {
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

export const useEditorBufferStore = create<EditorBufferStore>()((set) => ({
  buffersByTabId: {},

  patchBuffer: (tabId, patch) => set((state) => ({
    buffersByTabId: {
      ...state.buffersByTabId,
      [tabId]: {
        ...(state.buffersByTabId[tabId] ?? defaultBufferState()),
        ...patch,
      },
    },
  })),

  updateDraft: (tabId, content) => set((state) => {
    const current = state.buffersByTabId[tabId] ?? defaultBufferState();
    return {
      buffersByTabId: {
        ...state.buffersByTabId,
        [tabId]: {
          ...current,
          content,
          dirty: content !== current.originalContent,
          error: null,
        },
      },
    };
  }),

  markSaved: (tabId, content, versionToken) => set((state) => ({
    buffersByTabId: {
      ...state.buffersByTabId,
      [tabId]: {
        ...(state.buffersByTabId[tabId] ?? defaultBufferState()),
        content,
        originalContent: content,
        versionToken,
        loaded: true,
        saving: false,
        dirty: false,
        error: null,
        missing: false,
      },
    },
  })),

  removeBuffer: (tabId) => set((state) => {
    if (!state.buffersByTabId[tabId]) return {};
    const buffersByTabId = { ...state.buffersByTabId };
    delete buffersByTabId[tabId];
    return { buffersByTabId };
  }),
}));
