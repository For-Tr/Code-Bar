import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { PtyTerminal } from "./PtyTerminal";
import { DraggableCard } from "./DraggableCard";
import { UsageWidgetCard } from "./UsageWidgetCard";
import { useSettingsStore, isGlassTheme, type SplitWidgetCanvasItem } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

const WIDGET_GAP = 1;
const PANEL_MARGIN = 1;
const RIGHT_EDGE_MARGIN = 2;

function rectsOverlap(a: SplitWidgetCanvasItem, b: SplitWidgetCanvasItem) {
  return a.col < b.col + b.colSpan + WIDGET_GAP
    && a.col + a.colSpan + WIDGET_GAP > b.col
    && a.row < b.row + b.rowSpan + WIDGET_GAP
    && a.row + a.rowSpan + WIDGET_GAP > b.row;
}

function clampRectToBounds(
  item: SplitWidgetCanvasItem,
  maxCols: number,
  maxRows: number
): SplitWidgetCanvasItem {
  const colSpan = Math.min(item.colSpan, maxCols);
  const rowSpan = Math.min(item.rowSpan, maxRows);
  return {
    ...item,
    colSpan,
    rowSpan,
    col: Math.max(PANEL_MARGIN, Math.min(item.col, Math.max(PANEL_MARGIN, maxCols - colSpan - RIGHT_EDGE_MARGIN + 1))),
    row: Math.max(PANEL_MARGIN, Math.min(item.row, Math.max(PANEL_MARGIN, maxRows - rowSpan - PANEL_MARGIN + 1))),
  };
}

function collides(candidate: SplitWidgetCanvasItem, items: SplitWidgetCanvasItem[], excludeId: string) {
  return items.some((item) => item.id !== excludeId && rectsOverlap(candidate, item));
}

function findNearestFreePlacement(
  candidate: SplitWidgetCanvasItem,
  items: SplitWidgetCanvasItem[],
  maxCols: number,
  maxRows: number
): SplitWidgetCanvasItem | null {
  const maxColStart = Math.max(PANEL_MARGIN, maxCols - candidate.colSpan - RIGHT_EDGE_MARGIN + 1);
  const maxRowStart = Math.max(PANEL_MARGIN, maxRows - candidate.rowSpan - PANEL_MARGIN + 1);
  const targetCol = Math.max(PANEL_MARGIN, Math.min(candidate.col, maxColStart));
  const targetRow = Math.max(PANEL_MARGIN, Math.min(candidate.row, maxRowStart));
  let best: SplitWidgetCanvasItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let row = PANEL_MARGIN; row <= maxRowStart; row += 1) {
    for (let col = PANEL_MARGIN; col <= maxColStart; col += 1) {
      const next = { ...candidate, col, row };
      if (collides(next, items, candidate.id)) continue;
      const distance = Math.abs(col - targetCol) + Math.abs(row - targetRow);
      if (distance < bestDistance) {
        best = next;
        bestDistance = distance;
      }
    }
  }

  return best;
}

function repairLayout(items: SplitWidgetCanvasItem[], maxCols: number, maxRows: number) {
  const placed: SplitWidgetCanvasItem[] = [];
  for (const item of items) {
    const clamped = clampRectToBounds(item, maxCols, maxRows);
    const next = collides(clamped, placed, clamped.id)
      ? findNearestFreePlacement(clamped, placed, maxCols, maxRows) ?? clamped
      : clamped;
    placed.push(next);
  }
  return placed;
}

