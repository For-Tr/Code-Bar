import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo } from "react";
import { getWorkspaceColor, useWorkspaceStore } from "../store/workspaceStore";
import { DiffFile, useSessionStore, type ClaudeSession } from "../store/sessionStore";
import { useExplorerStore, type ExplorerFileState } from "../store/explorerStore";

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

type SessionFileReadResult = {
  content: string;
  versionToken: string | null;
  isBinary: boolean;
  missing: boolean;
};

type SessionFileWriteResult = {
  versionToken: string | null;
};

function editorKey(sessionId: string, path: string) {
  return `${sessionId}:${path}`;
}

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
        nodes.push({
          type: "dir",
          key: `dir:${path}`,
          name: path.split("/").pop() ?? path,
          path,
          depth,
        });
      }
      if (expandedDirs.has(path)) {
        walk(groups.get(path) ?? [], depth + 1, path);
      }
    });

    directFiles.sort((a, b) => a.path.localeCompare(b.path)).forEach((file) => {
      nodes.push({
        type: "file",
        key: `file:${file.path}`,
        name: file.path.split("/").pop() ?? file.path,
        path: file.path,
        depth,
        file,
      });
    });
  };

  walk(sortedFiles, 0, "");
  return nodes;
}

function FileStatusGlyph({ file }: { file: DiffFile }) {
  if (file.binary) {
    return <span style={{ color: "var(--ci-purple)", fontSize: 10, width: 12, textAlign: "center" }}>⬡</span>;
  }
  if (file.type === "added") {
    return <span style={{ color: "var(--ci-green)", fontSize: 10, width: 12, textAlign: "center" }}>A</span>;
  }
  if (file.type === "deleted") {
    return <span style={{ color: "var(--ci-red)", fontSize: 10, width: 12, textAlign: "center" }}>D</span>;
  }
  return <span style={{ color: "var(--ci-yellow)", fontSize: 10, width: 12, textAlign: "center" }}>M</span>;
}

