import { RUNNER_LABELS, type RunnerType } from "../../store/settingsStore";

export function SessionPromptComposer({
  pendingQuery,
  setPendingQuery,
  queryInputRef,
  querySent,
  waitingForPtyLaunch,
  runnerType,
  runnerBadge,
  cliAvailable,
  cliCommand,
  installCmd,
  isGlass,
  launchDisabled,
  handleSwitchRunner,
  handleInstall,
}: {
  pendingQuery: string;
  setPendingQuery: (value: string) => void;
  queryInputRef: React.RefObject<HTMLTextAreaElement | null>;
  querySent: boolean;
  waitingForPtyLaunch: boolean;
  runnerType: RunnerType;
  runnerBadge: string;
  cliAvailable: boolean | null;
  cliCommand: string;
  installCmd?: string;
  isGlass: boolean;
  launchDisabled: boolean;
  handleSwitchRunner: (type: RunnerType) => void;
  handleInstall: () => void;
}) {
  const overlayTitle = isGlass ? "var(--ci-text)" : "var(--ci-pty-mask-title)";
  const overlayHint = isGlass ? "var(--ci-text-muted)" : "var(--ci-pty-mask-hint)";
  const overlayFooter = isGlass ? "var(--ci-text-dim)" : "var(--ci-pty-mask-footer)";
  const inputBackground = isGlass ? "var(--ci-surface-hi)" : "var(--ci-pty-input-bg)";
  const inputBorder = isGlass ? "1px solid var(--ci-border)" : "1px solid var(--ci-pty-input-border)";
  const inputText = isGlass ? "var(--ci-text)" : "var(--ci-pty-input-text)";
  const actionButtonBackground = isGlass ? "var(--ci-pill-bg)" : "var(--ci-pty-btn-bg)";
  const actionButtonBorder = isGlass ? "1px solid var(--ci-pill-border)" : "1px solid var(--ci-pty-btn-border)";
  const actionButtonText = isGlass ? "var(--ci-text-muted)" : "var(--ci-pty-btn-text)";
  const runnerChipHoverBackground = isGlass ? "rgba(63,145,255,0.16)" : "var(--ci-pty-runner-bg-hover)";
  const queryCardShadow = isGlass ? "none" : "none";
  const queryInputShadow = isGlass
    ? "var(--ci-inset-highlight), var(--ci-card-shadow)"
    : "0 1px 6px rgba(0,0,0,0.1), inset 0 0 0 0.5px rgba(0,0,0,0.04)";

  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: isGlass ? "22px 28px 28px" : "24px 32px",
      gap: 16,
      overflowY: "auto",
      background: isGlass ? "transparent" : "var(--ci-pty-mask-bg)",
    }}>
      <div style={{
        width: "min(100%, 560px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: isGlass ? "0" : "22px 22px 20px",
        borderRadius: isGlass ? 0 : 20,
        background: isGlass ? "transparent" : "transparent",
        border: "none",
        boxShadow: queryCardShadow,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: waitingForPtyLaunch ? "rgba(255,159,10,0.14)" : "var(--ci-accent-bg)",
          border: waitingForPtyLaunch ? "1px solid rgba(255,159,10,0.28)" : "1px solid var(--ci-accent-bdr)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, flexShrink: 0,
          color: waitingForPtyLaunch ? "#ffbf40" : "var(--ci-accent)",
        }}>
          ✦
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: overlayTitle, marginBottom: 4 }}>
            描述你的任务
          </div>
          <div style={{ fontSize: 11, color: overlayHint }}>
            {`回车后将自动启动当前会话的运行器（${runnerBadge}），并将内容透传给 AI`}
          </div>
        </div>

        {waitingForPtyLaunch && (
          <div style={{
            width: "100%",
            background: "rgba(255,159,10,0.10)",
            border: "1px solid rgba(255,159,10,0.28)",
            borderRadius: 9,
            padding: "10px 14px",
            fontSize: 11,
            color: "rgba(255,195,80,0.92)",
            lineHeight: "1.6",
            textAlign: "center",
          }}>
            首条指令已排队，正在等待 worktree 和 PTY 准备完成。
          </div>
        )}

        {!querySent && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {(Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(([type, label]) => {
              const active = runnerType === type;
              return (
                <button
                  key={type}
                  onClick={() => handleSwitchRunner(type)}
                  disabled={launchDisabled}
                  style={{
                    fontSize: 10, padding: "3px 10px", borderRadius: 99,
                    background: active ? "var(--ci-accent-bg)" : actionButtonBackground,
                    border: active ? "1px solid var(--ci-accent-bdr)" : actionButtonBorder,
                    color: active ? "var(--ci-accent)" : actionButtonText,
                    cursor: launchDisabled ? "default" : "pointer",
                    transition: "all 0.15s",
                    fontWeight: active ? 600 : 400,
                    opacity: launchDisabled ? 0.7 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {cliAvailable === false && (
          <div style={{
            width: "100%",
            background: "var(--ci-yellow-bg)",
            border: "1px solid var(--ci-yellow-bdr)",
            borderRadius: 9,
            padding: "10px 14px",
            fontSize: 11,
            color: "var(--ci-yellow-dark)",
            lineHeight: "1.6",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠️ 找不到 {cliCommand}
            </div>
            <div style={{ color: overlayHint, marginBottom: 8 }}>
              安装命令：<code style={{ color: "rgba(255,195,80,0.8)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{installCmd}</code>
            </div>
            {installCmd && (
              <button
                onClick={handleInstall}
                style={{
                  width: "100%",
                  padding: "8px 0",
                  borderRadius: 6,
                  background: "var(--ci-accent-bg)",
                  border: "1px solid var(--ci-accent-bdr)",
                  color: "var(--ci-accent)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = runnerChipHoverBackground)}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--ci-accent-bg)")}
              >
                一键安装
              </button>
            )}
          </div>
        )}

        <div style={{
          width: "100%",
          background: inputBackground,
          border: inputBorder,
          borderRadius: 12,
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "10px 14px",
          backdropFilter: isGlass ? "none" : "blur(8px)",
          boxShadow: queryInputShadow,
          transition: "border-color 0.15s, box-shadow 0.15s",
          textShadow: "none",
        }}>
          <span style={{ color: "rgba(0,122,255,0.7)", fontSize: 13, marginTop: 1, flexShrink: 0 }}>›</span>
          <textarea
            ref={queryInputRef}
            value={pendingQuery}
            onChange={e => setPendingQuery(e.target.value)}
            placeholder="例：重构 auth 模块，添加 JWT 支持…"
            rows={3}
            readOnly={waitingForPtyLaunch}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: inputText, fontSize: 13, lineHeight: "1.6",
              resize: "none", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ fontSize: 10, color: overlayFooter }}>
          Enter 发送 · Shift+Enter 换行 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
