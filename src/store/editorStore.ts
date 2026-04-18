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

export interface EditorGroup {
  id: string;
  sessionId: string;
  tabIds: string[];
  activeTabId: string | null;
}

interface EditorStore {
  tabsById: Record<string, EditorTab>;
  groupsById: Record<string, EditorGroup>;
  groupOrderBySessionId: Record<string, string[]>;
  activeGroupIdBySessionId: Record<string, string | null>;

  ensureSessionGroup: (sessionId: string) => string;
  openFile: (sessionId: string, path: string, preview?: boolean) => string;
  openDiff: (sessionId: string, path: string) => string;
  closeTab: (tabId: string) => void;
  setActiveGroup: (sessionId: string, groupId: string) => void;
  setActiveTab: (groupId: string, tabId: string | null) => void;
  pinTab: (tabId: string) => void;
  reorderTabInGroup: (groupId: string, activeTabId: string, overTabId: string) => void;
  moveTabToGroup: (tabId: string, sourceGroupId: string, targetGroupId: string, index?: number) => void;
  splitGroupWithTab: (sourceGroupId: string, tabId: string, side: "left" | "right") => void;
  removeEmptyGroup: (groupId: string) => void;
}

function buildTabId(sessionId: string, path: string, viewMode: EditorViewMode) {
  return `${viewMode}:${sessionId}:${path}`;
}