function shellQuote(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function insetRect(item: SplitWidgetCanvasItem, maxCols: number, maxRows: number) {
  return clampRectToBounds({
    ...item,
    colSpan: Math.max(12, item.colSpan),
    rowSpan: Math.max(10, item.rowSpan),
  }, maxCols - RIGHT_EDGE_MARGIN + 1, maxRows - PANEL_MARGIN + 1);
}

function expandLayoutToFill(items: SplitWidgetCanvasItem[], maxCols: number, maxRows: number) {
  const order = [...items].sort((a, b) => {
    if (a.type === b.type) {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    }
    return a.type === "terminal" ? -1 : 1;
  });
  const current = new Map(order.map((item) => [item.id, { ...item }]));

  for (const seed of order) {
    let next = current.get(seed.id)!;
    let changed = true;
    const growthOrder = next.type === "terminal" ? ["row", "col"] as const : ["col", "row"] as const;

    while (changed) {
      changed = false;
      for (const axis of growthOrder) {
        const candidate = axis === "col"
          ? clampRectToBounds({ ...next, colSpan: next.colSpan + 1 }, maxCols, maxRows)
          : clampRectToBounds({ ...next, rowSpan: next.rowSpan + 1 }, maxCols, maxRows);
        const sameSize = candidate.colSpan === next.colSpan && candidate.rowSpan === next.rowSpan;
        if (sameSize) continue;
        const others = [...current.values()].filter((item) => item.id !== next.id);
        if (!collides(candidate, others, next.id)) {
          next = candidate;
          current.set(next.id, next);
          changed = true;
        }
      }
    }
  }

  return items.map((item) => current.get(item.id) ?? item);
}

export function SplitWidgetPanel() {
  const { settings, patchSettings } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelBounds, setPanelBounds] = useState({ width: 0, height: 0 });

  const session = useMemo(
    () => sessions.find((item) => item.id === expandedSessionId) ?? null,
    [expandedSessionId, sessions]
  );
  const terminalWorkdir = session?.worktreePath ?? session?.workdir ?? "";
  const widgetTerminalSessionId = session
    ? `widget-${session.id}-${terminalWorkdir.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : "widget-none";
  const terminalCommand = navigator.userAgent.toLowerCase().includes("windows") ? "cmd.exe" : "sh";
  const terminalArgs = navigator.userAgent.toLowerCase().includes("windows")
    ? ["/K", `cd /d "${terminalWorkdir}"`]
    : ["-lc", `cd ${shellQuote(terminalWorkdir)} && exec zsh -i`];
  const widgets = settings.splitWidgetCanvas.items.filter((item) => item.visible !== false);
  const gridUnit = settings.splitWidgetCanvas.cellSize;
  const maxCols = Math.max(12, Math.floor(panelBounds.width / gridUnit));
  const maxRows = Math.max(10, Math.floor(panelBounds.height / gridUnit));
  const repairedWidgets = useMemo(() => repairLayout(widgets, maxCols, maxRows), [widgets, maxCols, maxRows]);

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setPanelBounds({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setPanelBounds({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (panelBounds.width <= 0 || panelBounds.height <= 0) return;
    if (repairedWidgets.length !== widgets.length) return;
    const changed = repairedWidgets.some((item, index) => {
      const original = widgets[index];
      return !original
        || item.col !== original.col
        || item.row !== original.row
        || item.colSpan !== original.colSpan
        || item.rowSpan !== original.rowSpan;
    });
    if (!changed) return;
    patchSettings({
      splitWidgetCanvas: {
        ...settings.splitWidgetCanvas,
        items: settings.splitWidgetCanvas.items.map((item) => {
          const repaired = repairedWidgets.find((candidate) => candidate.id === item.id);
          return repaired ?? item;
        }),
      },
    });
  }, [panelBounds.height, panelBounds.width, patchSettings, repairedWidgets, settings.splitWidgetCanvas, widgets]);

  return (
    <div ref={panelRef} style={{
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
        display: "flex",
        gap: 10,
      }}>
        <button
          onClick={() => {
            if (settings.splitWidgetCanvas.filledSnapshot && settings.splitWidgetCanvas.filledSnapshot.length > 0) {
              patchSettings({
                splitWidgetCanvas: {
                  ...settings.splitWidgetCanvas,
                  items: settings.splitWidgetCanvas.filledSnapshot,
                  filledSnapshot: null,
                },
              });
              return;
            }
            const expanded = expandLayoutToFill(repairedWidgets, maxCols, maxRows);
            const repaired = repairLayout(expanded, maxCols, maxRows).map((item) => insetRect(item, maxCols, maxRows));
            patchSettings({
              splitWidgetCanvas: {
                ...settings.splitWidgetCanvas,
                items: settings.splitWidgetCanvas.items.map((item) => {
                  const match = repaired.find((candidate) => candidate.id === item.id);
                  return match ?? item;
                }),
                filledSnapshot: settings.splitWidgetCanvas.items,
              },
            });
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--ci-text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
          }}
        >
          {settings.splitWidgetCanvas.filledSnapshot ? "还原" : "铺满"}
        </button>
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

      {repairedWidgets.length > 0 ? (
        <DndContext
          sensors={sensors}
          onDragEnd={({ active, delta }) => {
            const current = repairedWidgets.find((item) => item.id === active.id);
            if (!current) return;
            const colDelta = Math.round(delta.x / gridUnit);
            const rowDelta = Math.round(delta.y / gridUnit);
            const candidate = clampRectToBounds({
              ...current,
              col: current.col + colDelta,
              row: current.row + rowDelta,
            }, maxCols, maxRows);
            const resolved = collides(candidate, repairedWidgets, current.id)
              ? findNearestFreePlacement(candidate, repairedWidgets, maxCols, maxRows) ?? current
              : candidate;
            patchSettings({
              splitWidgetCanvas: {
                ...settings.splitWidgetCanvas,
                items: settings.splitWidgetCanvas.items.map((item) =>
                  item.id === active.id
                    ? { ...item, col: resolved.col, row: resolved.row, colSpan: resolved.colSpan, rowSpan: resolved.rowSpan }
                    : item
                ),
              },
            });
          }}
        >
          {repairedWidgets.map((widget) => (
            <DraggableCard
              key={widget.id}
              id={widget.id}
              title={widget.type === "terminal" ? (terminalWorkdir || "Terminal") : null}
              gridUnit={gridUnit}
              col={widget.col}
              row={widget.row}
              colSpan={widget.colSpan}
              rowSpan={widget.rowSpan}
              onResize={(deltaCols, deltaRows) => {
                const candidate = clampRectToBounds({
                  ...widget,
                  colSpan: Math.max(12, widget.colSpan + deltaCols),
                  rowSpan: Math.max(10, widget.rowSpan + deltaRows),
                }, maxCols, maxRows);
                let resolved = candidate;
                if (collides(candidate, repairedWidgets, widget.id)) {
                  let nextColSpan = candidate.colSpan;
                  let nextRowSpan = candidate.rowSpan;
                  while ((nextColSpan > widget.colSpan || nextRowSpan > widget.rowSpan) && collides({ ...candidate, colSpan: nextColSpan, rowSpan: nextRowSpan }, repairedWidgets, widget.id)) {
                    if (nextColSpan > widget.colSpan) nextColSpan -= 1;
                    if (nextRowSpan > widget.rowSpan) nextRowSpan -= 1;
                  }
                  resolved = {
                    ...candidate,
                    colSpan: Math.max(12, nextColSpan),
                    rowSpan: Math.max(10, nextRowSpan),
                  };
                  if (collides(resolved, repairedWidgets, widget.id)) {
                    resolved = widget;
                  }
                }
                patchSettings({
                  splitWidgetCanvas: {
                    ...settings.splitWidgetCanvas,
                    items: settings.splitWidgetCanvas.items.map((item) =>
                      item.id === widget.id
                        ? { ...item, col: resolved.col, row: resolved.row, colSpan: resolved.colSpan, rowSpan: resolved.rowSpan }
                        : item
                    ),
                  },
                });
              }}
            >
              {widget.type === "terminal" && session && terminalWorkdir ? (
                <PtyTerminal
                  key={widgetTerminalSessionId}
                  sessionId={widgetTerminalSessionId}
                  command={terminalCommand}
                  args={terminalArgs}
                  workdir={terminalWorkdir}
                  active
                />
              ) : widget.type === "usage" ? (
                <UsageWidgetCard />
              ) : null}
            </DraggableCard>
          ))}
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
