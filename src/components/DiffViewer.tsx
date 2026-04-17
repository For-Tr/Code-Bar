import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DiffFile, DiffLine } from "../store/sessionStore";
import { useSettingsStore, isGlassTheme } from "../store/settingsStore";
import { type ScmActionMode } from "../store/scmStore";

const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

type LineStyle = { bg: string; text: string; gutter: string; prefix: string };
const LINE_STYLES: Record<DiffLine["type"], LineStyle> = {
  added:   {
    bg:     "var(--ci-added-bg)",
    text:   "var(--ci-added-text)",
    gutter: "var(--ci-added-bg)",
    prefix: "var(--ci-green)",
  },
  deleted: {
    bg:     "var(--ci-deleted-bg)",
    text:   "var(--ci-deleted-text)",
    gutter: "var(--ci-deleted-bg)",
    prefix: "var(--ci-red)",
  },
  context: {
    bg:     "transparent",
    text:   "var(--ci-text-muted)",
    gutter: "transparent",
    prefix: "transparent",
  },
};

function getLineStyle(type: DiffLine["type"], isGlass: boolean): LineStyle {
  if (!isGlass) return LINE_STYLES[type];

  if (type === "added") {
    return {
      bg: "rgba(52,199,89,0.18)",
      text: "#166534",
      gutter: "rgba(52,199,89,0.14)",
      prefix: "var(--ci-green)",
    };
  }

  if (type === "deleted") {
    return {
      bg: "rgba(255,59,48,0.16)",
      text: "#b42318",
      gutter: "rgba(255,59,48,0.12)",
      prefix: "var(--ci-red)",
    };
  }

  return {
    bg: "transparent",
    text: "rgba(11,34,56,0.76)",
    gutter: "transparent",
    prefix: "transparent",
  };
}

function DiffLineRow({ line, isGlass }: { line: DiffLine; isGlass: boolean }) {
  const c = getLineStyle(line.type, isGlass);
  const prefix = line.type === "added" ? "+" : line.type === "deleted" ? "−" : " ";
  const gutterBorder = isGlass ? "rgba(16,38,61,0.08)" : "var(--ci-border)";
  return (
    <div style={{
      display: "flex",
      width: "max-content",
      minWidth: "100%",
      fontFamily: MONO,
      fontSize: isGlass ? 12 : 11,
      lineHeight: isGlass ? "19px" : "18px",
      background: c.bg,
    }}>
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "var(--ci-text-dim)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
        borderRight: `1px solid ${gutterBorder}`,
      }}>
        {line.oldLineNo ?? ""}
      </span>
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "var(--ci-text-dim)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
        borderRight: `1px solid ${gutterBorder}`,
      }}>
        {line.newLineNo ?? ""}
      </span>
      <span style={{
        width: 18, textAlign: "center",
        color: line.type === "context" ? "transparent" : c.prefix,
        flexShrink: 0, userSelect: "none",
        fontWeight: 600,
      }}>
        {prefix}
      </span>
      <span style={{
        flex: 1, padding: "0 10px", color: c.text,
        whiteSpace: "pre",
      }}>
        {line.content || " "}
      </span>
    </div>
  );
}

const FILE_ICON_MAP: Record<DiffFile["type"], { icon: string; color: string }> = {
  added:    { icon: "✦", color: "#34C759" },
  modified: { icon: "◆", color: "#FF9F0A" },
  deleted:  { icon: "✕", color: "#FF3B30" },
};

function FileIcon({ type, binary }: { type: DiffFile["type"]; binary?: boolean }) {
  if (binary) return <span style={{ color: "#5856D6", fontSize: 9, marginRight: 6, flexShrink: 0 }}>⬡</span>;
  const { icon, color } = FILE_ICON_MAP[type];
  return <span style={{ color, fontSize: 9, marginRight: 6, flexShrink: 0 }}>{icon}</span>;
}

function FileStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ display: "flex", gap: 4, fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
      {additions > 0 && (
        <span style={{
          color: "var(--ci-added-text)",
          background: "var(--ci-added-bg)",
          border: "1px solid var(--ci-green-bdr)",
          borderRadius: 4, padding: "0 4px",
        }}>+{additions}</span>
      )}
      {deletions > 0 && (
        <span style={{
          color: "var(--ci-deleted-text)",
          background: "var(--ci-deleted-bg)",
          border: "1px solid var(--ci-border-med)",
          borderRadius: 4, padding: "0 4px",
        }}>−{deletions}</span>
      )}
    </span>
  );
}

function HunkActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "var(--ci-btn-ghost-bg)" : "var(--ci-surface)",
        border: "1px solid var(--ci-toolbar-border)",
        color: disabled ? "var(--ci-text-dim)" : "var(--ci-text-muted)",
        borderRadius: 6,
        padding: "1px 6px",
        fontSize: 10,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DiffFileRow({
  file,
  fileMode,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  busy,
}: {
  file: DiffFile;
  fileMode?: ScmActionMode | null;
  onStageHunk?: (path: string, hunkIndex: number) => void;
  onUnstageHunk?: (path: string, hunkIndex: number) => void;
  onDiscardHunk?: (path: string, hunkIndex: number) => void;
  busy?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isBinary = !!file.binary;
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));

  return (
    <div style={{
      borderBottom: "1px solid var(--ci-toolbar-border)",
      background: "transparent",
    }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          padding: "7px 12px", background: "none", border: "none",
          cursor: "pointer", color: "var(--ci-text)",
          textAlign: "left",
          transition: "background 0.12s",
          textShadow: "none",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--ci-btn-ghost-bg)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <motion.span
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ marginRight: 6, fontSize: 9, color: "var(--ci-text-dim)", flexShrink: 0 }}
        >▶</motion.span>
        <FileIcon type={file.type} binary={isBinary} />
        <span style={{
          fontSize: 11, fontFamily: MONO, flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: "var(--ci-text)",
        }}>
          {file.path}
        </span>
        {isBinary ? (
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 99, flexShrink: 0,
            background: "var(--ci-purple-bg)",
            border: "1px solid var(--ci-purple-bdr)",
            color: "var(--ci-purple)",
            marginLeft: 6,
          }}>
            二进制
          </span>
        ) : (
          <FileStat additions={file.additions} deletions={file.deletions} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="diff-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{
              background: isGlass ? "rgba(248,249,252,0.88)" : "var(--ci-code-bg)",
              borderTop: "1px solid var(--ci-toolbar-border)",
              maxHeight: 420,
              overflowY: "auto",
              overflowX: "auto",
              scrollbarWidth: isGlass ? "thin" : "none",
            }}>
              {isBinary ? (
                <div style={{
                  padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontSize: 18, opacity: 0.6 }}>⬡</span>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ci-purple)", fontWeight: 600, marginBottom: 2 }}>
                      二进制文件
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ci-text-dim)", fontFamily: MONO }}>
                      {file.path}
                    </div>
                  </div>
                </div>
              ) : file.hunks.length === 0 ? (
                <div style={{
                  padding: "12px 16px",
                  fontSize: 11,
                  color: "var(--ci-text-muted)",
                  fontFamily: MONO,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ opacity: 0.5 }}>ℹ</span>
                  {file.note ?? "无内容差异"}
                </div>
              ) : (
                file.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    <div style={{
                      padding: "2px 8px 2px 82px",
                      background: isGlass ? "rgba(45,140,255,0.14)" : "var(--ci-accent-bg)",
                      color: "var(--ci-accent)",
                      fontSize: 10, fontFamily: MONO,
                      borderTop: "1px solid var(--ci-accent-bdr)",
                      borderBottom: "1px solid var(--ci-accent-bdr)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <span>{hunk.header}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        {fileMode === "unstaged" && onStageHunk && <HunkActionButton label="Stage Hunk" onClick={() => onStageHunk(file.path, hi)} disabled={busy} />}
                        {fileMode === "unstaged" && onDiscardHunk && <HunkActionButton label="Discard Hunk" onClick={() => onDiscardHunk(file.path, hi)} disabled={busy} />}
                        {fileMode === "staged" && onUnstageHunk && <HunkActionButton label="Unstage Hunk" onClick={() => onUnstageHunk(file.path, hi)} disabled={busy} />}
                      </div>
                    </div>
                    {hunk.lines.map((line, li) => (
                      <DiffLineRow key={li} line={line} isGlass={isGlass} />
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DiffViewer({
  files,
  fileMode,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  busy = false,
}: {
  files: DiffFile[];
  fileMode?: ScmActionMode | null;
  onStageHunk?: (path: string, hunkIndex: number) => void;
  onUnstageHunk?: (path: string, hunkIndex: number) => void;
  onDiscardHunk?: (path: string, hunkIndex: number) => void;
  busy?: boolean;
}) {
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));

  if (files.length === 0) {
    return (
      <div style={{
        padding: "20px 0", textAlign: "center",
        color: "var(--ci-text-muted)", fontSize: 12,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        textShadow: "none",
      }}>
        暂无代码变更
      </div>
    );
  }

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ background: "transparent" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 12px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: isGlass ? "rgba(248,249,252,0.88)" : "var(--ci-panel-grad)",
        textShadow: "none",
      }}>
        <span style={{
          fontSize: 11, color: "var(--ci-text-muted)",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        }}>
          {files.length} 个文件变更
        </span>
        <span style={{ display: "flex", gap: 6, fontSize: 11 }}>
          <span style={{
            color: "var(--ci-added-text)",
            background: "var(--ci-added-bg)",
            border: "1px solid var(--ci-green-bdr)",
            borderRadius: 5, padding: "0 6px",
          }}>+{totalAdditions}</span>
          <span style={{
            color: "var(--ci-deleted-text)",
            background: "var(--ci-deleted-bg)",
            border: "1px solid var(--ci-border-med)",
            borderRadius: 5, padding: "0 6px",
          }}>−{totalDeletions}</span>
        </span>
      </div>
      {files.map((f) => (
        <DiffFileRow
          key={f.path}
          file={f}
          fileMode={fileMode}
          onStageHunk={onStageHunk}
          onUnstageHunk={onUnstageHunk}
          onDiscardHunk={onDiscardHunk}
          busy={busy}
        />
      ))}
    </div>
  );
}
