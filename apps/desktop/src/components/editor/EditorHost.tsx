import { useEffect } from "react";
import { useAppI18n } from "../../i18n";
import { loadFile, saveTab } from "../../services/editorCommands";
import { useEditorBufferStore, type EditorBufferState } from "../../store/editorBufferStore";
import { useEditorStore } from "../../store/editorStore";
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
      minHeight: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      boxSizing: "border-box",
      overflow: "hidden",
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
  const { t } = useAppI18n();
  return <EmptyEditorState message={t("session.binaryReadonly", { path })} />;
}
function DeletedEditorState({ path }: { path: string }) {
  const { t } = useAppI18n();
  return <EmptyEditorState message={t("session.deletedReadonly", { path })} />;
}

export function EditorHost({
  session,
  groupId,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  groupId: string;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const { t } = useAppI18n();
  const group = useEditorStore((s) => s.groupsById[groupId]);
  const tabsById = useEditorStore((s) => s.tabsById);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const activeGroupIdBySessionId = useEditorStore((s) => s.activeGroupIdBySessionId);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const updateDraft = useEditorBufferStore((s) => s.updateDraft);

  const tabIds = group?.tabIds ?? [];
  const resolvedActiveTabId = group?.activeTabId && tabIds.includes(group.activeTabId)
    ? group.activeTabId
    : (tabIds[tabIds.length - 1] ?? null);
  const activeTab = resolvedActiveTabId ? tabsById[resolvedActiveTabId] ?? null : null;
  const activeBuffer: EditorBufferState | null = resolvedActiveTabId ? (buffersByTabId[resolvedActiveTabId] ?? null) : null;
  const scmFiles = useScmStore((s) => session ? (s.snapshotBySessionId[session.id]?.files ?? session.diffFiles) : EMPTY_DIFF_FILES);
  const selectedScmEntry = useScmStore((s) => session ? (s.selectedEntryBySessionId[session.id] ?? null) : null);
  const diffOverride = useScmStore((s) => session ? (s.diffOverrideBySessionId[session.id] ?? null) : null);
  const activeFile = diffOverride?.path === activeTab?.path
    ? diffOverride
    : scmFiles.find((file) => file.path === activeTab?.path) ?? null;
  const isFocusedGroup = session ? activeGroupIdBySessionId[session.id] === groupId : false;

  useEffect(() => {
    if (resolvedActiveTabId && group && resolvedActiveTabId !== group.activeTabId) {
      setActiveTab(group.id, resolvedActiveTabId);
    }
  }, [group, resolvedActiveTabId, setActiveTab]);

  useEffect(() => {
    if (!activeTab || !session || !group) return;
    if (activeTab.sessionId !== session.id) return;
    if (activeTab.viewMode !== "code") return;
    const fileMeta = scmFiles.find((file) => file.path === activeTab.path) ?? null;
    if (fileMeta?.type === "deleted") return;
    if (activeBuffer?.loaded || activeBuffer?.loading || activeBuffer?.error) return;
    void loadFile(activeTab.id);
  }, [activeBuffer?.error, activeBuffer?.loaded, activeBuffer?.loading, activeTab, group, scmFiles, session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!isFocusedGroup || !activeTab || activeTab.viewMode !== "code") return;
      if (!session || !group || activeTab.sessionId !== session.id) return;
      event.preventDefault();
      if (activeBuffer?.dirty !== true || activeBuffer.saving || activeBuffer.isBinary || activeFile?.type === "deleted") return;
      void saveTab(activeTab.id).then(() => {
        onRefreshDiff(activeTab.sessionId, { reloadExplorer: true });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBuffer, activeFile?.type, activeTab, group, isFocusedGroup, onRefreshDiff, session]);

  if (!session || !group || !activeTab || activeTab.sessionId !== session.id) {
    return <EmptyEditorState message={session ? t("session.emptyOpenFileOrSession") : t("session.emptyChooseSessionWorkbench")} />;
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", color: "var(--ci-text-dim)", fontSize: 12 }}>
        {t("session.loadingFile")}
      </div>
    );
  }

  if (activeBuffer.error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", padding: 24, boxSizing: "border-box", color: "var(--ci-deleted-text)", fontSize: 12, lineHeight: 1.7 }}>
        {activeBuffer.error}
      </div>
    );
  }

  if (activeBuffer.isBinary) {
    return <BinaryEditorState path={activeTab.path} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 14px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "transparent",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--ci-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeTab.path}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 10, color: "var(--ci-text-dim)" }}>
            {activeBuffer.dirty ? <span style={{ color: "var(--ci-accent)" }}>{t("session.unsaved")}</span> : <span>{t("session.synced")}</span>}
            <span>{t("session.saveShortcut")}</span>
          </div>
        </div>
        <button
          onClick={() => {
            void saveTab(activeTab.id).then(() => {
              onRefreshDiff(activeTab.sessionId, { reloadExplorer: true });
            });
          }}
          disabled={!activeBuffer.dirty || activeBuffer.saving}
          onMouseEnter={e => {
            if (!activeBuffer.dirty || activeBuffer.saving) return;
            e.currentTarget.style.opacity = "0.8";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = activeBuffer.dirty ? "1" : "0.7";
          }}
          style={{
            background: "none",
            border: "none",
            color: activeBuffer.dirty ? "var(--ci-accent)" : "var(--ci-text-dim)",
            cursor: !activeBuffer.dirty || activeBuffer.saving ? "default" : "pointer",
            padding: "4px 2px",
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
            opacity: activeBuffer.dirty ? 1 : 0.7,
            transition: "opacity 0.12s",
          }}
        >
          {activeBuffer.saving ? t("common.saving") : t("common.save")}
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