function FileTree({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const activeWorkspace = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null);
  const accentColor = activeWorkspace ? getWorkspaceColor(activeWorkspace.color) : "var(--ci-accent)";
  const expandedDirs = useExplorerStore((s) => s.expandedDirsBySession[session.id] ?? []);
  const selectedPath = useExplorerStore((s) => s.selectedPathBySession[session.id] ?? null);
  const toggleDir = useExplorerStore((s) => s.toggleDir);
  const setExpandedDirs = useExplorerStore((s) => s.setExpandedDirs);
  const setSelectedPath = useExplorerStore((s) => s.setSelectedPath);
  const openTab = useExplorerStore((s) => s.openTab);
  const closeExploreMode = useSessionStore((s) => s.closeExploreMode);

  useEffect(() => {
    if (selectedPath) return;
    if (session.diffFiles.length === 0) return;
    const firstFile = [...session.diffFiles].sort((a, b) => a.path.localeCompare(b.path))[0];
    if (!firstFile) return;
    const ancestorDirs = collectAncestorDirs(firstFile.path);
    if (ancestorDirs.length > 0) {
      setExpandedDirs(session.id, [...new Set([...expandedDirs, ...ancestorDirs])]);
    }
    setSelectedPath(session.id, firstFile.path);
    openTab(session.id, firstFile.path, true);
  }, [expandedDirs, openTab, selectedPath, session.diffFiles, session.id, setExpandedDirs, setSelectedPath]);

  const expandedDirSet = useMemo(() => new Set(expandedDirs), [expandedDirs]);
  const nodes = useMemo(() => buildTreeNodes(session.diffFiles, expandedDirSet), [expandedDirSet, session.diffFiles]);
  const totalAdditions = session.diffFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = session.diffFiles.reduce((sum, file) => sum + file.deletions, 0);

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
              onClick={closeExploreMode}
              style={{
                background: "none",
                border: "none",
                color: "var(--ci-text-muted)",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
                flexShrink: 0,
              }}
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
              <span style={{
                fontSize: 9.5,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--ci-purple-bg)",
                border: "1px solid var(--ci-purple-bdr)",
                color: "var(--ci-purple)",
                fontFamily: "monospace",
                flexShrink: 0,
              }}>
                ⎇ {session.branchName.replace("ci/", "")}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onRefreshDiff(session.id)}
          style={{
            background: "none",
            border: "none",
            color: accentColor,
            cursor: "pointer",
            padding: 0,
            fontSize: 12,
            flexShrink: 0,
          }}
          title="刷新变更"
        >
          刷新
        </button>
      </div>

      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        color: "var(--ci-text-dim)",
      }}>
        <span>{session.diffFiles.length} 个文件</span>
        <span style={{ color: "var(--ci-green-dark)", fontWeight: 700 }}>+{totalAdditions}</span>
        <span style={{ color: "var(--ci-deleted-text)", fontWeight: 700 }}>−{totalDeletions}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 8px 10px" }}>
        {nodes.length === 0 ? (
          <div style={{
            padding: "18px 10px",
            fontSize: 12,
            color: "var(--ci-text-dim)",
            lineHeight: 1.7,
          }}>
            当前会话暂无变更文件。
          </div>
        ) : (
          nodes.map((node) => {
            if (node.type === "dir") {
              const isOpen = expandedDirSet.has(node.path);
              return (
                <button
                  key={node.key}
                  onClick={() => toggleDir(session.id, node.path)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    paddingLeft: 8 + node.depth * 14,
                    borderRadius: 8,
                    border: "none",
                    background: "none",
                    color: "var(--ci-text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 10, fontSize: 9, color: "var(--ci-text-dim)", flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                    {node.name}
                  </span>
                </button>
              );
            }

            const isSelected = selectedPath === node.path;
            const state = fileStateByKey[editorKey(session.id, node.path)];
            return (
              <button
                key={node.key}
                onClick={() => {
                  const ancestors = collectAncestorDirs(node.path);
                  if (ancestors.length > 0) {
                    setExpandedDirs(session.id, [...new Set([...expandedDirs, ...ancestors])]);
                  }
                  setSelectedPath(session.id, node.path);
                  openTab(session.id, node.path, true);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  paddingLeft: 24 + node.depth * 14,
                  borderRadius: 8,
                  border: isSelected ? `1px solid ${accentColor}55` : "1px solid transparent",
                  background: isSelected ? (isGlass ? "var(--ci-toolbar-bg)" : `${accentColor}12`) : "none",
                  color: isSelected ? "var(--ci-text)" : "var(--ci-text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                title={node.path}
              >
                <FileStatusGlyph file={node.file} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                  {node.name}
                </span>
                {state?.dirty && <span style={{ color: accentColor, fontSize: 12, marginLeft: "auto" }}>●</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyEditorState({ session }: { session: ClaudeSession | null }) {
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
        {session ? "从左侧选择一个变更文件开始查看或编辑。" : "选择一个会话进入 Explore 模式。"}
      </div>
    </div>
  );
}

function BinaryEditorState({ path }: { path: string }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      color: "var(--ci-text-dim)",
      fontSize: 12,
      lineHeight: 1.7,
    }}>
      二进制文件暂不支持编辑：{path}
    </div>
  );
}

function DeletedEditorState({ path }: { path: string }) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      color: "var(--ci-text-dim)",
      fontSize: 12,
      lineHeight: 1.7,
    }}>
      该文件已被删除，当前仅提供只读占位：{path}
    </div>
  );
}

function EditorTabs({
  session,
}: {
  session: ClaudeSession | null;
}) {
  const activeTabKey = useExplorerStore((s) => s.activeTabKey);
  const openTabs = useExplorerStore((s) => s.openTabs.filter((tab) => !session || tab.sessionId === session.id));
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const closeTab = useExplorerStore((s) => s.closeTab);
  const fileStateByKey = useExplorerStore((s) => s.fileStateByKey);

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
      ) : openTabs.map((tab) => {
        const state = fileStateByKey[tab.key];
        const isActive = activeTabKey === tab.key;
        return (
          <div
            key={tab.key}
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
              onClick={() => setActiveTab(tab.key)}
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
              {state?.dirty && <span style={{ color: "var(--ci-accent)", fontSize: 11, flexShrink: 0 }}>●</span>}
              {tab.preview && <span style={{ color: "var(--ci-text-dim)", fontSize: 10, flexShrink: 0 }}>预览</span>}
            </button>
            <button
              onClick={() => closeTab(tab.key)}
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

function EditorBody({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  const activeTabKey = useExplorerStore((s) => s.activeTabKey);
  const openTabs = useExplorerStore((s) => s.openTabs);
  const fileStateByKey = useExplorerStore((s) => s.fileStateByKey);
  const patchFileState = useExplorerStore((s) => s.patchFileState);
  const updateDraft = useExplorerStore((s) => s.updateDraft);
  const markSaved = useExplorerStore((s) => s.markSaved);
  const setSelectedPath = useExplorerStore((s) => s.setSelectedPath);
  const activeTab = openTabs.find((tab) => tab.key === activeTabKey && (!session || tab.sessionId === session.id)) ?? null;
  const activeState: ExplorerFileState | null = activeTab ? (fileStateByKey[activeTab.key] ?? null) : null;
  const activeFile = session?.diffFiles.find((file) => file.path === activeTab?.path) ?? null;

  const loadFile = useCallback(async (tabKey: string, sessionId: string, path: string) => {
    patchFileState(tabKey, { loading: true, error: null });
    try {
      const payload = await invoke<SessionFileReadResult>("read_session_file", { sessionId, relativePath: path });
      patchFileState(tabKey, {
        loading: false,
        loaded: true,
        content: payload.content,
        originalContent: payload.content,
        versionToken: payload.versionToken,
        dirty: false,
        error: null,
        isBinary: payload.isBinary,
        missing: payload.missing,
      });
    } catch (error) {
      patchFileState(tabKey, {
        loading: false,
        loaded: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [patchFileState]);

  useEffect(() => {
    if (!activeTab || !session) return;
    setSelectedPath(session.id, activeTab.path);
    const state = fileStateByKey[activeTab.key];
    if (state?.loaded || state?.loading) return;
    void loadFile(activeTab.key, activeTab.sessionId, activeTab.path);
  }, [activeTab, fileStateByKey, loadFile, session, setSelectedPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!activeTab || !session) return;
      event.preventDefault();
      if (activeState?.dirty !== true || activeState.saving || activeState.isBinary || activeFile?.type === "deleted") return;
      patchFileState(activeTab.key, { saving: true, error: null });
      void invoke<SessionFileWriteResult>("write_session_file", {
        sessionId: activeTab.sessionId,
        relativePath: activeTab.path,
        content: activeState.content,
        expectedVersionToken: activeState.versionToken,
      }).then((payload) => {
        markSaved(activeTab.key, activeState.content, payload.versionToken);
        onRefreshDiff(activeTab.sessionId);
      }).catch((error) => {
        patchFileState(activeTab.key, {
          saving: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFile?.type, activeState, activeTab, markSaved, onRefreshDiff, patchFileState, session]);

  if (!session || !activeTab) {
    return <EmptyEditorState session={session} />;
  }

  if (activeFile?.type === "deleted") {
    return <DeletedEditorState path={activeTab.path} />;
  }

  if (!activeState || activeState.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--ci-text-dim)", fontSize: 12 }}>
        载入文件中…
      </div>
    );
  }

  if (activeState.error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24, color: "var(--ci-deleted-text)", fontSize: 12, lineHeight: 1.7 }}>
        {activeState.error}
      </div>
    );
  }

  if (activeState.isBinary) {
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
            {activeState.dirty ? <span style={{ color: "var(--ci-accent)" }}>未保存</span> : <span>已同步</span>}
            <span>⌘/Ctrl + S 保存</span>
          </div>
        </div>
        <button
          onClick={() => {
            if (!activeState.dirty || activeState.saving) return;
            patchFileState(activeTab.key, { saving: true, error: null });
            void invoke<SessionFileWriteResult>("write_session_file", {
              sessionId: activeTab.sessionId,
              relativePath: activeTab.path,
              content: activeState.content,
              expectedVersionToken: activeState.versionToken,
            }).then((payload) => {
              markSaved(activeTab.key, activeState.content, payload.versionToken);
              onRefreshDiff(activeTab.sessionId);
            }).catch((error) => {
              patchFileState(activeTab.key, {
                saving: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }}
          disabled={!activeState.dirty || activeState.saving}
          style={{
            background: activeState.dirty ? "var(--ci-accent-bg)" : "var(--ci-btn-ghost-bg)",
            border: `1px solid ${activeState.dirty ? "var(--ci-accent-bdr)" : "var(--ci-toolbar-border)"}`,
            color: activeState.dirty ? "var(--ci-accent)" : "var(--ci-text-dim)",
            cursor: !activeState.dirty || activeState.saving ? "default" : "pointer",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {activeState.saving ? "保存中…" : "保存"}
        </button>
      </div>

      <textarea
        value={activeState.content}
        onChange={(event) => updateDraft(activeTab.key, event.target.value)}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          padding: "16px 18px",
          background: "var(--ci-code-bg)",
          border: "none",
          outline: "none",
          resize: "none",
          color: "var(--ci-text)",
          fontSize: 12,
          lineHeight: 1.7,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
          boxSizing: "border-box",
        }}
      />

      {activeState.error && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--ci-toolbar-border)", color: "var(--ci-deleted-text)", fontSize: 11 }}>
          {activeState.error}
        </div>
      )}
    </div>
  );
}

export function ExploreSidebar({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: 0,
      background: "var(--ci-toolbar-bg)",
      borderRight: "1px solid var(--ci-toolbar-border)",
    }}>
      {session ? <FileTree session={session} onRefreshDiff={onRefreshDiff} /> : <EmptyEditorState session={null} />}
    </div>
  );
}

export function ExploreEditor({
  session,
  onRefreshDiff,
}: {
  session: ClaudeSession | null;
  onRefreshDiff: (sessionId?: string | null) => void;
}) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: "var(--ci-surface)",
    }}>
      <EditorTabs session={session} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <EditorBody session={session} onRefreshDiff={onRefreshDiff} />
      </div>
    </div>
  );
}
