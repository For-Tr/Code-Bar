import { useEffect, useMemo } from "react";
import { openFile, loadDirectory } from "../../services/editorCommands";
import { showScm, resetWorkbenchMode } from "../../services/workbenchCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { type ExplorerEntry, useExplorerStore } from "../../store/explorerStore";
import { EMPTY_SCM_GROUPS, useScmStore } from "../../store/scmStore";
import { useSettingsStore, isGlassTheme } from "../../store/settingsStore";
import { getWorkspaceColor, useWorkspaceStore } from "../../store/workspaceStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { OpenEditorsPane } from "./OpenEditorsPane";

type FileNode = {
  type: "file";
  key: string;
  name: string;
  path: string;
  depth: number;
  entry: ExplorerEntry;
};

type DirectoryNode = {
  type: "dir";
  key: string;
  name: string;
  path: string;
  depth: number;
  loading: boolean;
  error: string | null;
};

type TreeNode = FileNode | DirectoryNode;

const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_ENTRY_ARRAY: ExplorerEntry[] = [];

function collectAncestorDirs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
}

function buildTreeNodes(
  sessionId: string,
  expandedDirs: Set<string>,
  getEntries: (dir: string) => ExplorerEntry[],
  getLoading: (dir: string) => boolean,
  getError: (dir: string) => string | null,
): TreeNode[] {
  const nodes: TreeNode[] = [];

  const walk = (dirPath: string, depth: number) => {
    const entries = getEntries(dirPath);
    entries.forEach((entry) => {
      if (entry.kind === "dir") {
        nodes.push({
          type: "dir",
          key: `dir:${sessionId}:${entry.path}`,
          name: entry.name,
          path: entry.path,
          depth,
          loading: getLoading(entry.path),
          error: getError(entry.path),
        });
        if (expandedDirs.has(entry.path)) {
          walk(entry.path, depth + 1);
        }
        return;
      }
      nodes.push({
        type: "file",
        key: `file:${sessionId}:${entry.path}`,
        name: entry.name,
        path: entry.path,
        depth,
        entry,
      });
    });
  };

  walk("", 0);
  return nodes;
}

