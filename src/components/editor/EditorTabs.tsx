import { useMemo, type CSSProperties } from "react";
import { FileCode2, GitCommitHorizontal, X } from "lucide-react";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { closeTab, revealExplorerPath } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useEditorStore, type EditorGroup, type EditorViewMode } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { WorkbenchTooltip } from "../ui/WorkbenchTooltip";

export interface EditorTabDragData {
  type: "editor-tab";
  sessionId: string;
  groupId: string;
  tabId: string;
  title: string;
  path: string;
  viewMode: EditorViewMode;
}

export interface EditorTabStripDropData {
  type: "editor-tab-strip";
  sessionId: string;
  groupId: string;
}

function EditorTabPreview({
  title,
  path,
  viewMode,
  dirty,
  preview,
}: {
  title: string;
  path: string;
  viewMode: EditorViewMode;
  dirty?: boolean;
  preview?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        maxWidth: 220,
        padding: "7px 10px 6px",
        border: "1px solid var(--ci-accent-bdr)",
        borderTopColor: "var(--ci-accent)",
        background: "var(--ci-surface)",
        color: "var(--ci-text)",
        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
        borderRadius: 8,
      }}
      title={path}
    >
      <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: viewMode === "diff" ? "var(--ci-purple)" : "var(--ci-text-dim)", flexShrink: 0 }}>
        {viewMode === "diff" ? <GitCommitHorizontal size={11} strokeWidth={1.8} /> : <FileCode2 size={11} strokeWidth={1.8} />}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{title}</span>
      {dirty && <span style={{ color: "var(--ci-accent)", fontSize: 10, flexShrink: 0 }}>●</span>}
      {preview && <span style={{ color: "var(--ci-text-dim)", fontSize: 9, flexShrink: 0 }}>preview</span>}
    </div>
  );
}

function SortableEditorTab({
  session,
  group,
  tabId,
  isActive,
}: {
  session: ClaudeSession;
  group: EditorGroup;
  tabId: string;
  isActive: boolean;
}) {
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const pinTab = useEditorStore((s) => s.pinTab);
  const dirty = useEditorBufferStore((s) => s.buffersByTabId[tabId]?.dirty === true);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tabId,
    data: {
      type: "editor-tab",
      sessionId: session.id,
      groupId: group.id,
      tabId,
      title: tab?.title ?? "",
      path: tab?.path ?? "",
      viewMode: tab?.viewMode ?? "code",
    } satisfies EditorTabDragData,
  });

  if (!tab) return null;

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    maxWidth: 220,
    padding: "0 10px",
    borderRight: "1px solid var(--ci-toolbar-border)",
    borderTop: isActive ? "1px solid var(--ci-accent)" : "1px solid transparent",
    background: isActive ? "var(--ci-surface)" : "transparent",
    opacity: isDragging ? 0.28 : 1,
    position: "relative",
    zIndex: isDragging ? 2 : 1,
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        onClick={() => {
          setActiveTab(group.id, tabId);
          if (tab.viewMode === "code") {
            revealExplorerPath(session.id, tab.path, "focusNoScroll", "editor-tabs");
          }
        }}
        onDoubleClick={() => pinTab(tabId)}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          padding: "7px 0 6px",
          color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 11,
        }}
        title={tab.path}
      >
        <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: tab.viewMode === "diff" ? "var(--ci-purple)" : "var(--ci-text-dim)", flexShrink: 0 }}>
          {tab.viewMode === "diff" ? <GitCommitHorizontal size={11} strokeWidth={1.8} /> : <FileCode2 size={11} strokeWidth={1.8} />}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title}</span>
        {dirty && <span style={{ color: "var(--ci-accent)", fontSize: 10, flexShrink: 0 }}>●</span>}
        {tab.preview && <span style={{ color: "var(--ci-text-dim)", fontSize: 9, flexShrink: 0 }}>preview</span>}
      </button>
      <WorkbenchTooltip label={`关闭 ${tab.title}`}>
        <button
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            closeTab(tabId);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--ci-text-dim)",
            cursor: "pointer",
            padding: 0,
            width: 16,
            height: 16,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: isActive ? 0.9 : 0.5,
          }}
          title={`关闭 ${tab.title}`}
        >
          <X size={12} strokeWidth={1.8} />
        </button>
      </WorkbenchTooltip>
    </div>
  );
}

export function EditorTabs({
  session,
  groupId,
}: {
  session: ClaudeSession | null;
  groupId: string;
}) {
  const group = useEditorStore((s) => s.groupsById[groupId]);
  const tabsById = useEditorStore((s) => s.tabsById);
  const { setNodeRef, isOver } = useDroppable({
    id: `editor-tab-strip:${groupId}`,
    data: session
      ? ({
          type: "editor-tab-strip",
          sessionId: session.id,
          groupId,
        } satisfies EditorTabStripDropData)
      : undefined,
  });

  const openTabs = useMemo(() => {
    if (!group) return [] as string[];
    return group.tabIds.filter((tabId) => tabsById[tabId]);
  }, [group, tabsById]);
  const resolvedActiveTabId = group?.activeTabId && openTabs.includes(group.activeTabId)
    ? group.activeTabId
    : (openTabs[openTabs.length - 1] ?? null);

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        alignItems: "stretch",
        minHeight: 34,
        borderBottom: "1px solid var(--ci-toolbar-border)",
        overflowX: "auto",
        scrollbarWidth: "none",
        background: isOver ? "var(--ci-accent-bg)" : "var(--ci-toolbar-bg)",
      }}
    >
      {session && group ? (
        <SortableContext items={openTabs} strategy={horizontalListSortingStrategy}>
          {openTabs.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", padding: "0 14px", fontSize: 11, color: isOver ? "var(--ci-accent)" : "var(--ci-text-dim)" }}>
              {isOver ? "释放到此组" : "未打开文件"}
            </div>
          ) : openTabs.map((tabId) => (
            <SortableEditorTab
              key={tabId}
              session={session}
              group={group}
              tabId={tabId}
              isActive={resolvedActiveTabId === tabId}
            />
          ))}
        </SortableContext>
      ) : (
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px", fontSize: 11, color: "var(--ci-text-dim)" }}>
          未打开文件
        </div>
      )}
    </div>
  );
}

export { EditorTabPreview };
