import { useState } from "react";
import { FileCode2, GitCommitHorizontal, X } from "lucide-react";
import { closeTab } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { WorkbenchTooltip } from "../ui/WorkbenchTooltip";

export function OpenEditorsPane({ session }: { session: ClaudeSession }) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsById = useEditorStore((s) => s.tabsById);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const tabIds = tabOrder.filter((tabId) => tabsById[tabId]?.sessionId === session.id);
  if (tabIds.length === 0) return null;

  return (
    <div style={{ padding: "6px 0 8px", borderBottom: "1px solid var(--ci-toolbar-border)" }}>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 12px 6px" }}>
        Open Editors
      </div>
      {tabIds.map((tabId) => {
        const tab = tabsById[tabId];
        if (!tab) return null;
        const isActive = activeTabId === tabId;
        const isHovered = hoveredTabId === tabId;
        const dirty = buffersByTabId[tabId]?.dirty === true;
        return (
          <div
            key={tabId}
            onMouseEnter={() => setHoveredTabId(tabId)}
            onMouseLeave={() => setHoveredTabId((current) => (current === tabId ? null : current))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px 0 12px",
              minHeight: 22,
              background: isActive ? "var(--ci-list-active-bg)" : isHovered ? "var(--ci-list-hover-bg)" : "transparent",
              color: isActive || isHovered ? "var(--ci-text)" : "var(--ci-text-muted)",
              borderLeft: isActive ? "1px solid var(--ci-accent)" : "1px solid transparent",
            }}
          >
            <button
              onClick={() => setActiveTab(tabId)}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: "3px 0",
                textAlign: "left",
                color: "inherit",
                cursor: "pointer",
                fontSize: 11,
              }}
              title={tab.path}
            >
              <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: tab.viewMode === "diff" ? "var(--ci-purple)" : "var(--ci-text-dim)" }}>
                {tab.viewMode === "diff" ? <GitCommitHorizontal size={11} strokeWidth={1.8} /> : <FileCode2 size={11} strokeWidth={1.8} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tab.title}
              </span>
              {dirty && <span style={{ color: "var(--ci-accent)", fontSize: 10 }}>●</span>}
            </button>
            <WorkbenchTooltip label={`关闭 ${tab.title}`}>
              <button
                onClick={() => closeTab(tabId)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ci-text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  width: 16,
                  height: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: isActive || isHovered ? 0.9 : 0,
                  pointerEvents: isActive || isHovered ? "auto" : "none",
                }}
                title={`关闭 ${tab.title}`}
              >
                <X size={12} strokeWidth={1.8} />
              </button>
            </WorkbenchTooltip>
          </div>
        );
      })}
    </div>
  );
}
