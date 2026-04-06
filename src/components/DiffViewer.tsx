import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DiffFile, DiffLine } from "../store/sessionStore";

// 保留静态颜色（文件类型图标颜色保持固定，diff 行颜色改用 CSS 变量）
const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

// 每种 diff 行类型的样式（通过 CSS 变量驱动深/浅色）
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

function DiffLineRow({ line }: { line: DiffLine }) {
  const c = LINE_STYLES[line.type];
  const prefix = line.type === "added" ? "+" : line.type === "deleted" ? "−" : " ";
  return (
    <div style={{
      display: "flex",
      fontFamily: MONO,
      fontSize: 11,
      lineHeight: "18px",
      background: c.bg,
    }}>
      {/* 旧行号 */}
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "var(--ci-text-dim)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
        borderRight: "1px solid var(--ci-border)",
      }}>
        {line.oldLineNo ?? ""}
      </span>
      {/* 新行号 */}
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "var(--ci-text-dim)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
        borderRight: "1px solid var(--ci-border)",
      }}>
        {line.newLineNo ?? ""}
      </span>
      {/* 前缀符号 */}
      <span style={{
        width: 18, textAlign: "center",
        color: line.type === "context" ? "transparent" : c.prefix,
        flexShrink: 0, userSelect: "none",
        fontWeight: 600,
      }}>
        {prefix}
      </span>
      {/* 代码内容 */}
      <span style={{
        flex: 1, padding: "0 8px", color: c.text,
        whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {line.content || " "}
      </span>
    </div>
  );
}

// 文件类型图标（颜色固定，语义化）
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

function DiffFileRow({ file }: { file: DiffFile }) {
  const [isOpen, setIsOpen] = useState(false);
  const isBinary = !!file.binary;

  return (
    <div style={{
      borderBottom: "1px solid var(--ci-border)",
      background: "var(--ci-surface)",
    }}>
      {/* 文件头 */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          padding: "7px 12px", background: "none", border: "none",
          cursor: "pointer", color: "var(--ci-text)",
          textAlign: "left",
          transition: "background 0.12s",
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

      {/* 展开的 diff 内容 */}
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
              background: "var(--ci-bg)",
              borderTop: "1px solid var(--ci-border)",
              maxHeight: 320, overflowY: "auto",
              scrollbarWidth: "none",
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
                    {/* hunk header */}
                    <div style={{
                      padding: "2px 8px 2px 82px",
                      background: "var(--ci-accent-bg)",
                      color: "var(--ci-accent)",
                      fontSize: 10, fontFamily: MONO,
                      borderTop: "1px solid var(--ci-accent-bdr)",
                      borderBottom: "1px solid var(--ci-accent-bdr)",
                    }}>
                      {hunk.header}
                    </div>
                    {hunk.lines.map((line, li) => (
                      <DiffLineRow key={li} line={line} />
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

export function DiffViewer({ files }: { files: DiffFile[] }) {
  if (files.length === 0) {
    return (
      <div style={{
        padding: "20px 0", textAlign: "center",
        color: "var(--ci-text-muted)", fontSize: 12,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        暂无代码变更
      </div>
    );
  }

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ background: "var(--ci-surface)" }}>
      {/* 汇总统计 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 12px",
        borderBottom: "1px solid var(--ci-border)",
        background: "var(--ci-bg)",
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
      {/* 文件列表 */}
      {files.map((f) => (
        <DiffFileRow key={f.path} file={f} />
      ))}
    </div>
  );
}
