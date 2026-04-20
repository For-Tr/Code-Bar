import { useEffect, useMemo } from "react";
import { FileCode2, GitCommitHorizontal, X } from "lucide-react";
import { closeTab, revealExplorerPath } from "../../services/editorCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { WorkbenchTooltip } from "../ui/WorkbenchTooltip";

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
      minHeight: 34,
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
              padding: "0 10px",
              borderRight: "1px solid var(--ci-toolbar-border)",
              borderTop: isActive ? "1px solid var(--ci-accent)" : "1px solid transparent",
              background: isActive ? "var(--ci-surface)" : "transparent",
            }}
          >
            <button
              onClick={() => {
                setActiveTab(tabId);
                if (session && tab.viewMode === "code") {
                  revealExplorerPath(session.id, tab.path, "focusNoScroll", "editor-tabs");
                }
              }}
              onDoubleClick={() => pinTab(tabId)}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: "7px 0 6px",
                color: isActive ? "var(--ci-text)" : "var(--ci-text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
              title={tab.path}
            >
              <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: tab.viewMode === "diff" ? "var(--ci-purple)" : "var(--ci-text-dim)", flexShrink: 0 }}>
                {tab.viewMode === "diff" ? <GitCommitHorizontal size={11} strokeWidth={1.8} /> : <FileCode2 size={11} strokeWidth={1.8} />}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title}</span>
              {buffer?.dirty && <span style={{ color: "var(--ci-accent)", fontSize: 10, flexShrink: 0 }}>●</span>}
              {tab.preview && <span style={{ color: "var(--ci-text-dim)", fontSize: 9, flexShrink: 0 }}>preview</span>}
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
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: isActive ? 0.9 : 0.5,
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