function FileStatusGlyph({ kind }: { kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted" | null }) {
  if (kind === "conflicted") return <span style={{ color: "var(--ci-red)", fontSize: 10, width: 12, textAlign: "center" }}>!</span>;
  if (kind === "untracked") return <span style={{ color: "var(--ci-green)", fontSize: 10, width: 12, textAlign: "center" }}>U</span>;
  if (kind === "added") return <span style={{ color: "var(--ci-green)", fontSize: 10, width: 12, textAlign: "center" }}>A</span>;
  if (kind === "deleted") return <span style={{ color: "var(--ci-red)", fontSize: 10, width: 12, textAlign: "center" }}>D</span>;
  if (kind === "renamed") return <span style={{ color: "var(--ci-purple)", fontSize: 10, width: 12, textAlign: "center" }}>R</span>;
  if (kind === "modified") return <span style={{ color: "var(--ci-yellow)", fontSize: 10, width: 12, textAlign: "center" }}>M</span>;
  return <span style={{ color: "var(--ci-text-dim)", fontSize: 10, width: 12, textAlign: "center" }}>•</span>;
}

export function ExplorerPane({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const accentColor = activeWorkspace ? getWorkspaceColor(activeWorkspace.color) : "var(--ci-accent)";
  const expandedDirsBySession = useExplorerStore((s) => s.expandedDirsBySession);
  const selectedPathBySession = useExplorerStore((s) => s.selectedPathBySession);
  const childrenBySessionPath = useExplorerStore((s) => s.childrenBySessionPath);
  const loadingBySessionPath = useExplorerStore((s) => s.loadingBySessionPath);
  const errorBySessionPath = useExplorerStore((s) => s.errorBySessionPath);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const scmSnapshot = useScmStore((s) => s.snapshotBySessionId[session.id]?.files ?? session.diffFiles);
  const scmGroups = useScmStore((s) => s.statusBySessionId[session.id] ?? EMPTY_SCM_GROUPS);
  const expandedDirs = expandedDirsBySession[session.id] ?? EMPTY_STRING_ARRAY;
  const selectedPath = selectedPathBySession[session.id] ?? null;
  const toggleDir = useExplorerStore((s) => s.toggleDir);
  const setExpandedDirs = useExplorerStore((s) => s.setExpandedDirs);
  const setSelectedPath = useExplorerStore((s) => s.setSelectedPath);
  const rootKey = `${session.id}:`;
  const rootLoading = loadingBySessionPath[rootKey] ?? false;
  const rootError = errorBySessionPath[rootKey] ?? null;

  useEffect(() => {
    if (!(rootKey in childrenBySessionPath) && !rootLoading && !rootError) {
      void loadDirectory(session.id, "");
    }
  }, [childrenBySessionPath, rootError, rootKey, rootLoading, session.id]);

  useEffect(() => {
    expandedDirs.forEach((dir) => {
      const key = `${session.id}:${dir}`;
      if (!childrenBySessionPath[key] && !loadingBySessionPath[key] && !errorBySessionPath[key]) {
        void loadDirectory(session.id, dir);
      }
    });
  }, [childrenBySessionPath, errorBySessionPath, expandedDirs, loadingBySessionPath, session.id]);

  const expandedDirSet = useMemo(() => new Set(expandedDirs), [expandedDirs]);
  const getEntries = (dir: string) => childrenBySessionPath[`${session.id}:${dir}`] ?? EMPTY_ENTRY_ARRAY;
  const getLoading = (dir: string) => loadingBySessionPath[`${session.id}:${dir}`] ?? false;
  const getError = (dir: string) => errorBySessionPath[`${session.id}:${dir}`] ?? null;
  const nodes = useMemo(
    () => buildTreeNodes(session.id, expandedDirSet, getEntries, getLoading, getError),
    [childrenBySessionPath, errorBySessionPath, expandedDirSet, loadingBySessionPath, session.id],
  );

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "space-between",
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <button
              onClick={resetWorkbenchMode}
              style={{ background: "none", border: "none", color: "var(--ci-text-muted)", cursor: "pointer", padding: 0, fontSize: 12, flexShrink: 0 }}
              title="返回会话视图"
            >
              ←
            </button>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ci-text-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Explorer
            </span>
          </div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: "var(--ci-text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {session.name}
            </span>
            {session.branchName && (
              <span style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 999, background: "var(--ci-purple-bg)", border: "1px solid var(--ci-purple-bdr)", color: "var(--ci-purple)", fontFamily: "monospace", flexShrink: 0 }}>
                ⎇ {session.branchName.replace("ci/", "")}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onRefreshDiff(session.id)}
          style={{ background: "none", border: "none", color: accentColor, cursor: "pointer", padding: 0, fontSize: 12, flexShrink: 0 }}
          title="刷新变更"
        >
          刷新
        </button>
      </div>

      <OpenEditorsPane session={session} />

      <div style={{
        padding: "8px 12px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Source Control
          </div>
          <button
            onClick={() => showScm(session.id)}
            style={{
              background: "var(--ci-btn-ghost-bg)",
              border: "1px solid var(--ci-toolbar-border)",
              color: "var(--ci-text-muted)",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            打开
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 10 }}>
          <span style={{ color: "var(--ci-text-dim)" }}>{workingTreeCount} 项工作区变更</span>
          {scmGroups.conflicts.length > 0 && <span style={{ color: "var(--ci-red)", fontWeight: 700 }}>{scmGroups.conflicts.length} 冲突</span>}
          {scmGroups.staged.length > 0 && <span style={{ color: "var(--ci-green-dark)", fontWeight: 700 }}>{scmGroups.staged.length} staged</span>}
          {scmGroups.unstaged.length > 0 && <span style={{ color: "var(--ci-yellow-dark)", fontWeight: 700 }}>{scmGroups.unstaged.length} changes</span>}
          {scmGroups.untracked.length > 0 && <span style={{ color: "var(--ci-green)", fontWeight: 700 }}>{scmGroups.untracked.length} untracked</span>}
        </div>
      </div>

      <div style={{ padding: "8px 12px 6px", fontSize: 10, color: "var(--ci-text-dim)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Files
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 10px" }}>
        {rootLoading ? (
          <div style={{ padding: "18px 10px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            正在载入项目文件…
          </div>
        ) : rootError ? (
          <div style={{ padding: "18px 10px", fontSize: 12, color: "var(--ci-deleted-text)", lineHeight: 1.7 }}>
            {rootError}
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: "18px 10px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            当前目录没有可显示文件。
          </div>
        ) : nodes.map((node) => {
          if (node.type === "dir") {
            const isOpen = expandedDirSet.has(node.path);
            return (
              <div key={node.key}>
                <button
                  onClick={() => {
                    toggleDir(session.id, node.path);
                    if (!isOpen && !childrenBySessionPath[`${session.id}:${node.path}`]) {
                      void loadDirectory(session.id, node.path);
                    }
                  }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", paddingLeft: 8 + node.depth * 14, borderRadius: 8, border: "none", background: "none", color: "var(--ci-text-muted)", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ width: 10, fontSize: 9, color: "var(--ci-text-dim)", flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
                  {node.loading && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ci-text-dim)" }}>…</span>}
                </button>
                {node.error && (
                  <div style={{ paddingLeft: 28 + node.depth * 14, paddingTop: 2, paddingBottom: 6, fontSize: 10, color: "var(--ci-deleted-text)" }}>
                    {node.error}
                  </div>
                )}
              </div>
            );
          }

          const isSelected = selectedPath === node.path;
          const buffer = buffersByTabId[`code:${session.id}:${node.path}`];
          const kind = statusByPath.get(node.path) ?? null;
          return (
            <button
              key={node.key}
              onClick={() => {
                const ancestors = collectAncestorDirs(node.path);
                if (ancestors.length > 0) {
                  setExpandedDirs(session.id, [...new Set([...expandedDirs, ...ancestors])]);
                  ancestors.forEach((dir) => {
                    if (!childrenBySessionPath[`${session.id}:${dir}`]) {
                      void loadDirectory(session.id, dir);
                    }
                  });
                }
                setSelectedPath(session.id, node.path);
                openFile(session.id, node.path, true);
              }}
              onDoubleClick={() => openFile(session.id, node.path, false)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", paddingLeft: 24 + node.depth * 14, borderRadius: 8, border: isSelected ? `1px solid ${accentColor}55` : "1px solid transparent", background: isSelected ? (isGlass ? "var(--ci-toolbar-bg)" : `${accentColor}12`) : "none", color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)", cursor: "pointer", textAlign: "left" }}
              title={node.path}
            >
              <FileStatusGlyph kind={kind} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
              {buffer?.dirty && <span style={{ color: accentColor, fontSize: 12, marginLeft: "auto" }}>●</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
