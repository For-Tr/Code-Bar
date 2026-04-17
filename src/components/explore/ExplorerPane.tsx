import { useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { openFile, loadDirectory } from "../../services/editorCommands";
import { showScm, resetWorkbenchMode } from "../../services/workbenchCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { type ExplorerEntry, useExplorerStore } from "../../store/explorerStore";
import { EMPTY_SCM_GROUPS, useScmStore } from "../../store/scmStore";
import { useSettingsStore } from "../../store/settingsStore";
import { type ClaudeSession } from "../../store/sessionStore";
import { OpenEditorsPane } from "./OpenEditorsPane";
import { WorkbenchTooltip } from "../ui/WorkbenchTooltip";

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
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const theme = useSettingsStore((s) => s.settings.theme);
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
  const rowActiveBackground = theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,122,255,0.10)";

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--ci-toolbar-bg)" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 10px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ci-text-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Explorer
          </div>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: "var(--ci-text)", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {session.name}
            </span>
            {session.branchName && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--ci-text-dim)" }}>
                <GitBranch size={11} strokeWidth={1.8} />
                <span style={{ fontFamily: "monospace" }}>{session.branchName.replace("ci/", "")}</span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <WorkbenchTooltip label="刷新变更">
            <button
              onClick={() => onRefreshDiff(session.id)}
              style={{ background: "none", border: "none", color: "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="刷新变更"
            >
              <RefreshCw size={13} strokeWidth={1.8} />
            </button>
          </WorkbenchTooltip>
          <WorkbenchTooltip label="返回会话视图">
            <button
              onClick={resetWorkbenchMode}
              style={{ background: "none", border: "none", color: "var(--ci-text-dim)", cursor: "pointer", padding: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="返回会话视图"
            >
              <ChevronLeftGlyph />
            </button>
          </WorkbenchTooltip>
        </div>
      </div>

      <OpenEditorsPane session={session} />

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

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 0 10px" }}>
        {rootLoading ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            正在载入项目文件…
          </div>
        ) : rootError ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-deleted-text)", lineHeight: 1.7 }}>
            {rootError}
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
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
                  style={{
                    ...rowBaseStyle,
                    padding: "0 10px",
                    paddingLeft: 8 + node.depth * 14,
                    color: "var(--ci-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ci-text-dim)", flexShrink: 0 }}>
                    {isOpen ? <ChevronDown size={12} strokeWidth={1.8} /> : <ChevronRight size={12} strokeWidth={1.8} />}
                  </span>
                  <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ci-text-dim)", flexShrink: 0 }}>
                    <Folder size={12} strokeWidth={1.8} />
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
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
              style={{
                ...rowBaseStyle,
                padding: "0 10px",
                paddingLeft: 24 + node.depth * 14,
                background: isSelected ? rowActiveBackground : "transparent",
                color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)",
                cursor: "pointer",
                borderLeft: isSelected ? "1px solid var(--ci-accent)" : "1px solid transparent",
              }}
              title={node.path}
            >
              <FileStatusGlyph kind={kind} />
              <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: isSelected ? "var(--ci-text)" : "var(--ci-text-dim)", flexShrink: 0 }}>
                <FileCode2 size={11} strokeWidth={1.8} />
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
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
