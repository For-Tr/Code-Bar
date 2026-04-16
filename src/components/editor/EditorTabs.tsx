import { useEffect, useMemo } from "react";
import { closeTab } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";

const EMPTY_TAB_ID_ARRAY: string[] = [];

export function EditorTabs({ session }: { session: ClaudeSession | null }) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsById = useEditorStore((s) => s.tabsById);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const pinTab = useEditorStore((s) => s.pinTab);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);

  const openTabs = useMemo(() => {
    if (!session) return EMPTY_TAB_ID_ARRAY;
    return tabOrder.filter((tabId) => tabsById[tabId]?.sessionId === session.id);
  }, [session, tabOrder, tabsById]);
  const resolvedActiveTabId = openTabs.includes(activeTabId ?? "")
    ? activeTabId
    : (openTabs[openTabs.length - 1] ?? null);

  useEffect(() => {
    if (resolvedActiveTabId && resolvedActiveTabId !== activeTabId) {
      setActiveTab(resolvedActiveTabId);
    }
  }, [activeTabId, resolvedActiveTabId, setActiveTab]);

  return (
    <div style={{
      display: "flex",
      alignItems: "stretch",
      minHeight: 36,
      borderBottom: "1px solid var(--ci-toolbar-border)",
      overflowX: "auto",
      scrollbarWidth: "none",
      background: "var(--ci-toolbar-bg)",
    }}>
      {openTabs.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px", fontSize: 11, color: "var(--ci-text-dim)" }}>
          未打开文件
        </div>
      ) : openTabs.map((tabId) => {
        const tab = tabsById[tabId];
        if (!tab) return null;
        const buffer = buffersByTabId[tabId];
        const isActive = resolvedActiveTabId === tabId;
        return (
          <div
            key={tabId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              maxWidth: 220,
              padding: "0 10px 0 12px",
              borderRight: "1px solid var(--ci-toolbar-border)",
              background: isActive ? "var(--ci-surface)" : "transparent",
            }}
          >
            <button
              onClick={() => setActiveTab(tabId)}
              onDoubleClick={() => pinTab(tabId)}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: "9px 0",
                color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
              title={tab.path}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title}</span>
              {tab.viewMode === "diff" && <span style={{ color: "var(--ci-text-dim)", fontSize: 10, flexShrink: 0 }}>Diff</span>}
              {buffer?.dirty && <span style={{ color: "var(--ci-accent)", fontSize: 11, flexShrink: 0 }}>●</span>}
              {tab.preview && <span style={{ color: "var(--ci-text-dim)", fontSize: 10, flexShrink: 0 }}>预览</span>}
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
                flexShrink: 0,
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
