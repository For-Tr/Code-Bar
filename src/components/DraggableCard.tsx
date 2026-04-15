import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export type ResizeEdge = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "corner";

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

function ResizeHandle({
  edge,
  cursor,
  onPointerDown,
}: {
  edge: ResizeEdge;
  cursor: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const style = edge === "left"
    ? { top: 0, left: -4, bottom: 0, width: 8 }
    : edge === "right"
    ? { top: 0, right: -4, bottom: 0, width: 8 }
    : edge === "top"
    ? { left: 0, right: 0, top: -4, height: 8 }
    : edge === "bottom"
    ? { left: 0, right: 0, bottom: -4, height: 8 }
    : edge === "top-left"
    ? { left: -4, top: -4, width: 12, height: 12 }
    : edge === "top-right"
    ? { right: -4, top: -4, width: 12, height: 12 }
    : edge === "bottom-left"
    ? { left: -4, bottom: -4, width: 12, height: 12 }
    : { right: -4, bottom: -4, width: 12, height: 12 };

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        ...style,
        cursor,
        zIndex: 2,
        touchAction: "none",
      }}
    />
  );
}

export function DraggableCard({
  id,
  title,
  headerActions,
  headerControls,
  dragData,
  gridUnit,
  col,
  row,
  colSpan,
  rowSpan,
  onResize,
  children,
}: {
  id: string;
  title: ReactNode;
  headerActions?: ReactNode;
  headerControls?: ReactNode;
  dragData?: Record<string, unknown>;
  gridUnit: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  onResize?: (edge: ResizeEdge, deltaCols: number, deltaRows: number) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: dragData });
  const snappedTransform = transform
    ? {
        x: Math.round(transform.x / gridUnit) * gridUnit,
        y: Math.round(transform.y / gridUnit) * gridUnit,
        scaleX: 1,
        scaleY: 1,
      }
    : null;

  const handleResizePointerDown = (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = Math.round((moveEvent.clientX - startX) / gridUnit);
      const deltaY = Math.round((moveEvent.clientY - startY) / gridUnit);
      const deltaCols = edge === "left" || edge === "top-left" || edge === "bottom-left"
        ? -deltaX
        : edge === "right" || edge === "top-right" || edge === "corner"
        ? deltaX
        : 0;
      const deltaRows = edge === "top" || edge === "top-left" || edge === "top-right"
        ? -deltaY
        : edge === "bottom" || edge === "bottom-left" || edge === "corner"
        ? deltaY
        : 0;
      onResize(edge, deltaCols, deltaRows);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: col * gridUnit,
        top: row * gridUnit,
        width: colSpan * gridUnit,
        height: rowSpan * gridUnit,
        transform: snappedTransform
          ? `${CSS.Transform.toString(snappedTransform)} scale(${isDragging ? 1.01 : 1})`
          : undefined,
        zIndex: isDragging ? 10 : 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--ci-surface-hi)",
        border: `1px solid ${isDragging ? "var(--ci-accent-bdr)" : "var(--ci-toolbar-border)"}`,
        boxShadow: isDragging ? "0 0 0 1px var(--ci-accent-bdr), var(--ci-card-shadow-strong)" : "var(--ci-card-shadow)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: headerActions ? 8 : 0,
          padding: headerActions ? "8px 10px" : "8px 10px 6px",
          background: "var(--ci-toolbar-bg)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            minWidth: 0,
          }}
        >
          <div
            {...listeners}
            {...attributes}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              flex: 1,
              cursor: isDragging ? "grabbing" : "grab",
              touchAction: "none",
              color: "var(--ci-text-muted)",
            }}
          >
            <span style={{ display: "inline-flex", flexShrink: 0 }}>
              <DragHandleIcon />
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              {title}
            </span>
          </div>

          {headerControls && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {headerControls}
            </div>
          )}
        </div>

        {headerActions && (
          <div style={{ minWidth: 0 }}>
            {headerActions}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {children}
      </div>

      {onResize && (
        <>
          <ResizeHandle edge="left" cursor="ew-resize" onPointerDown={handleResizePointerDown("left")} />
          <ResizeHandle edge="right" cursor="ew-resize" onPointerDown={handleResizePointerDown("right")} />
          <ResizeHandle edge="top" cursor="ns-resize" onPointerDown={handleResizePointerDown("top")} />
          <ResizeHandle edge="bottom" cursor="ns-resize" onPointerDown={handleResizePointerDown("bottom")} />
          <ResizeHandle edge="top-left" cursor="nwse-resize" onPointerDown={handleResizePointerDown("top-left")} />
          <ResizeHandle edge="top-right" cursor="nesw-resize" onPointerDown={handleResizePointerDown("top-right")} />
          <ResizeHandle edge="bottom-left" cursor="nesw-resize" onPointerDown={handleResizePointerDown("bottom-left")} />
          <ResizeHandle edge="corner" cursor="nwse-resize" onPointerDown={handleResizePointerDown("corner")} />
        </>
      )}
    </div>
  );
}
