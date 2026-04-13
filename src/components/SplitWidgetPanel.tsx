import { useMemo } from "react";
import { CSS } from "@dnd-kit/utilities";
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { PtyTerminal } from "./PtyTerminal";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

function DragHandleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1" />
      <circle cx="3" cy="6" r="1" />
      <circle cx="3" cy="9" r="1" />
      <circle cx="7" cy="3" r="1" />
      <circle cx="7" cy="6" r="1" />
      <circle cx="7" cy="9" r="1" />
    </svg>
  );
}

function DraggableTerminalWidget({
  id,
  x,
  y,
  width,
  height,
  terminalWorkdir,
  sessionId,
  onClose,
}: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  terminalWorkdir: string;
  sessionId: string;
  onClose: () => void;
}) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = {
    position: "absolute" as const,
    left: x,
    top: y,
    width,
    height,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 10 : 1,
    display: "flex",
    flexDirection: "column" as const,
    borderRadius: 14,
    overflow: "hidden",
    background: isGlass ? "var(--ci-toolbar-bg)" : "var(--ci-surface-hi)",
    border: "1px solid var(--ci-toolbar-border)",
    boxShadow: isDragging ? "var(--ci-card-shadow-strong)" : "var(--ci-card-shadow)",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...listeners}
        {...attributes}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px 6px",
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
          background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          color: "var(--ci-text-muted)",
        }}>
          <span style={{ display: "inline-flex", flexShrink: 0 }}><DragHandleIcon /></span>
          <span style={{
            fontSize: 10,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}>
            {terminalWorkdir}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--ci-text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <PtyTerminal
          sessionId={sessionId}
          command={navigator.userAgent.toLowerCase().includes("windows") ? "cmd.exe" : "zsh"}
          args={[]}
          workdir={terminalWorkdir}
          active
        />
      </div>
    </div>
  );
}

export function SplitWidgetPanel() {
  const { settings, patchSettings } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const session = useMemo(
    () => sessions.find((item) => item.id === expandedSessionId) ?? null,
    [expandedSessionId, sessions]
  );
  const terminalWorkdir = session?.worktreePath ?? session?.workdir ?? "";
  const widget = settings.splitWidgetCanvas.items.find((item) => item.type === "terminal" && item.visible !== false) ?? null;

  return (
    <div style={{
      width: "100%",
      height: "100%",
      position: "relative",
      overflow: "hidden",
      background: isGlass ? "transparent" : "var(--ci-surface)",
    }}>
      <div style={{
        position: "absolute",
        top: 10,
        right: 14,
        zIndex: 20,
      }}>
        <button
          onClick={() => patchSettings({ splitWidgetPanelCollapsed: true })}
          style={{
            background: "none",
            border: "none",
            color: "var(--ci-text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
          }}
        >
          收起
        </button>
      </div>

      {session && terminalWorkdir && widget ? (
        <DndContext
          sensors={sensors}
          onDragEnd={({ delta }) => {
            const nextX = Math.max(0, widget.x + delta.x);
            const nextY = Math.max(0, widget.y + delta.y);
            patchSettings({
              splitWidgetCanvas: {
                items: settings.splitWidgetCanvas.items.map((item) =>
                  item.id === widget.id ? { ...item, x: nextX, y: nextY } : item
                ),
              },
            });
          }}
        >
          <DraggableTerminalWidget
            id={widget.id}
            x={widget.x}
            y={widget.y}
            width={widget.width}
            height={widget.height}
            terminalWorkdir={terminalWorkdir}
            sessionId={`widget-${session.id}`}
            onClose={() => patchSettings({ splitWidgetPanelCollapsed: true })}
          />
        </DndContext>
      ) : (
        <div style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            maxWidth: 220,
            padding: "18px 20px",
            borderRadius: 16,
            background: "var(--ci-surface-hi)",
            border: "1px solid var(--ci-toolbar-border)",
            color: "var(--ci-text-dim)",
            fontSize: 12,
            textAlign: "center",
            lineHeight: 1.7,
          }}>
            先在中间打开一个会话，右侧会出现可拖拽的 terminal 小组件。
          </div>
        </div>
      )}
    </div>
  );
}
