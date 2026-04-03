import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, ClaudeSession } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS } from "../store/settingsStore";
import { startRunner } from "../harness/runnerRouter";
import type { RunnerHandle } from "../harness/runnerRouter";

// 全局 Runner 句柄注册表
const runnerHandles = new Map<string, RunnerHandle>();

// ── 设计常量 ─────────────────────────────────────────────────
const C = {
  border:    "rgba(255,255,255,0.06)",
  surface:   "rgba(255,255,255,0.05)",
  surfaceHi: "rgba(255,255,255,0.09)",
  textMuted: "rgba(255,255,255,0.45)",
  text:      "rgba(255,255,255,0.75)",
  accent:    "#7c6df0",
  accentBg:  "rgba(124,109,240,0.14)",
  accentBdr: "rgba(124,109,240,0.3)",
  accentTxt: "#a89ff5",
  green:     "#4ade80",
  greenBg:   "rgba(74,222,128,0.13)",
  greenBdr:  "rgba(74,222,128,0.3)",
  red:       "#f87171",
  redBg:     "rgba(239,68,68,0.12)",
  redBdr:    "rgba(239,68,68,0.28)",
};

// ── 单个图标按钮（极简风） ────────────────────────────────────
function Btn({
  children, onClick, title, variant = "ghost", disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  variant?: "ghost" | "primary" | "danger" | "success";
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const styles: Record<string, React.CSSProperties> = {
    ghost: {
      background: hovered ? C.surfaceHi : C.surface,
      border: `1px solid ${hovered ? "rgba(255,255,255,0.1)" : C.border}`,
      color: hovered ? C.text : C.textMuted,
    },
    primary: {
      background: hovered ? "rgba(124,109,240,0.22)" : C.accentBg,
      border: `1px solid ${C.accentBdr}`,
      color: C.accentTxt,
    },
    danger: {
      background: hovered ? "rgba(239,68,68,0.2)" : C.redBg,
      border: `1px solid ${C.redBdr}`,
      color: C.red,
    },
    success: {
      background: C.greenBg,
      border: `1px solid ${C.greenBdr}`,
      color: C.green,
    },
  };

  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 28,
        padding: "0 10px",
        borderRadius: 7,
        fontSize: 11,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        whiteSpace: "nowrap",
        gap: 4,
        ...styles[variant],
      }}
    >
      {children}
    </button>
  );
}

// ── Toolbar ───────────────────────────────────────────────────

interface ToolbarProps {
  session: ClaudeSession;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

export function Toolbar({ session, onInputFocus, onInputBlur }: ToolbarProps) {
  const { updateSession, appendOutput } = useSessionStore();
  const { settings, openSettings } = useSettingsStore();
  const taskInputRef = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const isRunning = session.status === "running";
  const hasDiff   = session.diffFiles.length > 0;
  const runnerLabel = RUNNER_LABELS[settings.runner.type];

  const handleRun = async () => {
    const task = taskInputRef.current?.value?.trim() ?? "";
    updateSession(session.id, { status: "running", currentTask: task || "Running…" });
    try {
      const handle = await startRunner({
        sessionId: session.id,
        workdir:   session.workdir,
        task,
        runner:  settings.runner,
        model:   settings.model,
        harness: settings.harness,
        onOutput: (line) => appendOutput(session.id, line),
        onDone:   () => updateSession(session.id, { status: "done",  currentTask: "已完成" }),
        onError:  (msg) => updateSession(session.id, { status: "error", currentTask: msg }),
      });
      runnerHandles.set(session.id, handle);
    } catch (e) {
      updateSession(session.id, { status: "error", currentTask: String(e) });
    }
  };

  const handleStop = () => {
    runnerHandles.get(session.id)?.stop();
    runnerHandles.delete(session.id);
    updateSession(session.id, { status: "idle", currentTask: "" });
  };

  const handleRefreshDiff = () =>
    invoke("get_git_diff", { sessionId: session.id, workdir: session.workdir }).catch(console.error);

  return (
    <div style={{ borderTop: `1px solid rgba(255,255,255,0.05)` }}>

      {/* ── 任务输入行 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px 4px",
      }}>
        {/* 输入框 */}
        <div style={{
          flex: 1,
          display: "flex", alignItems: "center",
          background: inputFocused ? "rgba(255,255,255,0.06)" : C.surface,
          border: `1px solid ${inputFocused ? "rgba(255,255,255,0.12)" : C.border}`,
          borderRadius: 8,
          height: 30,
          padding: "0 10px",
          transition: "border-color 0.15s, background 0.15s",
          gap: 6,
        }}>
          <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>›</span>
          <input
            ref={taskInputRef}
            defaultValue={session.currentTask}
            placeholder="描述任务…"
            disabled={isRunning}
             onFocus={() => { setInputFocused(true); onInputFocus?.(); }}
             onBlur={() => { setInputFocused(false); onInputBlur?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) handleRun(); }}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 12, color: C.text,
              opacity: isRunning ? 0.5 : 1,
            }}
          />
        </div>

        {/* 主操作按钮：运行 / 停止 */}
        {!isRunning ? (
          <Btn onClick={handleRun} variant="primary" title="运行（Enter）">
            <span style={{ fontSize: 9 }}>▶</span> 运行
          </Btn>
        ) : (
          <Btn onClick={handleStop} variant="danger" title="停止">
            <span style={{ fontSize: 9 }}>■</span> 停止
          </Btn>
        )}
      </div>

      {/* ── 次级操作行 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "3px 10px 8px",
      }}>
        {/* Runner 徽标 */}
        <button
          onClick={() => openSettings("runner")}
          title="切换 Runner"
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 5,
            border: `1px solid ${C.accentBdr}`,
            background: C.accentBg, color: C.accentTxt,
            cursor: "pointer",
          }}
        >
          {runnerLabel}
        </button>

        {/* Diff 刷新 */}
        <Btn onClick={handleRefreshDiff} title="刷新 git diff" disabled={isRunning}>
          ↺ Diff
        </Btn>

        {/* Diff 文件数量 */}
        {hasDiff && (
          <Btn variant="success" title={`${session.diffFiles.length} 个文件变更`}>
            ✓ {session.diffFiles.length}
          </Btn>
        )}

        <div style={{ flex: 1 }} />

        {/* 设置按钮 */}
        <Btn onClick={() => openSettings()} title="设置">
          ⚙
        </Btn>
      </div>
    </div>
  );
}
