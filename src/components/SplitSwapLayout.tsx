import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PtyTerminal } from "./PtyTerminal";
import { SessionDetail } from "./SessionDetail";
import { UsageWidgetCard } from "./UsageWidgetCard";
import {
  useSettingsStore,
  type SplitWidgetCanvasItem,
  type SplitWidgetTerminalItem,
} from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const SESSION_DETAIL_ITEM_ID = "session-detail";

function shellQuote(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sanitizeSessionKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildWidgetTerminalSessionId(sessionId: string, ptySessionKey: string) {
  return `widget-${sanitizeSessionKey(sessionId)}-${sanitizeSessionKey(ptySessionKey)}`;
}

function createTerminalTab(tabs: SplitWidgetTerminalItem["tabs"]) {
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

function getFallbackActiveTabId(tabs: SplitWidgetTerminalItem["tabs"], removedIndex: number) {
  const fallback = tabs[Math.max(0, removedIndex - 1)] ?? tabs[removedIndex] ?? tabs[0];
  return fallback?.id ?? "";
}

function removeTabFromWidget(widget: SplitWidgetTerminalItem, tabId: string) {
  const tabIndex = widget.tabs.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) {
    return { nextWidget: widget, removedTab: null as SplitWidgetTerminalItem["tabs"][number] | null };
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

type SplitDisplayItem =
  | {
      id: typeof SESSION_DETAIL_ITEM_ID;
      kind: "session-detail";
      title: string;
    }
  | {
      id: string;
      kind: "terminal";
      title: string;
      widget: SplitWidgetTerminalItem;
    }
  | {
      id: string;
      kind: "usage";
      title: string;
      widget: Extract<SplitWidgetCanvasItem, { type: "usage" }>;
    };

interface SplitSwapContextValue {
  detailItemId: string;
  itemsById: Map<string, SplitDisplayItem>;
  getCardItemId: (slotId: string) => string;
  swapWithDetail: (slotId: string) => void;
  getContainer: (itemId: string) => HTMLDivElement;
}

const SplitSwapContext = createContext<SplitSwapContextValue | null>(null);

function useSplitSwapContext() {
  const value = useContext(SplitSwapContext);
  if (!value) {
    throw new Error("Split swap context is not available");
  }
  return value;
}

function SessionDetailBody({
  emptyState,
  openSessionId,
}: {
  emptyState?: ReactNode;
  openSessionId?: string | null;
}) {
  const { detailItemId } = useSplitSwapContext();
  const isSwappedIntoCard = detailItemId !== SESSION_DETAIL_ITEM_ID;

  const body = (
    <SessionDetail
      mode="embedded"
      showPanelHeader={false}
      emptyState={emptyState}
      openSessionId={openSessionId}
    />
  );

  if (!isSwappedIntoCard) {
    return body;
  }

  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: 0,
      padding: 3,
      boxSizing: "border-box",
      background: "#0a0a0c",
      ['--ci-pty-panel-bg' as string]: '#0a0a0c',
      ['--ci-pty-mask-bg' as string]: '#0a0a0c',
    }}>
      <div style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: "#0a0a0c",
      }}>
        {body}
      </div>
    </div>
  );
}

function TerminalWidgetBody({ itemId }: { itemId: string }) {
  const widget = useSettingsStore((s) => {
    const match = s.settings.splitWidgetCanvas.items.find((item) => item.id === itemId);
    return match?.type === "terminal" ? match : null;
  });
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const session = useMemo(
    () => sessions.find((item) => item.id === expandedSessionId) ?? null,
    [expandedSessionId, sessions]
  );
  const terminalWorkdir = session?.worktreePath ?? session?.workdir ?? "";
  const terminalCommand = navigator.userAgent.toLowerCase().includes("windows") ? "cmd.exe" : "sh";
  const terminalArgs = navigator.userAgent.toLowerCase().includes("windows")
    ? ["/K", `cd /d "${terminalWorkdir}"`]
    : ["-lc", `cd ${shellQuote(terminalWorkdir)} && exec zsh -i`];

  if (!widget) return null;

  if (!session || !terminalWorkdir) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        color: "var(--ci-text-dim)",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.7,
      }}>
        先在中间打开一个会话，terminal 组件才可用。
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {widget.tabs.map((tab) => {
        const ptySessionId = buildWidgetTerminalSessionId(session.id, tab.ptySessionKey);
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
            <PtyTerminal
              sessionId={ptySessionId}
              command={terminalCommand}
              args={terminalArgs}
              workdir={terminalWorkdir}
              active={isActiveTab}
            />
          </div>
        );
      })}
    </div>
  );
}

