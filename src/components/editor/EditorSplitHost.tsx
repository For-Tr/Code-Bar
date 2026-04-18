import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { type ClaudeSession } from "../../store/sessionStore";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { getSessionEditorGroupIds, useEditorStore } from "../../store/editorStore";
import { EditorGroupPane, type EditorSplitDropData } from "./EditorGroupPane";
import { EditorTabPreview, type EditorTabDragData, type EditorTabStripDropData } from "./EditorTabs";

type EditorDropData = EditorSplitDropData | EditorTabStripDropData | EditorTabDragData;

function readDropData(data: unknown): EditorDropData | null {
  if (!data || typeof data !== "object") return null;
  const value = data as { type?: unknown };
  if (value.type === "editor-split" || value.type === "editor-tab-strip" || value.type === "editor-tab") {
    return value as EditorDropData;
  }
  return null;
}

function readDragData(data: unknown): EditorTabDragData | null {
  if (!data || typeof data !== "object") return null;
  const value = data as { type?: unknown };
  if (value.type === "editor-tab") {
    return value as EditorTabDragData;
  }
  return null;
}

export function EditorSplitHost({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const tabsById = useEditorStore((s) => s.tabsById);
  const groupsById = useEditorStore((s) => s.groupsById);
  const groupOrderBySessionId = useEditorStore((s) => s.groupOrderBySessionId);
  const ensureSessionGroup = useEditorStore((s) => s.ensureSessionGroup);
  const reorderTabInGroup = useEditorStore((s) => s.reorderTabInGroup);
  const moveTabToGroup = useEditorStore((s) => s.moveTabToGroup);
  const splitGroupWithTab = useEditorStore((s) => s.splitGroupWithTab);
  const activeGroupIdBySessionId = useEditorStore((s) => s.activeGroupIdBySessionId);
  const [activeDrag, setActiveDrag] = useState<EditorTabDragData | null>(null);

  const dirtyByActiveDragTab = useEditorBufferStore((s) => activeDrag ? s.buffersByTabId[activeDrag.tabId]?.dirty === true : false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!session) return;
    ensureSessionGroup(session.id);
  }, [ensureSessionGroup, session]);

  const groupIds = useMemo(() => {
    if (!session) return [] as string[];
    return getSessionEditorGroupIds(groupsById, groupOrderBySessionId, session.id);
  }, [groupOrderBySessionId, groupsById, session]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag(readDragData(event.active.data.current));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragData = readDragData(event.active.data.current);
    const dropData = readDropData(event.over?.data.current);
    setActiveDrag(null);
    if (!dragData || !dropData || !session) return;
    if (dragData.sessionId !== session.id) return;

    if (dropData.type === "editor-split") {
      if (dropData.groupId !== dragData.groupId) return;
      splitGroupWithTab(dragData.groupId, dragData.tabId, dropData.side);
      return;
    }

    if (dropData.type === "editor-tab") {
      if (dropData.groupId === dragData.groupId) {
        reorderTabInGroup(dragData.groupId, dragData.tabId, dropData.tabId);
        return;
      }
      const targetGroup = groupsById[dropData.groupId];
      if (!targetGroup) return;
      const targetIndex = targetGroup.tabIds.indexOf(dropData.tabId);
      moveTabToGroup(dragData.tabId, dragData.groupId, dropData.groupId, targetIndex === -1 ? targetGroup.tabIds.length : targetIndex);
      return;
    }

    if (dropData.type !== "editor-tab-strip") return;
    if (dropData.groupId === dragData.groupId) return;

    const targetGroup = groupsById[dropData.groupId];
    if (!targetGroup) return;
    moveTabToGroup(dragData.tabId, dragData.groupId, dropData.groupId, targetGroup.tabIds.length);
  };

  const activeGroupId = session ? activeGroupIdBySessionId[session.id] ?? groupIds[0] ?? null : null;
  const collisionDetection = (args: Parameters<typeof pointerWithin>[0]) => {
    const pointerCollisions = pointerWithin(args);
    const splitCollision = pointerCollisions.find((collision) => collision.data?.droppableContainer.data.current?.type === "editor-split");
    if (splitCollision) return [splitCollision];
    const tabCollision = pointerCollisions.find((collision) => collision.data?.droppableContainer.data.current?.type === "editor-tab");
    if (tabCollision) return [tabCollision];
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCenter(args);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDrag(null)}>
      <div style={{ width: "100%", height: "100%", minHeight: 0, display: "flex", background: "var(--ci-surface)" }}>
        {groupIds.map((groupId, index) => (
          <div key={groupId} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: index < groupIds.length - 1 ? "1px solid var(--ci-toolbar-border)" : "none", boxShadow: activeGroupId === groupId && groupIds.length > 1 ? "inset 0 0 0 1px var(--ci-accent-bdr)" : "none" }}>
            <EditorGroupPane
              session={session}
              groupId={groupId}
              showSplitTargets={Boolean(activeDrag) && groupIds.length === 1}
              onRefreshDiff={onRefreshDiff}
            />
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <EditorTabPreview
            title={activeDrag.title}
            path={activeDrag.path}
            viewMode={activeDrag.viewMode}
            dirty={dirtyByActiveDragTab}
            preview={tabsById[activeDrag.tabId]?.preview}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
