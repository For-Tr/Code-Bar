import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, ClaudeSession } from "../store/sessionStore";
import { useSettingsStore, RUNNER_LABELS } from "../store/settingsStore";
import { startRunner } from "../harness/runnerRouter";
import type { RunnerHandle } from "../harness/runnerRouter";

// 全局 Runner 句柄注册表
const runnerHandles = new Map<string, RunnerHandle>();

// ── 单个按钮（Apple 风格） ────────────────────────────────────
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
      background: hovered ? "var(--ci-btn-ghost-hover)" : "var(--ci-btn-ghost-bg)",
      border: "1px solid var(--ci-border)",
      color: hovered ? "var(--ci-text)" : "var(--ci-text-muted)",
    },
    primary: {
      background: hovered ? "#0071e3" : "var(--ci-accent)",
      border: "none",
      color: "#fff",
      boxShadow: "0 1px 4px rgba(0,122,255,0.35)",
    },
    danger: {
      background: hovered ? "rgba(255,59,48,0.14)" : "var(--ci-deleted-bg)",
      border: "1px solid var(--ci-border-med)",
      color: "var(--ci-red)",
    },
    success: {
      background: "var(--ci-green-bg)",
      border: "1px solid var(--ci-green-bdr)",
      color: "var(--ci-green-dark)",
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
        height: 30,
        padding: "0 12px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        transition: "background 0.12s, border-color 0.12s, color 0.12s, filter 0.12s",
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
    <div style={{ borderTop: "1px solid var(--ci-border)" }}>

      {/* ── 任务输入行 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "9px 10px 5px",
      }}>
        {/* 输入框 */}
        <div style={{
          flex: 1,
          display: "flex", alignItems: "center",
          background: inputFocused ? "var(--ci-surface-hi)" : "var(--ci-surface)",
          border: `1px solid ${inputFocused ? "var(--ci-border-hi)" : "var(--ci-border)"}`,
          borderRadius: 9,
          height: 32,
          padding: "0 10px",
          transition: "border-color 0.15s, background 0.15s",
          gap: 6,
          boxShadow: inputFocused ? "0 0 0 3px var(--ci-accent-bg)" : "none",
        }}>
          <span style={{ fontSize: 12, color: "var(--ci-text-dim)", flexShrink: 0 }}>›</span>
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
              fontSize: 13, color: "var(--ci-text)",
              opacity: isRunning ? 0.45 : 1,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
            }}
          />
        </div>

        {/* 主操作按钮 */}
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
        padding: "3px 10px 9px",
      }}>
        {/* Runner 徽标 */}
        <button
          onClick={() => openSettings("runner")}
          title="切换 Runner"
          style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 6,
            border: "1px solid var(--ci-purple-bdr)",
            background: "var(--ci-purple-bg)", color: "var(--ci-purple)",
            cursor: "pointer", fontWeight: 500,
            transition: "filter 0.12s",
          }}
          onMouseEnter={e => e.currentTarget.style.filter = "brightness(0.9)"}
          onMouseLeave={e => e.currentTarget.style.filter = "none"}
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
