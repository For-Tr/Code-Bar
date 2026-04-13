import { useMemo } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { PtyTerminal } from "./PtyTerminal";
import { DraggableCard } from "./DraggableCard";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

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
  const gridUnit = settings.splitWidgetCanvas.cellSize;

  return (
    <div style={{
      width: "100%",
      height: "100%",
      position: "relative",
      overflow: "hidden",
      backgroundColor: isGlass ? "transparent" : "var(--ci-surface)",
      backgroundImage: `radial-gradient(var(--ci-toolbar-border) 0.8px, transparent 0.8px)`,
      backgroundSize: `${gridUnit}px ${gridUnit}px`,
      backgroundPosition: `${gridUnit / 2}px ${gridUnit / 2}px`,
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
            const colDelta = Math.round(delta.x / gridUnit);
            const rowDelta = Math.round(delta.y / gridUnit);
            const nextCol = Math.max(1, widget.col + colDelta);
            const nextRow = Math.max(1, widget.row + rowDelta);
            patchSettings({
              splitWidgetCanvas: {
                ...settings.splitWidgetCanvas,
                items: settings.splitWidgetCanvas.items.map((item) =>
                  item.id === widget.id ? { ...item, col: nextCol, row: nextRow } : item
                ),
              },
            });
          }}
        >
          <DraggableCard
            id={widget.id}
            title={terminalWorkdir || "Terminal"}
            gridUnit={gridUnit}
            col={widget.col}
            row={widget.row}
            colSpan={widget.colSpan}
            rowSpan={widget.rowSpan}
            onGrow={() => patchSettings({
              splitWidgetCanvas: {
                ...settings.splitWidgetCanvas,
                items: settings.splitWidgetCanvas.items.map((item) =>
                  item.id === widget.id
                    ? { ...item, colSpan: item.colSpan + 2, rowSpan: item.rowSpan + 2 }
                    : item
                ),
              },
            })}
            onShrink={() => patchSettings({
              splitWidgetCanvas: {
                ...settings.splitWidgetCanvas,
                items: settings.splitWidgetCanvas.items.map((item) =>
                  item.id === widget.id
                    ? { ...item, colSpan: Math.max(12, item.colSpan - 2), rowSpan: Math.max(10, item.rowSpan - 2) }
                    : item
                ),
              },
            })}
          >
            <PtyTerminal
              sessionId={`widget-${session.id}`}
              command={navigator.userAgent.toLowerCase().includes("windows") ? "cmd.exe" : "zsh"}
              args={[]}
              workdir={terminalWorkdir}
              active
            />
          </DraggableCard>
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
