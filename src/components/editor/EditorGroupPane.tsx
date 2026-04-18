import { useDroppable } from "@dnd-kit/core";
import { useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { EditorHost } from "./EditorHost";
import { EditorTabs } from "./EditorTabs";

export interface EditorSplitDropData {
  type: "editor-split";
  sessionId: string;
  groupId: string;
  side: "left" | "right";
}

export function EditorGroupPane({
  session,
  groupId,
  showSplitTargets,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  groupId: string;
  showSplitTargets: boolean;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const leftDrop = useDroppable({
    id: `editor-split:${groupId}:left`,
    data: session
      ? ({
          type: "editor-split",
          sessionId: session.id,
          groupId,
          side: "left",
        } satisfies EditorSplitDropData)
      : undefined,
  });
  const rightDrop = useDroppable({
    id: `editor-split:${groupId}:right`,
    data: session
      ? ({
          type: "editor-split",
          sessionId: session.id,
          groupId,
          side: "right",
        } satisfies EditorSplitDropData)
      : undefined,
  });

  return (
    <div
      onPointerDown={() => {
        if (session) {
          setActiveGroup(session.id, groupId);
        }
      }}
      style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}
    >
      <EditorTabs session={session} groupId={groupId} />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <EditorHost session={session} groupId={groupId} onRefreshDiff={onRefreshDiff} />
        {showSplitTargets && (
          <>
            <div
              ref={leftDrop.setNodeRef}
              style={{
                position: "absolute",
                inset: 0,
                width: "50%",
                borderRight: "1px dashed var(--ci-toolbar-border)",
                background: leftDrop.isOver ? "var(--ci-accent-bg)" : "transparent",
                boxShadow: leftDrop.isOver ? "inset 0 0 0 1px var(--ci-accent-bdr)" : "none",
                pointerEvents: "none",
              }}
            />
            <div
              ref={rightDrop.setNodeRef}
              style={{
                position: "absolute",
                inset: 0,
                left: "50%",
                width: "50%",
                background: rightDrop.isOver ? "var(--ci-accent-bg)" : "transparent",
                boxShadow: rightDrop.isOver ? "inset 0 0 0 1px var(--ci-accent-bdr)" : "none",
                pointerEvents: "none",
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
