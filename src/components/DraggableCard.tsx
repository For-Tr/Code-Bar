import type { ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

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

export function DraggableCard({
  id,
  title,
  gridUnit,
  col,
  row,
  colSpan,
  rowSpan,
  onGrow,
  onShrink,
  children,
}: {
  id: string;
  title: ReactNode;
  gridUnit: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  onGrow?: () => void;
  onShrink?: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const snappedTransform = transform
    ? {
        x: Math.round(transform.x / gridUnit) * gridUnit,
        y: Math.round(transform.y / gridUnit) * gridUnit,
        scaleX: 1,
        scaleY: 1,
      }
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: col * gridUnit,
        top: row * gridUnit,
        width: colSpan * gridUnit,
        height: rowSpan * gridUnit,
        transform: snappedTransform ? CSS.Transform.toString(snappedTransform) : undefined,
        zIndex: isDragging ? 10 : 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--ci-surface-hi)",
        border: "1px solid var(--ci-toolbar-border)",
        boxShadow: isDragging ? "var(--ci-card-shadow-strong)" : "var(--ci-card-shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px 6px",
          background: "var(--ci-toolbar-bg)",
          flexShrink: 0,
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

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {onShrink && (
            <button
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onShrink}
              style={{
                background: "none",
                border: "none",
                color: "var(--ci-text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              title="缩小"
            >
              －
            </button>
          )}
          {onGrow && (
            <button
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onGrow}
              style={{
                background: "none",
                border: "none",
                color: "var(--ci-text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              title="放大"
            >
              ＋
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
