import { FileCode2, GitCommitHorizontal, X } from "lucide-react";
import { closeTab } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { findEditorGroupIdByTabId, getSessionEditorTabIds, useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";

export function OpenEditorsPane({ session }: { session: ClaudeSession }) {
  const tabsById = useEditorStore((s) => s.tabsById);
  const groupsById = useEditorStore((s) => s.groupsById);
  const groupOrderBySessionId = useEditorStore((s) => s.groupOrderBySessionId);
  const activeGroupIdBySessionId = useEditorStore((s) => s.activeGroupIdBySessionId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);

  const tabIds = getSessionEditorTabIds(groupsById, groupOrderBySessionId, session.id).filter((tabId) => tabsById[tabId]);
  if (tabIds.length === 0) return null;

  const activeGroupId = activeGroupIdBySessionId[session.id] ?? null;
  const activeTabId = activeGroupId ? groupsById[activeGroupId]?.activeTabId ?? null : null;

  return (
    <div style={{ padding: "6px 0 8px", borderBottom: "1px solid var(--ci-toolbar-border)" }}>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 12px 6px" }}>
        Open Editors
      </div>
      {tabIds.map((tabId) => {
        const tab = tabsById[tabId];
        if (!tab) return null;
        const isActive = activeTabId === tabId;
        const dirty = buffersByTabId[tabId]?.dirty === true;
        const groupId = findEditorGroupIdByTabId(groupsById, tabId);
        return (
          <div
            key={tabId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px 0 12px",
              minHeight: 22,
              background: isActive ? "var(--ci-accent-bg)" : "transparent",
              color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
              borderLeft: isActive ? "1px solid var(--ci-accent)" : "1px solid transparent",
            }}
          >
            <button
              onClick={() => {
                if (groupId) {
                  setActiveGroup(session.id, groupId);
                  setActiveTab(groupId, tabId);
                }
              }}
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
                opacity: isActive ? 0.9 : 0.5,
              }}
              title={`关闭 ${tab.title}`}
            >
              <X size={12} strokeWidth={1.8} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
