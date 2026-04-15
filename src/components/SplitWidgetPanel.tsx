import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { PtyTerminal } from "./PtyTerminal";
import { DraggableCard } from "./DraggableCard";
import { UsageWidgetCard } from "./UsageWidgetCard";
import {
  useSettingsStore,
  isGlassTheme,
  type SplitWidgetCanvasItem,
  type SplitWidgetTerminalItem,
  type SplitWidgetTerminalTab,
} from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

const WIDGET_GAP = 1;
const PANEL_MARGIN = 1;
const RIGHT_EDGE_MARGIN = 3;

type SplitWidgetDragData =
  | { type: "widget-card"; widgetId: string }
  | { type: "terminal-card"; widgetId: string }
  | { type: "terminal-tab"; widgetId: string; tabId: string };

type SplitWidgetDropData = { type: "terminal-card-drop"; widgetId: string };

type ActiveDraggedTab = {
  widgetId: string;
  tabId: string;
  title: string;
  isActive: boolean;
  sourceCol: number;
  sourceRow: number;
  sourceColSpan: number;
  sourceRowSpan: number;
  startPointerX: number;
  startPointerY: number;
};

const DETACH_TOLERANCE_PX = 12;

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
      ? findNearestFreePlacement(clamped, placed, maxCols, maxRows)
      : clamped;
    placed.push(next ?? item);
  }
  return placed;
}

function reconcileCanvasLayout(items: SplitWidgetCanvasItem[], maxCols: number, maxRows: number) {
  const visibleItems = items.filter((item) => item.visible !== false);
  const repairedItems = repairLayout(visibleItems, maxCols, maxRows);
  const repairedMap = new Map(repairedItems.map((item) => [item.id, item]));
  return items.map((item) => {
    const repaired = repairedMap.get(item.id);
    return repaired
      ? { ...item, col: repaired.col, row: repaired.row, colSpan: repaired.colSpan, rowSpan: repaired.rowSpan }
      : item;
  });
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

function stopEvent(event: { preventDefault: () => void; stopPropagation: () => void }) {
  event.preventDefault();
  event.stopPropagation();
}

function sanitizeSessionKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createTerminalTab(tabs: SplitWidgetTerminalTab[]): SplitWidgetTerminalTab {
  const numericTitles = tabs
    .map((tab) => Number(tab.title.match(/^Terminal\s+(\d+)$/)?.[1] ?? Number.NaN))
    .filter((value) => Number.isFinite(value));
  const nextNumber = numericTitles.length > 0 ? Math.max(...numericTitles) + 1 : tabs.length + 1;
  const uniqueId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `terminal-tab-${uniqueId}`,
    title: `Terminal ${nextNumber}`,
    ptySessionKey: `terminal-pty-${uniqueId}`,
  };
}

