import { closeTab } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";

export function OpenEditorsPane({ session }: { session: ClaudeSession }) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsById = useEditorStore((s) => s.tabsById);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);

  const tabIds = tabOrder.filter((tabId) => tabsById[tabId]?.sessionId === session.id);
  if (tabIds.length === 0) return null;

  return (
    <div style={{ padding: "8px 8px 10px", borderBottom: "1px solid var(--ci-toolbar-border)" }}>
      <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 4px 6px" }}>
        Open Editors
      </div>
      {tabIds.map((tabId) => {
        const tab = tabsById[tabId];
        if (!tab) return null;
        const isActive = activeTabId === tabId;
        const dirty = buffersByTabId[tabId]?.dirty === true;
        return (
          <div
            key={tabId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px",
              borderRadius: 8,
              background: isActive ? "var(--ci-accent-bg)" : "transparent",
              color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
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
                padding: 0,
                textAlign: "left",
                color: "inherit",
                cursor: "pointer",
                fontSize: 11,
              }}
              title={tab.path}
            >
              <span style={{ width: 12, textAlign: "center", color: tab.viewMode === "diff" ? "var(--ci-purple)" : "var(--ci-text-dim)", fontSize: 10 }}>
                {tab.viewMode === "diff" ? "≋" : "•"}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tab.title}
              </span>
              {dirty && <span style={{ color: "var(--ci-accent)", fontSize: 11 }}>●</span>}
            </button>
            <button
              onClick={() => closeTab(tabId)}
              style={{
                background: "none",
                border: "none",
                color: "var(--ci-text-dim)",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
                lineHeight: 1,
              }}
              title={`关闭 ${tab.title}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
