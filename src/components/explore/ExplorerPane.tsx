import { useMemo } from "react";
import { openFile } from "../../services/editorCommands";
import { resetWorkbenchMode } from "../../services/workbenchCommands";
import { useEditorBufferStore } from "../../store/editorBufferStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useScmStore } from "../../store/scmStore";
import { useSettingsStore, isGlassTheme } from "../../store/settingsStore";
import { getWorkspaceColor, useWorkspaceStore } from "../../store/workspaceStore";
import { type ClaudeSession, type DiffFile } from "../../store/sessionStore";

type FileNode = {
  type: "file";
  key: string;
  name: string;
  path: string;
  depth: number;
  file: DiffFile;
};

type DirectoryNode = {
  type: "dir";
  key: string;
  name: string;
  path: string;
  depth: number;
};

type TreeNode = FileNode | DirectoryNode;

const EMPTY_STRING_ARRAY: string[] = [];

function collectAncestorDirs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
}

function buildTreeNodes(files: DiffFile[], expandedDirs: Set<string>): TreeNode[] {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const nodes: TreeNode[] = [];
  const emittedDirs = new Set<string>();

  const walk = (items: DiffFile[], depth: number, dirPath: string) => {
    const groups = new Map<string, DiffFile[]>();
    const directFiles: DiffFile[] = [];

    items.forEach((file) => {
      const relative = dirPath ? file.path.slice(dirPath.length + 1) : file.path;
      const [head, ...rest] = relative.split("/");
      if (!head) return;
      if (rest.length === 0) {
        directFiles.push(file);
        return;
      }
      const nextDir = dirPath ? `${dirPath}/${head}` : head;
      const bucket = groups.get(nextDir) ?? [];
      bucket.push(file);
      groups.set(nextDir, bucket);
    });

    [...groups.keys()].sort().forEach((path) => {
      if (!emittedDirs.has(path)) {
        emittedDirs.add(path);
        nodes.push({ type: "dir", key: `dir:${path}`, name: path.split("/").pop() ?? path, path, depth });
      }
      if (expandedDirs.has(path)) {
        walk(groups.get(path) ?? [], depth + 1, path);
      }
    });

    directFiles.sort((a, b) => a.path.localeCompare(b.path)).forEach((file) => {
      nodes.push({ type: "file", key: `file:${file.path}`, name: file.path.split("/").pop() ?? file.path, path: file.path, depth, file });
    });
  };

  walk(sortedFiles, 0, "");
  return nodes;
}

function FileStatusGlyph({ file }: { file: DiffFile }) {
  if (file.binary) return <span style={{ color: "var(--ci-purple)", fontSize: 10, width: 12, textAlign: "center" }}>⬡</span>;
  if (file.type === "added") return <span style={{ color: "var(--ci-green)", fontSize: 10, width: 12, textAlign: "center" }}>A</span>;
  if (file.type === "deleted") return <span style={{ color: "var(--ci-red)", fontSize: 10, width: 12, textAlign: "center" }}>D</span>;
  return <span style={{ color: "var(--ci-yellow)", fontSize: 10, width: 12, textAlign: "center" }}>M</span>;
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
  const scmFiles = useScmStore((s) => s.snapshotBySessionId[session.id]?.files ?? session.diffFiles);
  const buffersByTabId = useEditorBufferStore((s) => s.buffersByTabId);
  const expandedDirs = expandedDirsBySession[session.id] ?? EMPTY_STRING_ARRAY;
  const selectedPath = selectedPathBySession[session.id] ?? null;
  const toggleDir = useExplorerStore((s) => s.toggleDir);
  const setExpandedDirs = useExplorerStore((s) => s.setExpandedDirs);
  const setSelectedPath = useExplorerStore((s) => s.setSelectedPath);

  const expandedDirSet = useMemo(() => new Set(expandedDirs), [expandedDirs]);
  const nodes = useMemo(() => buildTreeNodes(scmFiles, expandedDirSet), [expandedDirSet, scmFiles]);
  const totalAdditions = scmFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = scmFiles.reduce((sum, file) => sum + file.deletions, 0);

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

      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--ci-toolbar-border)", display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--ci-text-dim)" }}>
        <span>{scmFiles.length} 个文件</span>
        <span style={{ color: "var(--ci-green-dark)", fontWeight: 700 }}>+{totalAdditions}</span>
        <span style={{ color: "var(--ci-deleted-text)", fontWeight: 700 }}>−{totalDeletions}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 8px 10px" }}>
        {nodes.length === 0 ? (
          <div style={{ padding: "18px 10px", fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.7 }}>
            当前会话暂无变更文件。
          </div>
        ) : nodes.map((node) => {
          if (node.type === "dir") {
            const isOpen = expandedDirSet.has(node.path);
            return (
              <button
                key={node.key}
                onClick={() => toggleDir(session.id, node.path)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", paddingLeft: 8 + node.depth * 14, borderRadius: 8, border: "none", background: "none", color: "var(--ci-text-muted)", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ width: 10, fontSize: 9, color: "var(--ci-text-dim)", flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>
                <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
              </button>
            );
          }

          const isSelected = selectedPath === node.path;
          const buffer = buffersByTabId[`code:${session.id}:${node.path}`];
          return (
            <button
              key={node.key}
              onClick={() => {
                const ancestors = collectAncestorDirs(node.path);
                if (ancestors.length > 0) {
                  setExpandedDirs(session.id, [...new Set([...expandedDirs, ...ancestors])]);
                }
                setSelectedPath(session.id, node.path);
                openFile(session.id, node.path, true);
              }}
              onDoubleClick={() => openFile(session.id, node.path, false)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", paddingLeft: 24 + node.depth * 14, borderRadius: 8, border: isSelected ? `1px solid ${accentColor}55` : "1px solid transparent", background: isSelected ? (isGlass ? "var(--ci-toolbar-bg)" : `${accentColor}12`) : "none", color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)", cursor: "pointer", textAlign: "left" }}
              title={node.path}
            >
              <FileStatusGlyph file={node.file} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{node.name}</span>
              {buffer?.dirty && <span style={{ color: accentColor, fontSize: 12, marginLeft: "auto" }}>●</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
