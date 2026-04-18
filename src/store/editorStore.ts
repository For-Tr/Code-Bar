import { create } from "zustand";

export type EditorViewMode = "code" | "diff";

export interface EditorTab {
  id: string;
  sessionId: string;
  path: string;
  title: string;
  preview: boolean;
  pinned: boolean;
  viewMode: EditorViewMode;
}

interface EditorStore {
  tabsById: Record<string, EditorTab>;
  tabOrder: string[];
  activeTabId: string | null;

  openFile: (sessionId: string, path: string, preview?: boolean) => string;
  openDiff: (sessionId: string, path: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  pinTab: (tabId: string) => void;
}

function buildTabId(sessionId: string, path: string, viewMode: EditorViewMode) {
  return `${viewMode}:${sessionId}:${path}`;
}

function titleFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function getSessionTabIds(tabOrder: string[], tabsById: Record<string, EditorTab>, sessionId: string) {
  return tabOrder.filter((tabId) => tabsById[tabId]?.sessionId === sessionId);
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabsById: {},
  tabOrder: [],
  activeTabId: null,

  openFile: (sessionId, path, preview = true) => {
    const tabId = buildTabId(sessionId, path, "code");
    const state = get();
    const existing = state.tabsById[tabId];
    if (existing) {
      if (state.activeTabId !== tabId || (!preview && existing.preview)) {
        set({
          activeTabId: tabId,
          tabsById: {
            ...state.tabsById,
            [tabId]: { ...existing, preview: preview ? existing.preview : false },
          },
        });
      }
      return tabId;
    }

    const previewTabId = preview
      ? state.tabOrder.find((id) => state.tabsById[id]?.preview && state.tabsById[id]?.sessionId === sessionId)
      : undefined;

    const tab: EditorTab = {
      id: tabId,
      sessionId,
      path,
      title: titleFromPath(path),
      preview,
      pinned: !preview,
      viewMode: "code",
    };

    const tabsById = { ...state.tabsById };
    let tabOrder = [...state.tabOrder];
    if (previewTabId) {
      delete tabsById[previewTabId];
      tabOrder = tabOrder.filter((id) => id !== previewTabId);
    }
    tabsById[tabId] = tab;
    tabOrder.push(tabId);

    set({ tabsById, tabOrder, activeTabId: tabId });
    return tabId;
  },

  openDiff: (sessionId, path) => {
    const tabId = buildTabId(sessionId, path, "diff");
    const state = get();
    if (state.tabsById[tabId]) {
      if (state.activeTabId !== tabId) {
        set({ activeTabId: tabId });
      }
      return tabId;
    }

    const tab: EditorTab = {
      id: tabId,
      sessionId,
      path,
      title: titleFromPath(path),
      preview: false,
      pinned: true,
      viewMode: "diff",
    };

    set({
      tabsById: { ...state.tabsById, [tabId]: tab },
      tabOrder: [...state.tabOrder, tabId],
      activeTabId: tabId,
    });
    return tabId;
  },

  closeTab: (tabId) => set((state) => {
    const closingTab = state.tabsById[tabId];
    if (!closingTab) return {};
    const tabsById = { ...state.tabsById };
    delete tabsById[tabId];
    const tabOrder = state.tabOrder.filter((id) => id !== tabId);
    let activeTabId = state.activeTabId;
    if (state.activeTabId === tabId) {
      const sameSessionTabs = getSessionTabIds(tabOrder, tabsById, closingTab.sessionId);
      activeTabId = sameSessionTabs[sameSessionTabs.length - 1] ?? (tabOrder[tabOrder.length - 1] ?? null);
    }
    return { tabsById, tabOrder, activeTabId };
  }),

  setActiveTab: (tabId) => set((state) => state.activeTabId === tabId ? {} : { activeTabId: tabId }),

  pinTab: (tabId) => set((state) => {
    const tab = state.tabsById[tabId];
    if (!tab || (!tab.preview && tab.pinned)) return {};
    return {
      tabsById: {
        ...state.tabsById,
        [tabId]: {
          ...tab,
          preview: false,
          pinned: true,
        },
      },
    };
  }),
}));
