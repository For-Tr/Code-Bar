import { useEffect, useMemo, useRef } from "react";
import { loadFile, revealExplorerPath, saveTab } from "../../services/editorCommands";
import { useEditorBufferStore, type EditorBufferState } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useScmStore } from "../../store/scmStore";
import { type ClaudeSession, type DiffFile } from "../../store/sessionStore";
import { CodeEditorSurface } from "./CodeEditorSurface";
import { ConflictDetailSurface } from "./ConflictDetailSurface";
import { DiffEditorSurface } from "./DiffEditorSurface";

const EMPTY_DIFF_FILES: DiffFile[] = [];

function EmptyEditorState({ message }: { message: string }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 280,
        padding: "22px 24px",
        borderRadius: 18,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-surface)",
        color: "var(--ci-text-dim)",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.7,
      }}>
        {message}
      </div>
    </div>
  );
}

function BinaryEditorState({ path }: { path: string }) {
  return <EmptyEditorState message={`二进制文件暂不支持编辑：${path}`} />;
}
function DeletedEditorState({ path }: { path: string }) {
  return <EmptyEditorState message={`该文件已被删除，当前仅提供只读占位：${path}`} />;
}

export function EditorHost({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsById = useEditorStore((s) => s.tabsById);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const updateDraft = useEditorBufferStore((s) => s.updateDraft);
  const lastExplorerSelectionKeyRef = useRef<string | null>(null);

  const sessionTabIds = useMemo(() => {
    if (!session) return [] as string[];
    return tabOrder.filter((tabId) => tabsById[tabId]?.sessionId === session.id);
  }, [session, tabOrder, tabsById]);
  const resolvedActiveTabId = sessionTabIds.includes(activeTabId ?? "")
    ? activeTabId
    : (sessionTabIds[sessionTabIds.length - 1] ?? null);
  const activeTab = resolvedActiveTabId ? tabsById[resolvedActiveTabId] ?? null : null;
  const activeBuffer: EditorBufferState | null = resolvedActiveTabId ? (buffersByTabId[resolvedActiveTabId] ?? null) : null;
  const scmFiles = useScmStore((s) => session ? (s.snapshotBySessionId[session.id]?.files ?? session.diffFiles) : EMPTY_DIFF_FILES);
  const selectedScmEntry = useScmStore((s) => session ? (s.selectedEntryBySessionId[session.id] ?? null) : null);
  const diffOverride = useScmStore((s) => session ? (s.diffOverrideBySessionId[session.id] ?? null) : null);
  const activeFile = diffOverride?.path === activeTab?.path
    ? diffOverride
    : scmFiles.find((file) => file.path === activeTab?.path) ?? null;

  useEffect(() => {
    if (resolvedActiveTabId && resolvedActiveTabId !== activeTabId) {
      setActiveTab(resolvedActiveTabId);
    }
  }, [activeTabId, resolvedActiveTabId, setActiveTab]);

  useEffect(() => {
    if (!activeTab || !session) return;
    if (activeTab.sessionId !== session.id) return;
    const selectionKey = `${activeTab.sessionId}:${activeTab.viewMode}:${activeTab.path}`;
    if (lastExplorerSelectionKeyRef.current === selectionKey) return;
    lastExplorerSelectionKeyRef.current = selectionKey;
    revealExplorerPath(session.id, activeTab.path, "focusNoScroll", "editor");
  }, [activeTab?.path, activeTab?.sessionId, activeTab?.viewMode, session?.id]);

  useEffect(() => {
    if (!activeTab || !session) return;
    if (activeTab.sessionId !== session.id) return;
    if (activeTab.viewMode !== "code") return;
    const fileMeta = scmFiles.find((file) => file.path === activeTab.path) ?? null;
    if (fileMeta?.type === "deleted") return;
    if (activeBuffer?.loaded || activeBuffer?.loading || activeBuffer?.error) return;
    void loadFile(activeTab.id);
  }, [activeBuffer?.error, activeBuffer?.loaded, activeBuffer?.loading, activeTab, scmFiles, session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!activeTab || activeTab.viewMode !== "code") return;
      if (!session || activeTab.sessionId !== session.id) return;
      event.preventDefault();
      if (activeBuffer?.dirty !== true || activeBuffer.saving || activeBuffer.isBinary || activeFile?.type === "deleted") return;
      void saveTab(activeTab.id).then(() => {
        onRefreshDiff(activeTab.sessionId, { reloadExplorer: true });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBuffer, activeFile?.type, activeTab, onRefreshDiff, session]);

  if (!session || !activeTab || activeTab.sessionId !== session.id) {
    return <EmptyEditorState message={session ? "从左侧选择一个文件开始查看或编辑。" : "选择一个会话进入工作台。"} />;
  }

  if (activeTab.viewMode === "diff") {
    if (selectedScmEntry?.group === "conflicts") {
      return <ConflictDetailSurface sessionId={session.id} path={activeTab.path} />;
    }
    return <DiffEditorSurface sessionId={session.id} file={activeFile} selectedEntry={selectedScmEntry} />;
  }

  if (activeFile?.type === "deleted") {
    return <DeletedEditorState path={activeTab.path} />;
  }

  if (!activeBuffer || activeBuffer.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--ci-text-dim)", fontSize: 12 }}>
        载入文件中…
      </div>
    );
  }

  if (activeBuffer.error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24, color: "var(--ci-deleted-text)", fontSize: 12, lineHeight: 1.7 }}>
        {activeBuffer.error}
      </div>
    );
  }

  if (activeBuffer.isBinary) {
    return <BinaryEditorState path={activeTab.path} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 14px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--ci-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeTab.path}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 10, color: "var(--ci-text-dim)" }}>
            {activeBuffer.dirty ? <span style={{ color: "var(--ci-accent)" }}>未保存</span> : <span>已同步</span>}
            <span>⌘/Ctrl + S 保存</span>
          </div>
        </div>
        <button
          onClick={() => {
            void saveTab(activeTab.id).then(() => {
              onRefreshDiff(activeTab.sessionId, { reloadExplorer: true });
            });
          }}
          disabled={!activeBuffer.dirty || activeBuffer.saving}
          style={{
            background: activeBuffer.dirty ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
            border: `1px solid ${activeBuffer.dirty ? "var(--ci-accent-bdr)" : "var(--ci-toolbar-border)"}`,
            color: activeBuffer.dirty ? "var(--ci-accent)" : "var(--ci-text-dim)",
            cursor: !activeBuffer.dirty || activeBuffer.saving ? "default" : "pointer",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {activeBuffer.saving ? "保存中…" : "保存"}
        </button>
      </div>

      <CodeEditorSurface
        path={activeTab.path}
        value={activeBuffer.content}
        onChange={(value) => updateDraft(activeTab.id, value)}
      />

      {activeBuffer.error && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--ci-toolbar-border)", color: "var(--ci-deleted-text)", fontSize: 11 }}>
          {activeBuffer.error}
        </div>
      )}
    </div>
  );
}
