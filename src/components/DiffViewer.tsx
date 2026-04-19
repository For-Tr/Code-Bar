import { useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, FilePlus2, FileX2, Minus, Plus } from "lucide-react";
import { DiffFile, DiffLine } from "../store/sessionStore";
import { type ScmActionMode } from "../store/scmStore";
import { WorkbenchTooltip } from "./ui/WorkbenchTooltip";

const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

type LineStyle = { bg: string; text: string; gutter: string; prefix: string };
const LINE_STYLES: Record<DiffLine["type"], LineStyle> = {
  added:   {
    bg:     "var(--ci-added-bg)",
    text:   "var(--ci-added-text)",
    gutter: "rgba(52,199,89,0.06)",
    prefix: "var(--ci-green)",
  },
  deleted: {
    bg:     "var(--ci-deleted-bg)",
    text:   "var(--ci-deleted-text)",
    gutter: "rgba(255,59,48,0.05)",
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
      width: "max-content",
      minWidth: "100%",
      fontFamily: MONO,
      fontSize: 11,
      lineHeight: "18px",
      background: c.bg,
    }}>
      <span style={{
        width: 36,
        textAlign: "right",
        padding: "0 6px",
        color: "var(--ci-text-dim)",
        flexShrink: 0,
        background: c.gutter,
        userSelect: "none",
        borderRight: "1px solid var(--ci-toolbar-border)",
      }}>
        {line.oldLineNo ?? ""}
      </span>
      <span style={{
        width: 36,
        textAlign: "right",
        padding: "0 6px",
        color: "var(--ci-text-dim)",
        flexShrink: 0,
        background: c.gutter,
        userSelect: "none",
        borderRight: "1px solid var(--ci-toolbar-border)",
      }}>
        {line.newLineNo ?? ""}
      </span>
      <span style={{
        width: 18,
        textAlign: "center",
        color: line.type === "context" ? "transparent" : c.prefix,
        flexShrink: 0,
        userSelect: "none",
        fontWeight: 600,
      }}>
        {prefix}
      </span>
      <span style={{ flex: 1, padding: "0 10px", color: c.text, whiteSpace: "pre" }}>
        {line.content || " "}
      </span>
    </div>
  );
}

function FileIcon({ type, binary }: { type: DiffFile["type"]; binary?: boolean }) {
  if (binary) return <FileCode2 size={12} strokeWidth={1.8} />;
  if (type === "added") return <FilePlus2 size={12} strokeWidth={1.8} />;
  if (type === "deleted") return <FileX2 size={12} strokeWidth={1.8} />;
  return <FileCode2 size={12} strokeWidth={1.8} />;
}

function FileStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ display: "flex", gap: 8, fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
      {additions > 0 && <span style={{ color: "var(--ci-added-text)" }}>+{additions}</span>}
      {deletions > 0 && <span style={{ color: "var(--ci-deleted-text)" }}>−{deletions}</span>}
    </span>
  );
}

function HunkActionButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <WorkbenchTooltip label={label}>
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          background: "none",
          border: "none",
          color: disabled ? "var(--ci-text-dim)" : "var(--ci-text-dim)",
          width: 18,
          height: 18,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.35 : 0.82,
        }}
      >
        {icon}
      </button>
    </WorkbenchTooltip>
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

  return (
    <div style={{ borderBottom: "1px solid var(--ci-toolbar-border)", background: "transparent" }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--ci-text)",
          textAlign: "left",
        }}
      >
        <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ci-text-dim)", flexShrink: 0 }}>
          {isOpen ? <ChevronDown size={12} strokeWidth={1.8} /> : <ChevronRight size={12} strokeWidth={1.8} />}
        </span>
        <span style={{ width: 12, display: "flex", alignItems: "center", justifyContent: "center", color: file.type === "added" ? "var(--ci-green)" : file.type === "deleted" ? "var(--ci-red)" : "var(--ci-text-dim)", flexShrink: 0 }}>
          <FileIcon type={file.type} binary={isBinary} />
        </span>
        <span style={{ fontSize: 11, fontFamily: MONO, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.path}
        </span>
        {isBinary ? (
          <span style={{ fontSize: 10, color: "var(--ci-purple)" }}>binary</span>
        ) : (
          <FileStat additions={file.additions} deletions={file.deletions} />
        )}
      </button>

      {isOpen && (
        <div style={{ background: "var(--ci-code-bg)", borderTop: "1px solid var(--ci-toolbar-border)", maxHeight: 420, overflowY: "auto", overflowX: "auto" }}>
          {isBinary ? (
            <div style={{ padding: "14px 16px", fontSize: 11, color: "var(--ci-text-dim)" }}>
              二进制文件暂不支持预览
            </div>
          ) : file.hunks.length === 0 ? (
            <div style={{ padding: "12px 16px", fontSize: 11, color: "var(--ci-text-muted)", fontFamily: MONO }}>
              {file.note ?? "无内容差异"}
            </div>
          ) : (
            file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div style={{
                  padding: "2px 8px 2px 90px",
                  background: "var(--ci-toolbar-bg)",
                  color: "var(--ci-text-dim)",
                  fontSize: 10,
                  fontFamily: MONO,
                  borderTop: "1px solid var(--ci-toolbar-border)",
                  borderBottom: "1px solid var(--ci-toolbar-border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  <span>{hunk.header}</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                    {fileMode === "unstaged" && onStageHunk && <HunkActionButton label="Stage hunk" icon={<Plus size={12} strokeWidth={1.8} />} onClick={() => onStageHunk(file.path, hi)} disabled={busy} />}
                    {fileMode === "unstaged" && onDiscardHunk && <HunkActionButton label="Discard hunk" icon={<Minus size={12} strokeWidth={1.8} />} onClick={() => onDiscardHunk(file.path, hi)} disabled={busy} />}
                    {fileMode === "staged" && onUnstageHunk && <HunkActionButton label="Unstage hunk" icon={<Minus size={12} strokeWidth={1.8} />} onClick={() => onUnstageHunk(file.path, hi)} disabled={busy} />}
                  </div>
                </div>
                {hunk.lines.map((line, li) => (
                  <DiffLineRow key={li} line={line} />
                ))}
              </div>
            ))
          )}
        </div>
      )}
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
  if (files.length === 0) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ci-text-muted)", fontSize: 12 }}>
        暂无代码变更
      </div>
    );
  }

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ background: "transparent" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 12px",
        borderBottom: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-toolbar-bg)",
      }}>
        <span style={{ fontSize: 11, color: "var(--ci-text-muted)" }}>
          {files.length} files changed
        </span>
        <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
          <span style={{ color: "var(--ci-added-text)" }}>+{totalAdditions}</span>
          <span style={{ color: "var(--ci-deleted-text)" }}>−{totalDeletions}</span>
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
