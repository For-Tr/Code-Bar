import { useEffect, useMemo, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  RefreshCw,
} from "lucide-react";
import { openFile, loadDirectory } from "../../services/editorCommands";
import { showScm, resetWorkbenchMode } from "../../services/workbenchCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { getExplorerDirectoryError, getExplorerDirectoryLoading, hasExplorerDirectorySnapshot, selectExplorerViewModel, useExplorerStore } from "../../store/explorerStore";
import { EMPTY_SCM_GROUPS, useScmStore } from "../../store/scmStore";
import { useSettingsStore } from "../../store/settingsStore";
import { type ClaudeSession } from "../../store/sessionStore";

function FileStatusGlyph({ kind }: { kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted" | null }) {
  const color = kind === "conflicted"
    ? "var(--ci-red)"
    : kind === "untracked" || kind === "added"
    ? "var(--ci-green)"
    : kind === "deleted"
    ? "var(--ci-red)"
    : kind === "renamed"
    ? "var(--ci-purple)"
    : kind === "modified"
    ? "var(--ci-yellow)"
    : "var(--ci-text-dim)";
  const text = kind === "conflicted"
    ? "!"
    : kind === "untracked"
    ? "U"
    : kind === "added"
    ? "A"
    : kind === "deleted"
    ? "D"
    : kind === "renamed"
    ? "R"
    : kind === "modified"
    ? "M"
    : "";
  return <span style={{ color, fontSize: 10, width: 12, textAlign: "center", fontWeight: 700 }}>{text}</span>;
}

const rowBaseStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  minHeight: 22,
  border: "none",
  background: "transparent",
  textAlign: "left" as const,
};