function SplitSwapItemPortal({
  item,
  sessionDetailEmptyState,
  detailSessionId,
}: {
  item: SplitDisplayItem;
  sessionDetailEmptyState?: ReactNode;
  detailSessionId?: string | null;
}) {
  const { getContainer } = useSplitSwapContext();
  const container = getContainer(item.id);

  if (item.kind === "session-detail") {
    return createPortal(
      <SessionDetailBody emptyState={sessionDetailEmptyState} openSessionId={detailSessionId} />,
      container,
      item.id
    );
  }

  if (item.kind === "terminal") {
    return createPortal(<TerminalWidgetBody itemId={item.id} />, container, item.id);
  }

  return createPortal(<UsageWidgetCard />, container, item.id);
}

export function SplitSwapProvider({
  children,
  sessionDetailEmptyState,
}: {
  children: ReactNode;
  sessionDetailEmptyState?: ReactNode;
}) {
  const splitDetailItemId = useSessionStore((s) => s.splitDetailItemId);
  const splitCardItemIdsBySlot = useSessionStore((s) => s.splitCardItemIdsBySlot);
  const swapSplitDetailWithCard = useSessionStore((s) => s.swapSplitDetailWithCard);
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const widgetItems = useSettingsStore((s) => s.settings.splitWidgetCanvas.items);
  const containerMapRef = useRef(new Map<string, HTMLDivElement>());

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const expandedSession = useMemo(
    () => sessions.find((item) => item.id === expandedSessionId) ?? null,
    [expandedSessionId, sessions]
  );
  const detailSessionId = expandedSession?.workspaceId === activeWorkspaceId ? expandedSession.id : null;
  const terminalTitle = expandedSession?.worktreePath ?? expandedSession?.workdir ?? "Terminal";

  const itemsById = useMemo(() => {
    const next = new Map<string, SplitDisplayItem>();
    next.set(SESSION_DETAIL_ITEM_ID, {
      id: SESSION_DETAIL_ITEM_ID,
      kind: "session-detail",
      title: detailSessionId ? (expandedSession?.name ?? "Session Detail") : "Session Detail",
    });

    widgetItems.forEach((item) => {
      if (item.type === "terminal") {
        next.set(item.id, {
          id: item.id,
          kind: "terminal",
          title: terminalTitle || "Terminal",
          widget: item,
        });
        return;
      }
      next.set(item.id, {
        id: item.id,
        kind: "usage",
        title: "Usage",
        widget: item,
      });
    });

    return next;
  }, [detailSessionId, expandedSession?.name, terminalTitle, widgetItems]);

  useEffect(() => {
    const validSlotIds = new Set(widgetItems.map((item) => item.id));
    const validItemIds = new Set(itemsById.keys());
    const nextDetailItemId = validItemIds.has(splitDetailItemId) ? splitDetailItemId : SESSION_DETAIL_ITEM_ID;
    const nextCardMap = Object.fromEntries(
      Object.entries(splitCardItemIdsBySlot)
        .filter(([slotId, itemId]) => validSlotIds.has(slotId) && validItemIds.has(itemId))
        .map(([slotId, itemId]) => [slotId, itemId === slotId ? undefined : itemId])
        .filter(([, itemId]) => typeof itemId === "string") as [string, string][]
    );
    const cardMapChanged = JSON.stringify(nextCardMap) !== JSON.stringify(splitCardItemIdsBySlot);
    if (!cardMapChanged && nextDetailItemId === splitDetailItemId) return;
    useSessionStore.setState({
      splitDetailItemId: nextDetailItemId,
      splitCardItemIdsBySlot: nextCardMap,
    });
  }, [itemsById, splitCardItemIdsBySlot, splitDetailItemId, widgetItems]);

  const getContainer = useCallback((itemId: string) => {
    let container = containerMapRef.current.get(itemId);
    if (!container) {
      container = document.createElement("div");
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.minHeight = "0";
      containerMapRef.current.set(itemId, container);
    }
    return container;
  }, []);

  const getCardItemId = useCallback((slotId: string) => {
    return splitCardItemIdsBySlot[slotId] ?? slotId;
  }, [splitCardItemIdsBySlot]);

  const value = useMemo<SplitSwapContextValue>(() => ({
    detailItemId: splitDetailItemId,
    itemsById,
    getCardItemId,
    swapWithDetail: swapSplitDetailWithCard,
    getContainer,
  }), [getCardItemId, getContainer, itemsById, splitDetailItemId, swapSplitDetailWithCard]);

  return (
    <SplitSwapContext.Provider value={value}>
      {children}
      {Array.from(itemsById.values()).map((item) => (
        <SplitSwapItemPortal
          key={item.id}
          item={item}
          sessionDetailEmptyState={sessionDetailEmptyState}
          detailSessionId={detailSessionId}
        />
      ))}
    </SplitSwapContext.Provider>
  );
}