function buildGroupId(sessionId: string) {
  return `group:${sessionId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function createEditorGroup(sessionId: string): EditorGroup {
  return {
    id: buildGroupId(sessionId),
    sessionId,
    tabIds: [],
    activeTabId: null,
  };
}

function getSessionGroupIds(
  groupsById: Record<string, EditorGroup>,
  groupOrderBySessionId: Record<string, string[]>,
  sessionId: string
) {
  return (groupOrderBySessionId[sessionId] ?? []).filter((groupId) => groupsById[groupId]?.sessionId === sessionId);
}

export function getSessionEditorGroupIds(
  groupsById: Record<string, EditorGroup>,
  groupOrderBySessionId: Record<string, string[]>,
  sessionId: string
) {
  return getSessionGroupIds(groupsById, groupOrderBySessionId, sessionId);
}

export function getSessionEditorTabIds(
  groupsById: Record<string, EditorGroup>,
  groupOrderBySessionId: Record<string, string[]>,
  sessionId: string
) {
  return getSessionGroupIds(groupsById, groupOrderBySessionId, sessionId).flatMap((groupId) => groupsById[groupId]?.tabIds ?? []);
}

export function findEditorGroupIdByTabId(groupsById: Record<string, EditorGroup>, tabId: string) {
  return Object.values(groupsById).find((group) => group.tabIds.includes(tabId))?.id ?? null;
}

function clampInsertIndex(length: number, index?: number) {
  if (typeof index !== "number" || Number.isNaN(index)) return length;
  return Math.max(0, Math.min(index, length));
}

function pickFallbackTabId(tabIds: string[], removedIndex: number) {
  return tabIds[Math.max(0, removedIndex - 1)] ?? tabIds[removedIndex] ?? tabIds[tabIds.length - 1] ?? null;
}

function moveIdBefore(ids: string[], activeId: string, overId: string) {
  const nextIds = ids.filter((id) => id !== activeId);
  const overIndex = nextIds.indexOf(overId);
  if (overIndex === -1) return ids;
  nextIds.splice(overIndex, 0, activeId);
  return nextIds;
}

function normalizeSessionGroups(
  groupsById: Record<string, EditorGroup>,
  groupOrderBySessionId: Record<string, string[]>,
  activeGroupIdBySessionId: Record<string, string | null>,
  sessionId: string
) {
  let groupIds = getSessionGroupIds(groupsById, groupOrderBySessionId, sessionId);
  if (groupIds.length === 0) {
    const group = createEditorGroup(sessionId);
    groupsById[group.id] = group;
    groupIds = [group.id];
    groupOrderBySessionId[sessionId] = groupIds;
    activeGroupIdBySessionId[sessionId] = group.id;
    return group.id;
  }

  const activeGroupId = activeGroupIdBySessionId[sessionId];
  if (!activeGroupId || !groupIds.includes(activeGroupId)) {
    activeGroupIdBySessionId[sessionId] = groupIds[0] ?? null;
  }
  return activeGroupIdBySessionId[sessionId] ?? groupIds[0] ?? null;
}

function removeGroupIfPossible(
  groupsById: Record<string, EditorGroup>,
  groupOrderBySessionId: Record<string, string[]>,
  activeGroupIdBySessionId: Record<string, string | null>,
  groupId: string
) {
  const group = groupsById[groupId];
  if (!group || group.tabIds.length > 0) return;

  const sessionId = group.sessionId;
  const groupIds = getSessionGroupIds(groupsById, groupOrderBySessionId, sessionId);
  if (groupIds.length <= 1) {
    groupsById[groupId] = { ...group, activeTabId: null };
    activeGroupIdBySessionId[sessionId] = groupId;
    return;
  }

  const groupIndex = groupIds.indexOf(groupId);
  const nextGroupIds = groupIds.filter((id) => id !== groupId);
  delete groupsById[groupId];
  groupOrderBySessionId[sessionId] = nextGroupIds;

  if (activeGroupIdBySessionId[sessionId] === groupId || !nextGroupIds.includes(activeGroupIdBySessionId[sessionId] ?? "")) {
    activeGroupIdBySessionId[sessionId] = nextGroupIds[Math.max(0, groupIndex - 1)] ?? nextGroupIds[0] ?? null;
  }
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabsById: {},
  groupsById: {},
  groupOrderBySessionId: {},
  activeGroupIdBySessionId: {},

  ensureSessionGroup: (sessionId) => {
    let ensuredGroupId = "";
    set((state) => {
      const groupsById = { ...state.groupsById };
      const groupOrderBySessionId = { ...state.groupOrderBySessionId };
      const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
      ensuredGroupId = normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, sessionId) ?? "";
      return { groupsById, groupOrderBySessionId, activeGroupIdBySessionId };
    });
    return ensuredGroupId;
  },

  openFile: (sessionId, path, preview = true) => {
    const tabId = buildTabId(sessionId, path, "code");
    const state = get();
    const tabsById = { ...state.tabsById };
    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    const activeGroupId = normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, sessionId);
    if (!activeGroupId) return tabId;

    const existing = tabsById[tabId];
    if (existing) {
      const existingGroupId = findEditorGroupIdByTabId(groupsById, tabId) ?? activeGroupId;
      const existingGroup = groupsById[existingGroupId];
      if (existingGroup) {
        groupsById[existingGroupId] = { ...existingGroup, activeTabId: tabId };
        activeGroupIdBySessionId[sessionId] = existingGroupId;
      }
      if (!preview && existing.preview) {
        tabsById[tabId] = { ...existing, preview: false, pinned: true };
      }
      set({ tabsById, groupsById, groupOrderBySessionId, activeGroupIdBySessionId });
      return tabId;
    }

    const targetGroup = groupsById[activeGroupId];
    if (!targetGroup) return tabId;
    const nextTargetGroup = { ...targetGroup, tabIds: [...targetGroup.tabIds] };
    const previewTabId = preview
      ? nextTargetGroup.tabIds.find((id) => tabsById[id]?.preview)
      : undefined;

    if (previewTabId) {
      delete tabsById[previewTabId];
      nextTargetGroup.tabIds = nextTargetGroup.tabIds.filter((id) => id !== previewTabId);
    }

    tabsById[tabId] = {
      id: tabId,
      sessionId,
      path,
      title: titleFromPath(path),
      preview,
      pinned: !preview,
      viewMode: "code",
    };
    nextTargetGroup.tabIds.push(tabId);
    nextTargetGroup.activeTabId = tabId;
    groupsById[activeGroupId] = nextTargetGroup;
    activeGroupIdBySessionId[sessionId] = activeGroupId;

    set({ tabsById, groupsById, groupOrderBySessionId, activeGroupIdBySessionId });
    return tabId;
  },

  openDiff: (sessionId, path) => {
    const tabId = buildTabId(sessionId, path, "diff");
    const state = get();
    const tabsById = { ...state.tabsById };
    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    const activeGroupId = normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, sessionId);
    if (!activeGroupId) return tabId;

    const existing = tabsById[tabId];
    if (existing) {
      const existingGroupId = findEditorGroupIdByTabId(groupsById, tabId) ?? activeGroupId;
      const existingGroup = groupsById[existingGroupId];
      if (existingGroup) {
        groupsById[existingGroupId] = { ...existingGroup, activeTabId: tabId };
        activeGroupIdBySessionId[sessionId] = existingGroupId;
      }
      set({ groupsById, groupOrderBySessionId, activeGroupIdBySessionId });
      return tabId;
    }

    const targetGroup = groupsById[activeGroupId];
    if (!targetGroup) return tabId;
    tabsById[tabId] = {
      id: tabId,
      sessionId,
      path,
      title: titleFromPath(path),
      preview: false,
      pinned: true,
      viewMode: "diff",
    };
    groupsById[activeGroupId] = {
      ...targetGroup,
      tabIds: [...targetGroup.tabIds, tabId],
      activeTabId: tabId,
    };
    activeGroupIdBySessionId[sessionId] = activeGroupId;

    set({ tabsById, groupsById, groupOrderBySessionId, activeGroupIdBySessionId });
    return tabId;
  },

  closeTab: (tabId) => set((state) => {
    const closingTab = state.tabsById[tabId];
    if (!closingTab) return {};

    const tabsById = { ...state.tabsById };
    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    const groupId = findEditorGroupIdByTabId(groupsById, tabId);
    delete tabsById[tabId];

    if (!groupId || !groupsById[groupId]) {
      return { tabsById };
    }

    const group = groupsById[groupId];
    const tabIndex = group.tabIds.indexOf(tabId);
    const nextTabIds = group.tabIds.filter((id) => id !== tabId);
    groupsById[groupId] = {
      ...group,
      tabIds: nextTabIds,
      activeTabId: group.activeTabId === tabId ? pickFallbackTabId(nextTabIds, tabIndex) : group.activeTabId,
    };

    removeGroupIfPossible(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, groupId);
    normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, closingTab.sessionId);

    return { tabsById, groupsById, groupOrderBySessionId, activeGroupIdBySessionId };
  }),

  setActiveGroup: (sessionId, groupId) => set((state) => {
    const group = state.groupsById[groupId];
    if (!group || group.sessionId !== sessionId) return {};
    if (state.activeGroupIdBySessionId[sessionId] === groupId) return {};
    return {
      activeGroupIdBySessionId: {
        ...state.activeGroupIdBySessionId,
        [sessionId]: groupId,
      },
    };
  }),

  setActiveTab: (groupId, tabId) => set((state) => {
    const group = state.groupsById[groupId];
    if (!group) return {};
    if (tabId && !group.tabIds.includes(tabId)) return {};
    if (group.activeTabId === tabId && state.activeGroupIdBySessionId[group.sessionId] === groupId) return {};
    return {
      groupsById: {
        ...state.groupsById,
        [groupId]: {
          ...group,
          activeTabId: tabId,
        },
      },
      activeGroupIdBySessionId: {
        ...state.activeGroupIdBySessionId,
        [group.sessionId]: groupId,
      },
    };
  }),

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

  reorderTabInGroup: (groupId, activeTabId, overTabId) => set((state) => {
    if (activeTabId === overTabId) return {};
    const group = state.groupsById[groupId];
    if (!group || !group.tabIds.includes(activeTabId) || !group.tabIds.includes(overTabId)) return {};
    const nextTabIds = moveIdBefore(group.tabIds, activeTabId, overTabId);
    if (nextTabIds === group.tabIds) return {};
    return {
      groupsById: {
        ...state.groupsById,
        [groupId]: {
          ...group,
          tabIds: nextTabIds,
        },
      },
      activeGroupIdBySessionId: {
        ...state.activeGroupIdBySessionId,
        [group.sessionId]: groupId,
      },
    };
  }),

  moveTabToGroup: (tabId, sourceGroupId, targetGroupId, index) => set((state) => {
    if (sourceGroupId === targetGroupId) return {};
    const sourceGroup = state.groupsById[sourceGroupId];
    const targetGroup = state.groupsById[targetGroupId];
    if (!sourceGroup || !targetGroup || sourceGroup.sessionId !== targetGroup.sessionId) return {};
    if (!sourceGroup.tabIds.includes(tabId)) return {};

    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    const sourceTabIndex = sourceGroup.tabIds.indexOf(tabId);
    const nextSourceTabIds = sourceGroup.tabIds.filter((id) => id !== tabId);
    const nextTargetTabIds = targetGroup.tabIds.filter((id) => id !== tabId);
    nextTargetTabIds.splice(clampInsertIndex(nextTargetTabIds.length, index), 0, tabId);

    groupsById[sourceGroupId] = {
      ...sourceGroup,
      tabIds: nextSourceTabIds,
      activeTabId: sourceGroup.activeTabId === tabId ? pickFallbackTabId(nextSourceTabIds, sourceTabIndex) : sourceGroup.activeTabId,
    };
    groupsById[targetGroupId] = {
      ...targetGroup,
      tabIds: nextTargetTabIds,
      activeTabId: tabId,
    };
    activeGroupIdBySessionId[sourceGroup.sessionId] = targetGroupId;

    removeGroupIfPossible(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, sourceGroupId);
    normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, sourceGroup.sessionId);

    return { groupsById, groupOrderBySessionId, activeGroupIdBySessionId };
  }),

  splitGroupWithTab: (sourceGroupId, tabId, side) => set((state) => {
    const sourceGroup = state.groupsById[sourceGroupId];
    if (!sourceGroup || !sourceGroup.tabIds.includes(tabId)) return {};
    const sessionId = sourceGroup.sessionId;
    const sessionGroupIds = getSessionGroupIds(state.groupsById, state.groupOrderBySessionId, sessionId);
    if (sessionGroupIds.length >= 2) return {};

    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    const sourceTabIndex = sourceGroup.tabIds.indexOf(tabId);
    const nextSourceTabIds = sourceGroup.tabIds.filter((id) => id !== tabId);
    const nextSourceGroup: EditorGroup = {
      ...sourceGroup,
      tabIds: nextSourceTabIds,
      activeTabId: sourceGroup.activeTabId === tabId ? pickFallbackTabId(nextSourceTabIds, sourceTabIndex) : sourceGroup.activeTabId,
    };
    const nextGroup = createEditorGroup(sessionId);
    nextGroup.tabIds = [tabId];
    nextGroup.activeTabId = tabId;

    groupsById[sourceGroupId] = nextSourceGroup;
    groupsById[nextGroup.id] = nextGroup;

    const sourceIndex = sessionGroupIds.indexOf(sourceGroupId);
    const nextGroupIds = [...sessionGroupIds];
    nextGroupIds.splice(side === "left" ? sourceIndex : sourceIndex + 1, 0, nextGroup.id);
    groupOrderBySessionId[sessionId] = nextGroupIds;
    activeGroupIdBySessionId[sessionId] = nextGroup.id;

    return { groupsById, groupOrderBySessionId, activeGroupIdBySessionId };
  }),

  removeEmptyGroup: (groupId) => set((state) => {
    const group = state.groupsById[groupId];
    if (!group || group.tabIds.length > 0) return {};

    const groupsById = { ...state.groupsById };
    const groupOrderBySessionId = { ...state.groupOrderBySessionId };
    const activeGroupIdBySessionId = { ...state.activeGroupIdBySessionId };
    removeGroupIfPossible(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, groupId);
    normalizeSessionGroups(groupsById, groupOrderBySessionId, activeGroupIdBySessionId, group.sessionId);
    return { groupsById, groupOrderBySessionId, activeGroupIdBySessionId };
  }),
}));