export function ExplorerPane({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null, options?: { reloadExplorer?: boolean }) => void;
}) {
  const theme = useSettingsStore((s) => s.settings.theme);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const scmSnapshot = useScmStore((s) => s.snapshotBySessionId[session.id]?.files ?? session.diffFiles);
  const scmGroups = useScmStore((s) => s.statusBySessionId[session.id] ?? EMPTY_SCM_GROUPS);
  const explorerStore = useExplorerStore();
  const explorerView = useMemo(() => selectExplorerViewModel(explorerStore, session.id), [explorerStore, session.id]);
  const { toggleDir } = explorerStore;
  const { expandedDirs, selectedPath, selectedRevealMode, rootLoading, rootError, hasRootSnapshot, rowCount, rowIndexByPath, pathByRowIndex, visiblePathSet, visibleRows } = explorerView;
  const touchedPaths = explorerStore.touchedPathsBySession[session.id] ?? [];
  const touchedPathSet = useMemo(() => new Set(touchedPaths), [touchedPaths]);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  const rowActiveBackground = theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,122,255,0.10)";
  void rowIndexByPath;
  void pathByRowIndex;
  void visiblePathSet;

  useEffect(() => {
    const explorerState = useExplorerStore.getState();
    if (!hasExplorerDirectorySnapshot(explorerState, session.id, "") && !getExplorerDirectoryLoading(explorerState, session.id, "") && !getExplorerDirectoryError(explorerState, session.id, "")) {
      void loadDirectory(session.id, "");
    }
  }, [session.id]);

  useEffect(() => {
    const explorerState = useExplorerStore.getState();
    expandedDirs.forEach((dir) => {
      if (!hasExplorerDirectorySnapshot(explorerState, session.id, dir) && !getExplorerDirectoryLoading(explorerState, session.id, dir) && !getExplorerDirectoryError(explorerState, session.id, dir)) {
        void loadDirectory(session.id, dir);
      }
    });
  }, [expandedDirs, session.id]);

  const statusByPath = useMemo(() => {
    const map = new Map<string, "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted">();
    scmSnapshot.forEach((file) => {
      map.set(file.path, file.type === "added" ? "added" : file.type === "deleted" ? "deleted" : "modified");
    });
    scmGroups.conflicts.forEach((entry) => map.set(entry.path, "conflicted"));
    scmGroups.staged.forEach((entry) => map.set(entry.path, entry.kind));
    scmGroups.unstaged.forEach((entry) => map.set(entry.path, entry.kind));
    scmGroups.untracked.forEach((entry) => map.set(entry.path, "untracked"));
    return map;
  }, [scmGroups.conflicts, scmGroups.staged, scmGroups.unstaged, scmGroups.untracked, scmSnapshot]);

  const workingTreeCount = scmGroups.conflicts.length + scmGroups.staged.length + scmGroups.unstaged.length + scmGroups.untracked.length;

  useEffect(() => {
    if (!selectedPath) return;
    if (selectedRevealMode === false || selectedRevealMode === "focusNoScroll") return;
    if (!visiblePathSet.has(selectedPath)) return;
    const container = treeScrollRef.current;
    if (!container) return;
    const selectedIndex = rowIndexByPath[selectedPath];
    if (selectedIndex == null) return;
    const rowElement = container.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    if (!rowElement) return;

    const rowTop = rowElement.offsetTop;
    const rowBottom = rowTop + rowElement.offsetHeight;
    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + container.clientHeight;
    const fullyVisible = rowTop >= viewportTop && rowBottom <= viewportBottom;
    if (fullyVisible && selectedRevealMode !== "force") return;

    const nextScrollTop = Math.max(0, rowTop - Math.max(0, container.clientHeight * 0.5 - rowElement.offsetHeight * 0.5));
    container.scrollTo({ top: nextScrollTop, behavior: "smooth" });
  }, [selectedPath, selectedRevealMode, rowIndexByPath, visiblePathSet]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--ci-toolbar-bg)" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 6,
        padding: "6px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onRefreshDiff(session.id, { reloadExplorer: true })}
            style={{ background: "none", border: "none", color: rootLoading ? "var(--ci-text)" : "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", opacity: rootLoading ? 1 : 0.85 }}
            title="刷新变更"
          >
            <RefreshCw size={13} strokeWidth={1.8} />
          </button>
          <button
            onClick={resetWorkbenchMode}
            style={{ background: "none", border: "none", color: "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
            title="返回会话视图"
          >
            <ChevronLeftGlyph />
          </button>
        </div>
      </div>

      <div style={{ padding: "8px 0 10px", borderBottom: "1px solid var(--ci-toolbar-border)" }}>
        <div style={{ padding: "0 12px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Source Control
          </div>
          <button
            onClick={() => showScm(session.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--ci-text-dim)",
              padding: 0,
              fontSize: 10,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Open
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 12px", fontSize: 10, color: "var(--ci-text-dim)" }}>
          <span>{workingTreeCount} changes</span>
          {scmGroups.conflicts.length > 0 && <span style={{ color: "var(--ci-red)", fontWeight: 700 }}>{scmGroups.conflicts.length} conflicts</span>}
          {scmGroups.staged.length > 0 && <span style={{ color: "var(--ci-green-dark)", fontWeight: 700 }}>{scmGroups.staged.length} staged</span>}
          {scmGroups.unstaged.length > 0 && <span style={{ color: "var(--ci-yellow-dark)", fontWeight: 700 }}>{scmGroups.unstaged.length} changes</span>}
          {scmGroups.untracked.length > 0 && <span style={{ color: "var(--ci-green)", fontWeight: 700 }}>{scmGroups.untracked.length} untracked</span>}
        </div>
      </div>

      <div style={{ padding: "8px 12px 6px", fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Files
      </div>

      <div ref={treeScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 0 10px" }}>
        {rootLoading && !hasRootSnapshot ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            正在载入项目文件…
          </div>
        ) : rootError ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-deleted-text)", lineHeight: 1.7 }}>
            {rootError}
          </div>
        ) : rowCount === 0 ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            当前目录没有可显示文件。
          </div>
        ) : visibleRows.map((node) => {
          if (node.type === "dir") {
            const isOpen = expandedDirs.includes(node.path);
            const isTouched = touchedPathSet.has(node.path);
            return (
              <div key={node.key}>
                <button
                  onClick={() => {
                    toggleDir(session.id, node.path);
                    if (!isOpen && !useExplorerStore.getState().childrenBySessionPath[`${session.id}:${node.path}`]) {
                      void loadDirectory(session.id, node.path);
                    }
                  }}
                  style={{
                    ...rowBaseStyle,
                    padding: "0 10px",
                    paddingLeft: 8 + node.depth * 14,
                    color: "var(--ci-text-muted)",
                    cursor: "pointer",
                    outline: isTouched ? "1px solid var(--ci-accent-bdr)" : "none",
                    outlineOffset: -1,
                  }}
                >
                  <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ci-text-dim)", flexShrink: 0 }}>
                    {isOpen ? <ChevronDown size={12} strokeWidth={1.8} /> : <ChevronRight size={12} strokeWidth={1.8} />}
                  </span>
                  <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ci-text-dim)", flexShrink: 0 }}>
                    <Folder size={12} strokeWidth={1.8} />
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }} data-row-index={node.index}>{node.name}</span>
                  {node.loading && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ci-text-dim)" }}>…</span>}
                </button>
                {node.error && (
                  <div style={{ paddingLeft: 34 + node.depth * 14, paddingTop: 2, paddingBottom: 6, fontSize: 10, color: "var(--ci-deleted-text)" }}>
                    {node.error}
                  </div>
                )}
              </div>
            );
          }

          const isSelected = selectedPath === node.path;
          const buffer = buffersByTabId[`code:${session.id}:${node.path}`];
          const kind = statusByPath.get(node.path) ?? null;
          const isTouched = touchedPathSet.has(node.path);
          return (
            <button
              key={node.key}
              onClick={() => {
                openFile(session.id, node.path, true, true);
              }}
              onDoubleClick={() => openFile(session.id, node.path, false, true)}
              style={{
                ...rowBaseStyle,
                padding: "0 10px",
                paddingLeft: 24 + node.depth * 14,
                background: isSelected ? rowActiveBackground : "transparent",
                color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)",
                cursor: "pointer",
                borderLeft: isSelected ? "1px solid var(--ci-accent)" : "1px solid transparent",
                outline: isTouched ? "1px solid var(--ci-accent-bdr)" : "none",
                outlineOffset: -1,
              }}
              title={node.path}
            >
              <FileStatusGlyph kind={kind} />
              <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: isSelected ? "var(--ci-text)" : "var(--ci-text-dim)", flexShrink: 0 }}>
                <FileCode2 size={11} strokeWidth={1.8} />
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }} data-row-index={node.index}>{node.name}</span>
              {buffer?.dirty && <span style={{ color: "var(--ci-accent)", fontSize: 10, marginLeft: "auto" }}>●</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChevronLeftGlyph() {
  return <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, fontSize: 12 }}>←</span>;
}