function createTerminalWidgetId() {
  return `terminal-widget-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildWidgetTerminalSessionId(sessionId: string, ptySessionKey: string) {
  return `widget-${sanitizeSessionKey(sessionId)}-${sanitizeSessionKey(ptySessionKey)}`;
}

function getFallbackActiveTabId(tabs: SplitWidgetTerminalTab[], removedIndex: number) {
  const fallback = tabs[Math.max(0, removedIndex - 1)] ?? tabs[removedIndex] ?? tabs[0];
  return fallback?.id ?? "";
}

function removeTabFromWidget(widget: SplitWidgetTerminalItem, tabId: string) {
  const tabIndex = widget.tabs.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) {
    return { nextWidget: widget, removedTab: null as SplitWidgetTerminalTab | null };
  }
  const removedTab = widget.tabs[tabIndex];
  const nextTabs = widget.tabs.filter((tab) => tab.id !== tabId);
  if (nextTabs.length === 0) {
    return { nextWidget: null as SplitWidgetTerminalItem | null, removedTab };
  }
  const nextActiveTabId = nextTabs.some((tab) => tab.id === widget.activeTabId)
    ? widget.activeTabId
    : getFallbackActiveTabId(nextTabs, tabIndex);
  return {
    nextWidget: {
      ...widget,
      tabs: nextTabs,
      activeTabId: nextActiveTabId,
    },
    removedTab,
  };
}

function detachTerminalTab(
  items: SplitWidgetCanvasItem[],
  sourceLayout: SplitWidgetCanvasItem,
  sourceWidgetId: string,
  tabId: string
) {
  const sourceWidget = items.find(
    (item): item is SplitWidgetTerminalItem => item.type === "terminal" && item.id === sourceWidgetId
  );
  if (!sourceWidget) {
    return { itemsWithoutSource: items, removedTab: null as SplitWidgetTerminalTab | null };
  }
  const { nextWidget, removedTab } = removeTabFromWidget(sourceWidget, tabId);
  if (!removedTab) {
    return { itemsWithoutSource: items, removedTab };
  }
  return {
    itemsWithoutSource: items.flatMap((item) => {
      if (item.id !== sourceWidgetId) return [item];
      if (!nextWidget) return [];
      return [{
        ...nextWidget,
        col: sourceLayout.col,
        row: sourceLayout.row,
        colSpan: sourceLayout.colSpan,
        rowSpan: sourceLayout.rowSpan,
      }];
    }),
    removedTab,
  };
}

function readDragData(value: unknown): SplitWidgetDragData | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  const candidate = value as Partial<SplitWidgetDragData>;
  if (candidate.type === "terminal-tab" && typeof candidate.widgetId === "string" && typeof candidate.tabId === "string") {
    return { type: "terminal-tab", widgetId: candidate.widgetId, tabId: candidate.tabId };
  }
  if (candidate.type === "terminal-card" && typeof candidate.widgetId === "string") {
    return { type: "terminal-card", widgetId: candidate.widgetId };
  }
  if (candidate.type === "widget-card" && typeof candidate.widgetId === "string") {
    return { type: "widget-card", widgetId: candidate.widgetId };
  }
  return null;
}

function readDropData(value: unknown): SplitWidgetDropData | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  const candidate = value as Partial<SplitWidgetDropData>;
  if (candidate.type !== "terminal-card-drop" || typeof candidate.widgetId !== "string") return null;
  return { type: "terminal-card-drop", widgetId: candidate.widgetId };
}

function isPointInsideWidget(
  item: SplitWidgetCanvasItem,
  x: number,
  y: number,
  gridUnit: number,
  tolerance = 0
) {
  const left = item.col * gridUnit - tolerance;
  const top = item.row * gridUnit - tolerance;
  const right = (item.col + item.colSpan) * gridUnit + tolerance;
  const bottom = (item.row + item.rowSpan) * gridUnit + tolerance;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function getTerminalWidgetAtPoint(
  repairedWidgetMap: Map<string, SplitWidgetCanvasItem>,
  sourceWidgetId: string,
  x: number,
  y: number,
  gridUnit: number,
  tolerance = 0
): SplitWidgetTerminalItem | null {
  for (const item of repairedWidgetMap.values()) {
    if (item.type !== "terminal" || item.id === sourceWidgetId) continue;
    if (isPointInsideWidget(item, x, y, gridUnit, tolerance)) {
      return item;
    }
  }
  return null;
}

function getDetachedTabState(
  items: SplitWidgetCanvasItem[],
  repairedWidgetMap: Map<string, SplitWidgetCanvasItem>,
  sourceWidgetId: string,
  tabId: string,
  pointerX: number,
  pointerY: number,
  sourcePointerX: number,
  sourcePointerY: number,
  gridUnit: number,
  maxCols: number,
  maxRows: number,
  snapToFreeSpace: boolean,
  clampToBounds: boolean
): { itemsWithoutSource: SplitWidgetCanvasItem[]; detachedItem: SplitWidgetTerminalItem } | null {
  const sourceLayout = repairedWidgetMap.get(sourceWidgetId);
  if (!sourceLayout) return null;

  const { itemsWithoutSource, removedTab } = detachTerminalTab(items, sourceLayout, sourceWidgetId, tabId);
  if (!removedTab) return null;

  const occupiedItems = itemsWithoutSource
    .filter((item) => item.visible !== false)
    .map((item) => {
      const repaired = repairedWidgetMap.get(item.id);
      return repaired
        ? { ...item, col: repaired.col, row: repaired.row, colSpan: repaired.colSpan, rowSpan: repaired.rowSpan }
        : item;
    });

  const sourceLeftPx = sourceLayout.col * gridUnit;
  const sourceTopPx = sourceLayout.row * gridUnit;
  const grabOffsetX = sourcePointerX - sourceLeftPx;
  const grabOffsetY = sourcePointerY - sourceTopPx;

  const detachedCandidate = (clampToBounds ? clampRectToBounds : (item: SplitWidgetCanvasItem) => item)({
    id: createTerminalWidgetId(),
    type: "terminal",
    col: Math.round((pointerX - grabOffsetX) / gridUnit),
    row: Math.round((pointerY - grabOffsetY) / gridUnit),
    colSpan: sourceLayout.colSpan,
    rowSpan: sourceLayout.rowSpan,
    visible: true,
    tabs: [removedTab],
    activeTabId: removedTab.id,
  }, maxCols, maxRows);

  const resolvedDetached = !snapToFreeSpace
    ? detachedCandidate
    : collides(detachedCandidate, occupiedItems, detachedCandidate.id)
    ? findNearestFreePlacement(detachedCandidate, occupiedItems, maxCols, maxRows)
    : detachedCandidate;

  return resolvedDetached && resolvedDetached.type === "terminal"
    ? { itemsWithoutSource, detachedItem: resolvedDetached }
    : null;
}

function moveTerminalTabToWidget(
  items: SplitWidgetCanvasItem[],
  sourceWidgetId: string,
  targetWidgetId: string,
  tabId: string
) {
  if (sourceWidgetId === targetWidgetId) return items;

  let movedTab: SplitWidgetTerminalTab | null = null;
  const nextItems: SplitWidgetCanvasItem[] = [];

  for (const item of items) {
    if (item.type !== "terminal") {
      nextItems.push(item);
      continue;
    }

    if (item.id !== sourceWidgetId) {
      nextItems.push(item);
      continue;
    }

    const { nextWidget, removedTab } = removeTabFromWidget(item, tabId);
    movedTab = removedTab;
    if (nextWidget) nextItems.push(nextWidget);
  }

  if (!movedTab) return items;

  let targetFound = false;
  const finalItems = nextItems.map((item) => {
    if (item.type === "terminal" && item.id === targetWidgetId) {
      targetFound = true;
      return {
        ...item,
        tabs: [...item.tabs, movedTab!],
        activeTabId: movedTab!.id,
      };
    }
    return item;
  });

  return targetFound ? finalItems : items;
}

function mergeTerminalWidgets(items: SplitWidgetCanvasItem[], sourceWidgetId: string, targetWidgetId: string) {
  if (sourceWidgetId === targetWidgetId) return items;

  const sourceWidget = items.find((item) => item.type === "terminal" && item.id === sourceWidgetId);
  if (!sourceWidget || sourceWidget.type !== "terminal") return items;

  let targetFound = false;
  const finalItems = items
    .filter((item) => item.id !== sourceWidgetId)
    .map((item) => {
      if (item.type === "terminal" && item.id === targetWidgetId) {
        targetFound = true;
        return {
          ...item,
          tabs: [...item.tabs, ...sourceWidget.tabs],
          activeTabId: sourceWidget.tabs.some((tab) => tab.id === sourceWidget.activeTabId)
            ? sourceWidget.activeTabId
            : item.activeTabId,
        };
      }
      return item;
    });

  return targetFound ? finalItems : items;
}

function TerminalCardDropZone({
  widgetId,
  activeDragType,
  children,
}: {
  widgetId: string;
  activeDragType: SplitWidgetDragData["type"] | null;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `terminal-card-drop-${widgetId}`,
    data: { type: "terminal-card-drop", widgetId },
  });
  const canAcceptDrop = activeDragType === "terminal-tab" || activeDragType === "terminal-card";
  const showHint = canAcceptDrop && !isOver;

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 0,
        borderRadius: 10,
        padding: 2,
        border: `1px dashed ${isOver ? "var(--ci-accent)" : showHint ? "var(--ci-accent-bdr)" : "transparent"}`,
        background: isOver ? "var(--ci-accent-bg)" : showHint ? "rgba(63,145,255,0.06)" : "transparent",
        boxShadow: isOver ? "0 0 0 1px var(--ci-accent-bdr) inset" : "none",
        transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {children}
    </div>
  );
}

function TerminalTabChip({
  widgetId,
  tab,
  isActive,
  onSelect,
  onClose,
  canClose,
}: {
  widgetId: string;
  tab: SplitWidgetTerminalTab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  canClose: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `terminal-tab-${widgetId}-${tab.id}`,
    data: { type: "terminal-tab", widgetId, tabId: tab.id },
  });
  const showHover = hovered && !isDragging && !isActive;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        padding: "2px 4px 2px 8px",
        borderRadius: 9,
        border: `1px solid ${isDragging ? "var(--ci-accent)" : isActive ? "var(--ci-accent-bdr)" : showHover ? "var(--ci-toolbar-border)" : "transparent"}`,
        background: isDragging
          ? "rgba(63,145,255,0.14)"
          : isActive
          ? "var(--ci-accent-bg)"
          : showHover
          ? "rgba(255,255,255,0.06)"
          : "rgba(255,255,255,0.02)",
        boxShadow: isDragging ? "0 8px 18px rgba(15,23,42,0.14)" : "none",
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        opacity: isDragging ? 0 : 1,
        zIndex: isDragging ? 2 : 1,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <button
        onClick={(event) => {
          stopEvent(event);
          onSelect();
        }}
        style={{
          minWidth: 0,
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          background: "none",
          border: "none",
          color: isActive ? "var(--ci-accent)" : "var(--ci-text-muted)",
          cursor: "pointer",
          fontSize: 11,
          padding: 0,
        }}
      >
        {tab.title}
      </button>
      {canClose && (
        <button
          onPointerDown={stopEvent}
          onClick={(event) => {
            stopEvent(event);
            onClose();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "none",
            border: "none",
            color: isActive ? "var(--ci-accent)" : "var(--ci-text-dim)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label={`关闭 ${tab.title}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function SplitWidgetPanel() {
  const { settings, patchSettings } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelBounds, setPanelBounds] = useState({ width: 0, height: 0 });
  const [activeDragType, setActiveDragType] = useState<SplitWidgetDragData["type"] | null>(null);
  const [activeDraggedTab, setActiveDraggedTab] = useState<ActiveDraggedTab | null>(null);
  const [detachedPreviewRect, setDetachedPreviewRect] = useState<SplitWidgetTerminalItem | null>(null);

  const session = useMemo(
    () => sessions.find((item) => item.id === expandedSessionId) ?? null,
    [expandedSessionId, sessions]
  );
  const terminalWorkdir = session?.worktreePath ?? session?.workdir ?? "";
  const terminalCommand = navigator.userAgent.toLowerCase().includes("windows") ? "cmd.exe" : "sh";
  const terminalArgs = navigator.userAgent.toLowerCase().includes("windows")
    ? ["/K", `cd /d "${terminalWorkdir}"`]
    : ["-lc", `cd ${shellQuote(terminalWorkdir)} && exec zsh -i`];
  const widgets = settings.splitWidgetCanvas.items.filter((item) => item.visible !== false);
  const gridUnit = settings.splitWidgetCanvas.cellSize;
  const maxCols = Math.max(12, Math.floor(panelBounds.width / gridUnit));
  const maxRows = Math.max(10, Math.floor(panelBounds.height / gridUnit));
  const repairedWidgets = useMemo(() => repairLayout(widgets, maxCols, maxRows), [widgets, maxCols, maxRows]);
  const repairedWidgetMap = useMemo(() => new Map(repairedWidgets.map((item) => [item.id, item])), [repairedWidgets]);

  const patchCanvasItems = useCallback((items: SplitWidgetCanvasItem[], clearFilledSnapshot = false) => {
    patchSettings({
      splitWidgetCanvas: {
        ...settings.splitWidgetCanvas,
        items: reconcileCanvasLayout(items, maxCols, maxRows),
        filledSnapshot: clearFilledSnapshot ? null : (settings.splitWidgetCanvas.filledSnapshot ?? null),
      },
    });
  }, [maxCols, maxRows, patchSettings, settings.splitWidgetCanvas]);

  const updateTerminalWidget = useCallback((widgetId: string, updater: (widget: SplitWidgetTerminalItem) => SplitWidgetTerminalItem) => {
    patchSettings({
      splitWidgetCanvas: {
        ...settings.splitWidgetCanvas,
        items: settings.splitWidgetCanvas.items.map((item) => (
          item.id === widgetId && item.type === "terminal"
            ? updater(item)
            : item
        )),
      },
    });
  }, [patchSettings, settings.splitWidgetCanvas]);

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
          collisionDetection={pointerWithin}
          onDragStart={({ active, activatorEvent }) => {
            const dragData = readDragData(active.data.current);
            setActiveDragType(dragData?.type ?? null);
            if (dragData?.type === "terminal-tab") {
              const widget = settings.splitWidgetCanvas.items.find(
                (item): item is SplitWidgetTerminalItem => item.type === "terminal" && item.id === dragData.widgetId
              );
              const tab = widget?.tabs.find((item) => item.id === dragData.tabId);
              const sourceLayout = repairedWidgetMap.get(dragData.widgetId);
              const panelRect = panelRef.current?.getBoundingClientRect();
              const pointerEvent = activatorEvent instanceof PointerEvent ? activatorEvent : null;
              setActiveDraggedTab(tab && sourceLayout && panelRect ? {
                widgetId: dragData.widgetId,
                tabId: tab.id,
                title: tab.title,
                isActive: widget?.activeTabId === tab.id,
                sourceCol: sourceLayout.col,
                sourceRow: sourceLayout.row,
                sourceColSpan: sourceLayout.colSpan,
                sourceRowSpan: sourceLayout.rowSpan,
                startPointerX: (pointerEvent?.clientX ?? panelRect.left + sourceLayout.col * gridUnit) - panelRect.left,
                startPointerY: (pointerEvent?.clientY ?? panelRect.top + sourceLayout.row * gridUnit) - panelRect.top,
              } : null);
            } else {
              setActiveDraggedTab(null);
            }
            setDetachedPreviewRect(null);
          }}
          onDragMove={({ active, delta }) => {
            const dragData = readDragData(active.data.current);
            if (dragData?.type !== "terminal-tab") {
              setDetachedPreviewRect(null);
              return;
            }

            const sourceLayout = repairedWidgetMap.get(dragData.widgetId);
            if (!sourceLayout || !activeDraggedTab) {
              setDetachedPreviewRect(null);
              return;
            }

            const pointerX = activeDraggedTab.startPointerX + delta.x;
            const pointerY = activeDraggedTab.startPointerY + delta.y;

            if (isPointInsideWidget(sourceLayout, pointerX, pointerY, gridUnit, DETACH_TOLERANCE_PX)) {
              setDetachedPreviewRect(null);
              return;
            }
            const hoveredTerminal = getTerminalWidgetAtPoint(
              repairedWidgetMap,
              dragData.widgetId,
              pointerX,
              pointerY,
              gridUnit,
              DETACH_TOLERANCE_PX
            );

            if (hoveredTerminal) {
              setDetachedPreviewRect(null);
              return;
            }

            if (Math.abs(delta.x) < gridUnit && Math.abs(delta.y) < gridUnit) {
              setDetachedPreviewRect(null);
              return;
            }

            setDetachedPreviewRect(getDetachedTabState(
              settings.splitWidgetCanvas.items,
              repairedWidgetMap,
              dragData.widgetId,
              dragData.tabId,
              pointerX,
              pointerY,
              activeDraggedTab.startPointerX,
              activeDraggedTab.startPointerY,
              gridUnit,
              maxCols,
              maxRows,
              true,
              true
            )?.detachedItem ?? null);
          }}
          onDragCancel={() => {
            setActiveDragType(null);
            setActiveDraggedTab(null);
            setDetachedPreviewRect(null);
          }}
          onDragEnd={(event: DragEndEvent) => {
            const { active, over, delta } = event;
            const dragData = readDragData(active.data.current);
            const dropData = readDropData(over?.data.current);
            setActiveDragType(null);
            setActiveDraggedTab(null);
            setDetachedPreviewRect(null);
            if (!dragData) return;

            if (dragData.type === "terminal-tab") {
              const sourceLayout = repairedWidgetMap.get(dragData.widgetId);
              if (!sourceLayout || !activeDraggedTab) return;

              const pointerX = activeDraggedTab.startPointerX + delta.x;
              const pointerY = activeDraggedTab.startPointerY + delta.y;

              if (isPointInsideWidget(sourceLayout, pointerX, pointerY, gridUnit, DETACH_TOLERANCE_PX)) {
                return;
              }

              const hoveredTerminal = getTerminalWidgetAtPoint(
                repairedWidgetMap,
                dragData.widgetId,
                pointerX,
                pointerY,
                gridUnit,
                DETACH_TOLERANCE_PX
              );

              if (hoveredTerminal) {
                const nextItems = moveTerminalTabToWidget(
                  settings.splitWidgetCanvas.items,
                  dragData.widgetId,
                  hoveredTerminal.id,
                  dragData.tabId
                );
                if (nextItems !== settings.splitWidgetCanvas.items) {
                  patchCanvasItems(nextItems, true);
                }
                return;
              }

              if (dropData?.widgetId === dragData.widgetId) return;

              if (Math.abs(delta.x) < gridUnit && Math.abs(delta.y) < gridUnit) return;

              const detachedState = getDetachedTabState(
                settings.splitWidgetCanvas.items,
                repairedWidgetMap,
                dragData.widgetId,
                dragData.tabId,
                pointerX,
                pointerY,
                activeDraggedTab.startPointerX,
                activeDraggedTab.startPointerY,
                gridUnit,
                maxCols,
                maxRows,
                true,
                true
              );

              if (!detachedState) return;

              patchCanvasItems([...detachedState.itemsWithoutSource, detachedState.detachedItem], true);
              return;
            }

            if (dragData.type === "terminal-card" && dropData && dropData.widgetId !== dragData.widgetId) {
              const nextItems = mergeTerminalWidgets(settings.splitWidgetCanvas.items, dragData.widgetId, dropData.widgetId);
              if (nextItems !== settings.splitWidgetCanvas.items) {
                patchCanvasItems(nextItems, true);
              }
              return;
            }

            const current = repairedWidgetMap.get(dragData.widgetId);
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
                  item.id === dragData.widgetId
                    ? { ...item, col: resolved.col, row: resolved.row, colSpan: resolved.colSpan, rowSpan: resolved.rowSpan }
                    : item
                ),
              },
            });
          }}
        >
          {detachedPreviewRect && (
            <div
              style={{
                position: "absolute",
                left: detachedPreviewRect.col * gridUnit,
                top: detachedPreviewRect.row * gridUnit,
                width: detachedPreviewRect.colSpan * gridUnit,
                height: detachedPreviewRect.rowSpan * gridUnit,
                borderRadius: 14,
                border: "1px dashed var(--ci-accent)",
                background: "rgba(63,145,255,0.08)",
                boxShadow: "0 12px 24px rgba(15,23,42,0.10)",
                pointerEvents: "none",
                zIndex: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 34,
                  padding: "0 10px",
                  borderBottom: "1px dashed rgba(63,145,255,0.35)",
                  color: "var(--ci-accent)",
                  fontSize: 10,
                  fontFamily: "monospace",
                  background: "rgba(63,145,255,0.06)",
                }}
              >
                Terminal
              </div>
            </div>
          )}
          <DragOverlay dropAnimation={null}>
            {activeDraggedTab ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 0,
                  maxWidth: 140,
                  padding: "4px 8px",
                  borderRadius: 9,
                  border: `1px solid ${activeDraggedTab.isActive ? "var(--ci-accent)" : "var(--ci-accent-bdr)"}`,
                  background: activeDraggedTab.isActive ? "var(--ci-accent-bg)" : "rgba(63,145,255,0.10)",
                  color: activeDraggedTab.isActive ? "var(--ci-accent)" : "var(--ci-text)",
                  fontSize: 11,
                  boxShadow: "0 12px 24px rgba(15,23,42,0.16)",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeDraggedTab.title}
                </span>
              </div>
            ) : null}
          </DragOverlay>
          {repairedWidgets.map((widget) => {
            const headerActions = widget.type === "terminal" ? (
              <TerminalCardDropZone widgetId={widget.id} activeDragType={activeDragType}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    flex: 1,
                    overflowX: "auto",
                    scrollbarWidth: "none",
                  }}>
                    {widget.tabs.map((tab) => {
                      const isActive = tab.id === widget.activeTabId;
                      return (
                        <TerminalTabChip
                          key={tab.id}
                          widgetId={widget.id}
                          tab={tab}
                          isActive={isActive}
                          canClose={widget.tabs.length > 1}
                          onSelect={() => {
                            if (tab.id === widget.activeTabId) return;
                            updateTerminalWidget(widget.id, (current) => ({
                              ...current,
                              activeTabId: tab.id,
                            }));
                          }}
                          onClose={() => {
                            updateTerminalWidget(widget.id, (current) => removeTabFromWidget(current, tab.id).nextWidget ?? current);
                          }}
                        />
                      );
                    })}
                  </div>

                  <button
                    onPointerDown={stopEvent}
                    onClick={(event) => {
                      stopEvent(event);
                      updateTerminalWidget(widget.id, (current) => {
                        const nextTab = createTerminalTab(current.tabs);
                        return {
                          ...current,
                          tabs: [...current.tabs, nextTab],
                          activeTabId: nextTab.id,
                        };
                      });
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: 8,
                      background: "none",
                      border: "1px solid var(--ci-toolbar-border)",
                      color: "var(--ci-text-muted)",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: 0,
                      flexShrink: 0,
                    }}
                    aria-label="新建终端标签页"
                  >
                    +
                  </button>
                </div>
              </TerminalCardDropZone>
            ) : undefined;

            return (
              <DraggableCard
                key={widget.id}
                id={widget.id}
                title={widget.type === "terminal" ? (terminalWorkdir || "Terminal") : null}
                headerActions={headerActions}
                dragData={{
                  type: widget.type === "terminal" ? "terminal-card" : "widget-card",
                  widgetId: widget.id,
                }}
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
                {widget.type === "terminal" ? (
                  <div style={{ position: "relative", width: "100%", height: "100%" }}>
                    {widget.tabs.map((tab) => {
                      const ptySessionId = session
                        ? buildWidgetTerminalSessionId(session.id, tab.ptySessionKey)
                        : `widget-none-${tab.ptySessionKey}`;
                      const isActiveTab = tab.id === widget.activeTabId;
                      return (
                        <div
                          key={ptySessionId}
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: isActiveTab ? 1 : 0,
                            pointerEvents: isActiveTab ? "auto" : "none",
                            zIndex: isActiveTab ? 1 : 0,
                          }}
                        >
                          {session && terminalWorkdir ? (
                            <PtyTerminal
                              sessionId={ptySessionId}
                              command={terminalCommand}
                              args={terminalArgs}
                              workdir={terminalWorkdir}
                              active={isActiveTab}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : widget.type === "usage" ? (
                  <UsageWidgetCard />
                ) : null}
              </DraggableCard>
            );
          })}
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