export function SplitDockOutlet({ itemId }: { itemId: string }) {
  const { getContainer } = useSplitSwapContext();
  const hostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const container = getContainer(itemId);
    host.appendChild(container);
    return () => {
      if (container.parentElement === host) {
        host.removeChild(container);
      }
    };
  }, [getContainer, itemId]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}

export function SplitStaticTerminalTabs({ itemId }: { itemId: string }) {
  const { patchSettings, settings } = useSettingsStore();
  const widget = useSettingsStore((s) => {
    const match = s.settings.splitWidgetCanvas.items.find((item) => item.id === itemId);
    return match?.type === "terminal" ? match : null;
  });

  if (!widget) return null;

  const updateTerminalWidget = (updater: (current: SplitWidgetTerminalItem) => SplitWidgetTerminalItem) => {
    patchSettings({
      splitWidgetCanvas: {
        ...settings.splitWidgetCanvas,
        items: settings.splitWidgetCanvas.items.map((item) => (
          item.id === itemId && item.type === "terminal"
            ? updater(item)
            : item
        )),
      },
    });
  };

  return (
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
          const canClose = widget.tabs.length > 1;
          return (
            <div
              key={tab.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                minWidth: 0,
                padding: "2px 4px 2px 8px",
                borderRadius: 9,
                border: `1px solid ${isActive ? "var(--ci-accent-bdr)" : "transparent"}`,
                background: isActive ? "var(--ci-accent-bg)" : "rgba(255,255,255,0.02)",
              }}
            >
              <button
                onClick={() => {
                  if (isActive) return;
                  updateTerminalWidget((current) => ({
                    ...current,
                    activeTabId: tab.id,
                  }));
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
                  onClick={() => {
                    updateTerminalWidget((current) => {
                      const nextWidget = removeTabFromWidget(current, tab.id).nextWidget;
                      return nextWidget ?? current;
                    });
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
        })}
      </div>

      <button
        onClick={() => {
          updateTerminalWidget((current) => {
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
  );
}

export function SplitDetailHost() {
  const { detailItemId, itemsById } = useSplitSwapContext();
  const setExpandedSession = useSessionStore((s) => s.setExpandedSession);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const item = itemsById.get(detailItemId) ?? itemsById.get(SESSION_DETAIL_ITEM_ID)!;

  return (
    <div style={{
      position: "relative",
      width: "100%",
      height: "100%",
      minHeight: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      background: "var(--ci-surface-hi)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
        flexShrink: 0,
      }}>
        <div style={{
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 10,
          fontFamily: "monospace",
          color: "var(--ci-text-muted)",
        }}>
          {item.title}
        </div>
        {item.kind === "terminal" && <SplitStaticTerminalTabs itemId={item.id} />}
        {item.kind === "session-detail" && expandedSessionId && (
          <button
            onClick={() => setExpandedSession(null)}
            style={{
              background: "none",
              border: "1px solid var(--ci-toolbar-border)",
              borderRadius: 8,
              color: "var(--ci-text-muted)",
              cursor: "pointer",
              fontSize: 11,
              padding: "3px 8px",
              flexShrink: 0,
            }}
          >
            收起
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <SplitDockOutlet itemId={item.id} />
      </div>
    </div>
  );
}

export function useSplitSwapSnapshot() {
  const { detailItemId, itemsById, getCardItemId, swapWithDetail } = useSplitSwapContext();
  return {
    detailItemId,
    itemsById,
    getCardItemId,
    swapWithDetail,
  };
}
