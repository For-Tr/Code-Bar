import { motion, AnimatePresence } from "framer-motion";
import { DiffFile, DiffLine, useSessionStore } from "../store/sessionStore";

// ── 颜色 token ──────────────────────────────────────────────
const C = {
  added:    { bg: "rgba(34,197,94,0.12)",   text: "#4ade80",  gutter: "rgba(34,197,94,0.2)" },
  deleted:  { bg: "rgba(239,68,68,0.12)",   text: "#f87171",  gutter: "rgba(239,68,68,0.2)" },
  context:  { bg: "transparent",            text: "rgba(255,255,255,0.55)", gutter: "transparent" },
};

function DiffLineRow({ line }: { line: DiffLine }) {
  const c = C[line.type];
  const prefix = line.type === "added" ? "+" : line.type === "deleted" ? "−" : " ";
  return (
    <div style={{
      display: "flex", fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 11, lineHeight: "18px", background: c.bg,
    }}>
      {/* 行号 */}
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "rgba(255,255,255,0.2)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
      }}>
        {line.oldLineNo ?? ""}
      </span>
      <span style={{
        width: 32, textAlign: "right", padding: "0 6px",
        color: "rgba(255,255,255,0.2)", flexShrink: 0,
        background: c.gutter, userSelect: "none",
      }}>
        {line.newLineNo ?? ""}
      </span>
      {/* 前缀符号 */}
      <span style={{
        width: 18, textAlign: "center", color: c.text,
        flexShrink: 0, userSelect: "none",
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

function FileIcon({ type }: { type: DiffFile["type"] }) {
  const map = { added: { icon: "✦", color: "#4ade80" }, modified: { icon: "◆", color: "#fbbf24" }, deleted: { icon: "✕", color: "#f87171" } };
  const { icon, color } = map[type];
  return <span style={{ color, fontSize: 9, marginRight: 6, flexShrink: 0 }}>{icon}</span>;
}

function FileStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ display: "flex", gap: 4, fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
      {additions > 0 && <span style={{ color: "#4ade80" }}>+{additions}</span>}
      {deletions > 0 && <span style={{ color: "#f87171" }}>−{deletions}</span>}
    </span>
  );
}

function DiffFileRow({ file }: { file: DiffFile }) {
  const { expandedDiffFileId, toggleDiffFile } = useSessionStore();
  const isOpen = expandedDiffFileId === file.path;

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {/* 文件头 */}
      <button
        onClick={() => toggleDiffFile(file.path)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          padding: "7px 12px", background: "none", border: "none",
          cursor: "pointer", color: "rgba(255,255,255,0.8)",
          textAlign: "left",
        }}
      >
        <motion.span
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ marginRight: 6, fontSize: 9, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
        >▶</motion.span>
        <FileIcon type={file.type} />
        <span style={{ fontSize: 11, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.path}
        </span>
        <FileStat additions={file.additions} deletions={file.deletions} />
      </button>

      {/* 展开的 diff 内容 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{
              background: "rgba(0,0,0,0.3)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              maxHeight: 320, overflowY: "auto",
            }}>
              {file.hunks.map((hunk, hi) => (
                <div key={hi}>
                  {/* hunk header */}
                  <div style={{
                    padding: "2px 8px 2px 82px",
                    background: "rgba(99,102,241,0.1)",
                    color: "rgba(165,180,252,0.7)",
                    fontSize: 10, fontFamily: "monospace",
                  }}>
                    {hunk.header}
                  </div>
                  {hunk.lines.map((line, li) => (
                    <DiffLineRow key={li} line={line} />
                  ))}
                </div>
              ))}
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
        color: "rgba(255,255,255,0.2)", fontSize: 12,
      }}>
        暂无代码变更
      </div>
    );
  }

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div>
      {/* 汇总 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 12px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          {files.length} 个文件变更
        </span>
        <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
          <span style={{ color: "#4ade80" }}>+{totalAdditions}</span>
          <span style={{ color: "#f87171" }}>−{totalDeletions}</span>
        </span>
      </div>
      {/* 文件列表 */}
      {files.map((f) => (
        <DiffFileRow key={f.path} file={f} />
      ))}
    </div>
  );
}
