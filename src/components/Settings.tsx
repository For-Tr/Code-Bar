import React, { useEffect, useState } from "react";
import {
  useSettingsStore,
  RUNNER_LABELS,
  RUNNER_PROVIDER,
  type RunnerType,
  type ThemeMode,
  isGlassTheme,
} from "../store/settingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSessionStore } from "../store/sessionStore";

const C = {
  bg:        "var(--ci-bg)",
  surface:   "var(--ci-surface)",
  surfaceHi: "var(--ci-surface-hi)",
  border:    "var(--ci-border)",
  borderHi:  "var(--ci-border-hi)",
  borderMed: "var(--ci-border-med)",
  text:      "var(--ci-text)",
  textMuted: "var(--ci-text-muted)",
  textDim:   "var(--ci-text-dim)",
  accent:    "var(--ci-accent)",
  accentBg:  "var(--ci-accent-bg)",
  accentBdr: "var(--ci-accent-bdr)",
  accentTxt: "var(--ci-accent)",
  green:     "var(--ci-green)",
  greenDark: "var(--ci-green-dark)",
  greenBg:   "var(--ci-green-bg)",
  greenBdr:  "var(--ci-green-bdr)",
  red:       "var(--ci-red)",
  yellow:    "var(--ci-yellow)",
  yellowBg:  "var(--ci-yellow-bg)",
  yellowBdr: "var(--ci-yellow-bdr)",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>
      {children}
    </div>
  );
}

function TextInput({
  value, onChange, type = "text", placeholder, disabled,
}: {
  value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        background: focused ? C.surfaceHi : C.surface,
        border: `1px solid ${focused ? C.borderHi : C.border}`,
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 12,
        color: C.text,
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
        opacity: disabled ? 0.45 : 1,
        boxShadow: focused ? "0 0 0 3px rgba(0,122,255,0.12)" : "none",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}
    />
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: C.textDim, marginTop: 5, lineHeight: "1.5" }}>
      {children}
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0 10px" }}>
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: C.textDim, whiteSpace: "nowrap",
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function Toggle({
  value, onChange, label, desc, disabled = false, showDivider = true, labelStyle,
}: {
  value: boolean; onChange: (v: boolean) => void; label: string; desc?: string; disabled?: boolean; showDivider?: boolean; labelStyle?: React.CSSProperties;
}) {
  return (
    <div
      onClick={() => {
        if (disabled) return;
        onChange(!value);
      }}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 0", cursor: disabled ? "default" : "pointer",
        borderBottom: showDivider ? `1px solid ${C.border}` : "none",
        opacity: disabled ? 0.56 : 1,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: C.text, ...labelStyle }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 99, flexShrink: 0,
        background: value ? C.accent : "rgba(120,120,128,0.2)",
        display: "flex", alignItems: "center",
        padding: "0 2px",
        transition: "background 0.22s",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.25), 0 0.5px 1px rgba(0,0,0,0.12)",
          transform: value ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.22s",
        }} />
      </div>
    </div>
  );
}

function CardSelect<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; badge?: React.ReactNode }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px",
              background: active ? C.surfaceHi : C.surface,
              border: `1px solid ${active ? "rgba(0,122,255,0.3)" : C.border}`,
              borderRadius: 10,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
              border: `2px solid ${active ? C.accent : C.borderMed}`,
              background: active ? C.accent : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}>
              {active && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 500,
                color: active ? C.text : C.textMuted,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {o.label}
                {o.badge}
              </div>
              {o.hint && (
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
                  {o.hint}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ApiKeyRow({
  provider,
  label,
  hint,
  placeholder,
}: {
  provider: "anthropic" | "openai";
  label: string;
  hint?: string;
  placeholder?: string;
}) {
  const { settings, saveProviderApiKey } = useSettingsStore();
  const stored = settings.apiKeys[provider] || "";
  const [inputVal, setInputVal] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasKey = stored.length > 0;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    await saveProviderApiKey(provider, inputVal);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{
      marginBottom: 10,
      padding: "10px 12px",
      background: C.surfaceHi,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: hint ? 4 : 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{label}</span>
        {hasKey ? (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: C.greenBg, border: `1px solid ${C.greenBdr}`,
            color: C.greenDark, fontWeight: 600,
          }}>✓ 已配置</span>
        ) : (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: C.yellowBg, border: `1px solid ${C.yellowBdr}`,
            color: C.yellow, fontWeight: 600,
          }}>未配置</span>
        )}
      </div>
      {hint && <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{hint}</div>}
      <div style={{ display: "flex", gap: 7 }}>
        <div style={{ flex: 1 }}>
          <TextInput
            type="password"
            value={inputVal}
            onChange={setInputVal}
            placeholder={placeholder ?? "sk-..."}
          />
        </div>
        <button
          onClick={handleSave}
          style={{
            padding: "0 14px",
            borderRadius: 8,
            border: `1px solid ${saved ? C.greenBdr : C.accentBdr}`,
            background: saved ? C.greenBg : C.accentBg,
            color: saved ? C.greenDark : C.accentTxt,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 0.2s",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saved ? "✓ 已保存" : saving ? "…" : "保存"}
        </button>
      </div>
    </div>
  );
}

const RUNNER_HINTS: Record<RunnerType, string> = {
  "claude-code": "调用本地 claude CLI，需提前安装",
  "codex": "调用本地 codex CLI，需提前安装",
};

function RunnerSettings() {
  const { settings, patchRunner, openSettings } = useSettingsStore();
  const { runner } = settings;

  const runnerOptions = (Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(
    ([value, label]) => ({
      value,
      label,
      hint: RUNNER_HINTS[value],
      badge: (
        <span style={{
          fontSize: 9, padding: "1px 5px", borderRadius: 99,
          background: settings.apiKeys[RUNNER_PROVIDER[value]] ? C.greenBg : C.yellowBg,
          border: `1px solid ${settings.apiKeys[RUNNER_PROVIDER[value]] ? C.greenBdr : C.yellowBdr}`,
          color: settings.apiKeys[RUNNER_PROVIDER[value]] ? C.green : C.yellow,
        }}>
          {settings.apiKeys[RUNNER_PROVIDER[value]] ? "Key 已配置" : "需要 API Key"}
        </span>
      ),
    })
  );

  return (
    <div>
      <SectionDivider label="Runner" />
      <CardSelect<RunnerType>
        value={runner.type}
        onChange={(v) => patchRunner({ type: v })}
        options={runnerOptions}
      />

      <div style={{
        marginTop: 12, padding: "10px 12px",
        background: C.yellowBg, border: `1px solid ${C.yellowBdr}`,
        borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 11, color: C.yellow, fontWeight: 500 }}>
          {runner.type === "claude-code" ? "Claude Code 需要 Anthropic API Key" : "Codex 需要 OpenAI API Key"}
        </div>
        <button
          onClick={() => openSettings("system")}
          style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 7,
            background: C.yellow, border: "none",
            color: "#fff", cursor: "pointer", fontWeight: 600,
          }}
        >
          查看下方配置
        </button>
      </div>

      <SectionDivider label="CLI 路径" />
      <FieldLabel>可执行文件（留空从 PATH 自动查找）</FieldLabel>
      <TextInput
        value={runner.cliPath ?? ""}
        onChange={(v) => patchRunner({ cliPath: v })}
        placeholder={runner.type === "claude-code" ? "/usr/local/bin/claude" : "/usr/local/bin/codex"}
      />

      <SectionDivider label="三方 API（可选）" />
      <FieldLabel>
        {runner.type === "claude-code" ? "API Base URL（ANTHROPIC_BASE_URL）" : "API Base URL（OPENAI_BASE_URL）"}
      </FieldLabel>
      <TextInput
        value={runner.apiBaseUrl ?? ""}
        onChange={(v) => patchRunner({ apiBaseUrl: v })}
        placeholder={runner.type === "claude-code" ? "https://openrouter.ai/api/v1  （留空用官方端点）" : "https://api.openai.com/v1  （留空用官方端点）"}
      />
      <HintText>
        {runner.type === "claude-code"
          ? "支持 OpenRouter、AWS Bedrock 代理、Cloudflare AI Gateway 等兼容 Anthropic API 的服务"
          : "支持 Azure OpenAI、DeepSeek 等兼容 OpenAI API 的服务"}
      </HintText>
      <div style={{ marginTop: 10 }}>
        <FieldLabel>专属 API Key（留空则使用下方保存的对应密钥）</FieldLabel>
        <TextInput
          type="password"
          value={runner.apiKeyOverride ?? ""}
          onChange={(v) => patchRunner({ apiKeyOverride: v })}
          placeholder={runner.type === "claude-code" ? "sk-or-...  （三方服务专属 key）" : "sk-..."}
        />
      </div>
    </div>
  );
}

function SystemTab() {
  const { settings, patchSettings, saveProviderApiKey, patchRunner } = useSettingsStore();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessions = useSessionStore((s) => s.sessions);
  const [pruningWorktrees, setPruningWorktrees] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<{ enabled: boolean } | null>(null);

  const refreshIntegrationStatus = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<{ enabled: boolean }>("get_notifications_and_hooks_status");
      setIntegrationStatus({ enabled: status.enabled });
    } catch {}
  };

  useEffect(() => {
    void refreshIntegrationStatus();
  }, []);

  const handleToggleIntegrations = async () => {
    if (integrationBusy || !("__TAURI_INTERNALS__" in window)) return;

    const nextEnabled = !(integrationStatus?.enabled ?? true);
    setIntegrationBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("set_notifications_and_hooks_enabled", {
        enabled: nextEnabled,
      });
      await refreshIntegrationStatus();
    } catch {
    } finally {
      setIntegrationBusy(false);
    }
  };

  const handleAutoDetect = async () => {
    if (detecting) return;
    setDetecting(true);
    setDetectResult("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{
        anthropic_api_key: string;
        anthropic_base_url: string;
        openai_api_key: string;
        openai_base_url: string;
        claude_cli_path: string;
        codex_cli_path: string;
        claude_oauth_logged_in: boolean;
        claude_oauth_email: string;
      }>("detect_cli_config");

      const filled: string[] = [];
      if (result.anthropic_api_key && !settings.apiKeys.anthropic) {
        await saveProviderApiKey("anthropic", result.anthropic_api_key);
        filled.push("Anthropic Key");
      }
      if (result.openai_api_key && !settings.apiKeys.openai) {
        await saveProviderApiKey("openai", result.openai_api_key);
        filled.push("OpenAI Key");
      }
      if (result.anthropic_base_url && settings.runner.type === "claude-code" && !settings.runner.apiBaseUrl) {
        patchRunner({ apiBaseUrl: result.anthropic_base_url });
        filled.push("Anthropic Base URL");
      }
      if (result.openai_base_url && settings.runner.type === "codex" && !settings.runner.apiBaseUrl) {
        patchRunner({ apiBaseUrl: result.openai_base_url });
        filled.push("OpenAI Base URL");
      }

      if (filled.length > 0) {
        setDetectResult(`✓ 已导入: ${filled.join(", ")}`);
      } else if (result.claude_oauth_logged_in) {
        const email = result.claude_oauth_email ? ` (${result.claude_oauth_email})` : "";
        setDetectResult(`✓ Claude Code 已登录${email}，无需配置 API Key`);
      } else if (result.claude_cli_path || result.codex_cli_path) {
        setDetectResult("已检测到 CLI 安装，可继续按需填写 API Key / Base URL");
      } else {
        setDetectResult("未检测到配置。请手动填写 API Key 或安装 Claude Code / Codex CLI");
      }
    } catch (e) {
      setDetectResult(`检测失败: ${e}`);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div>
      <RunnerSettings />

      <SectionDivider label="API Keys" />
      <ApiKeyRow
        provider="anthropic"
        label="Anthropic"
        hint="用于 Claude Code CLI"
        placeholder="sk-ant-..."
      />
      <ApiKeyRow
        provider="openai"
        label="OpenAI"
        hint="用于 OpenAI Codex CLI"
        placeholder="sk-..."
      />

      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => { void handleAutoDetect(); }}
          disabled={detecting}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: `1px solid ${C.accentBdr}`,
            background: C.accentBg,
            color: C.accent,
            fontSize: 11,
            fontWeight: 600,
            cursor: detecting ? "default" : "pointer",
            opacity: detecting ? 0.6 : 1,
          }}
        >
          {detecting ? "检测中…" : "自动检测 CLI 配置"}
        </button>
        {detectResult && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.textDim, lineHeight: "1.6" }}>
            {detectResult}
          </div>
        )}
      </div>

      <SectionDivider label="通知" />
      <div
        style={{
          padding: "0 14px",
          background: "var(--ci-surface-hi)",
          borderRadius: 14,
        }}
      >
        <Toggle
          value={integrationStatus?.enabled ?? false}
          onChange={() => {
            void handleToggleIntegrations();
          }}
          label="通知"
          disabled={integrationBusy || integrationStatus === null}
          showDivider={false}
          labelStyle={{ fontSize: 14, fontWeight: 600 }}
        />
      </div>

      <SectionDivider label="Git Diff" />
      <Toggle
        value={settings.autoRefreshDiff}
        onChange={(v) => patchSettings({ autoRefreshDiff: v })}
        label="自动刷新 Diff"
        desc="Session 运行期间定期刷新 git diff"
      />
      {settings.autoRefreshDiff && (
        <div style={{ marginTop: 10 }}>
          <FieldLabel>刷新间隔（秒）</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.diffRefreshIntervalSec)}
            onChange={(v) => patchSettings({ diffRefreshIntervalSec: Number(v) })}
          />
        </div>
      )}

      <SectionDivider label="Git Worktree" />
      <div style={{
        padding: "10px 12px",
        background: C.accentBg,
        border: `1px solid ${C.accentBdr}`,
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginBottom: 3 }}>
          ✦ 独立 Worktree 工作流
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, lineHeight: "1.6" }}>
          每次任务在独立的 <code style={{ color: C.accent, fontSize: 10 }}>git worktree</code> 中运行，不影响主工作区。
          任务完成后可查看 Diff，选择「合并到主分支」或「丢弃」。
        </div>
        <button
          onClick={async () => {
            if (pruningWorktrees) return;
            if (!("__TAURI_INTERNALS__" in window)) return;
            if (!confirm("将扫描并删除孤儿 worktree 目录（不在当前 session 列表中的 worktree）。是否继续？")) {
              return;
            }

            setPruningWorktrees(true);
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              let total = 0;
              const lines: string[] = [];

              for (const ws of workspaces) {
                const knownPaths = sessions
                  .filter((s) => s.workspaceId === ws.id && s.worktreePath)
                  .map((s) => s.worktreePath as string);

                const pruned = await invoke<string[]>("prune_orphan_worktrees", {
                  workdir: ws.path,
                  knownWorktreePaths: knownPaths,
                });

                if (pruned.length > 0) {
                  total += pruned.length;
                  lines.push(`${ws.name}: ${pruned.length} 个`);
                }
              }

              if (total > 0) {
                alert(`已清理 ${total} 个孤儿 worktree。\n${lines.join("\n")}`);
              } else {
                alert("未发现需要清理的孤儿 worktree。");
              }
            } catch (e) {
              alert(`清理失败: ${e}`);
            } finally {
              setPruningWorktrees(false);
            }
          }}
          disabled={pruningWorktrees}
          style={{
            marginTop: 10,
            padding: "7px 12px",
            borderRadius: 8,
            border: `1px solid ${C.yellowBdr}`,
            background: C.yellowBg,
            color: C.yellow,
            fontSize: 11,
            fontWeight: 500,
            cursor: pruningWorktrees ? "default" : "pointer",
            opacity: pruningWorktrees ? 0.6 : 1,
            transition: "filter 0.12s",
          }}
          onMouseEnter={e => e.currentTarget.style.filter = "brightness(0.9)"}
          onMouseLeave={e => e.currentTarget.style.filter = "none"}
        >
          {pruningWorktrees ? "清理中…" : "🧹 手动清理孤儿 Worktree"}
        </button>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { settings, patchSettings } = useSettingsStore();

  type ThemeOption = ThemeMode;

  const themeOptions: {
    value: ThemeOption;
    label: string;
    icon: string;
    shell: string;
    card: string;
    accent: string;
    textColor: string;
  }[] = [
    {
      value: "light",
      label: "浅色",
      icon: "☀",
      shell: "linear-gradient(180deg, #f7f9fc 0%, #eef2f8 100%)",
      card: "rgba(255,255,255,0.76)",
      accent: "#0f7cff",
      textColor: "#223246",
    },
    {
      value: "dark",
      label: "深色",
      icon: "◐",
      shell: "linear-gradient(180deg, #17191f 0%, #101217 100%)",
      card: "rgba(43,48,60,0.78)",
      accent: "#5ea1ff",
      textColor: "rgba(245,247,255,0.92)",
    },
    {
      value: "glass",
      label: "原生 Glass",
      icon: "◎",
      shell: "linear-gradient(135deg, rgba(244,248,255,0.72) 0%, rgba(210,228,255,0.38) 100%)",
      card: "rgba(255,255,255,0.34)",
      accent: "#3291ff",
      textColor: "#173556",
    },
    {
      value: "system",
      label: "跟随系统",
      icon: "⌘",
      shell: "linear-gradient(135deg, #f6f7fb 0%, #d9dde7 48%, #1e2330 100%)",
      card: "rgba(255,255,255,0.62)",
      accent: "#4f7bff",
      textColor: "#243347",
    },
  ];

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}>
        {themeOptions.map((opt) => {
          const active = settings.theme === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => patchSettings({ theme: opt.value })}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 12,
                background: active ? "linear-gradient(180deg, var(--ci-surface-hi), var(--ci-surface))" : C.surface,
                border: `1px solid ${active ? C.accentBdr : C.border}`,
                borderRadius: 18,
                cursor: "pointer",
                textAlign: "left",
                transition: "transform 0.16s, border-color 0.16s, box-shadow 0.16s, background 0.16s",
                boxShadow: active
                  ? `0 0 0 3px ${C.accentBg}, var(--ci-card-shadow-strong)`
                  : "none",
                transform: active ? "translateY(-1px)" : "translateY(0)",
              }}
            >
              <div style={{
                position: "relative",
                height: 118,
                borderRadius: 14,
                background: opt.shell,
                overflow: "hidden",
                padding: 12,
                boxSizing: "border-box",
              }}>
                <div style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(255,255,255,0.18), transparent 48%)",
                  opacity: 0.55,
                  pointerEvents: "none",
                }} />
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 8, height: "100%" }}>
                  <div style={{
                    borderRadius: 12,
                    background: opt.card,
                    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
                    backdropFilter: "blur(18px)",
                    WebkitBackdropFilter: "blur(18px)",
                  }} />
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{
                      borderRadius: 12,
                      background: opt.card,
                      backdropFilter: "blur(18px)",
                      WebkitBackdropFilter: "blur(18px)",
                    }} />
                    <div style={{
                      borderRadius: 12,
                      background: `linear-gradient(135deg, ${opt.accent}, rgba(255,255,255,0.2))`,
                      boxShadow: "0 8px 18px rgba(15,23,42,0.10)",
                    }} />
                  </div>
                </div>
                <div style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.24)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: opt.textColor,
                  fontSize: 14,
                  fontWeight: 700,
                }}>
                  {opt.icon}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>
                    {active ? "Current" : "Mode"}
                  </div>
                  <div style={{
                    fontSize: 14, fontWeight: active ? 700 : 600,
                    color: active ? C.accent : C.text,
                  }}>
                    {opt.label}
                  </div>
                </div>
                <div style={{
                  minWidth: 20,
                  height: 20,
                  padding: active ? "0 8px" : 0,
                  borderRadius: 999,
                  border: `1px solid ${active ? C.accentBdr : "transparent"}`,
                  background: active ? C.accentBg : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: active ? C.accent : C.textDim,
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  {active ? "已选" : "○"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type VisibleSettingsTab = "system" | "appearance";

const SETTINGS_NAV_ITEMS: {
  value: VisibleSettingsTab;
  label: string;
  icon: string;
}[] = [
  {
    value: "appearance",
    label: "外观设置",
    icon: "◐",
  },
  {
    value: "system",
    label: "系统设置",
    icon: "⚙",
  },
];

function resolveVisibleSettingsTab(tab: string): VisibleSettingsTab {
  return tab === "appearance" ? "appearance" : "system";
}

export default function Settings() {
  const { settingsOpen, closeSettings, activeTab, setTab } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const strongTextShadow = isGlass ? "var(--ci-glass-text-shadow-strong)" : "none";
  const visibleTab = resolveVisibleSettingsTab(activeTab);

  if (!settingsOpen) return null;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: isGlass ? "transparent" : "var(--ci-overlay-bg)",
      backdropFilter: isGlass ? "none" : "blur(28px) saturate(1.3)",
      WebkitBackdropFilter: isGlass ? "none" : "blur(28px) saturate(1.3)",
      borderRadius: 16,
      display: "flex",
      padding: isGlass ? 0 : 14,
      boxSizing: "border-box",
      textShadow,
    }}>
      <div style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: isGlass ? "transparent" : "var(--ci-overlay-bg)",
        border: "none",
        borderRadius: isGlass ? 0 : 24,
        boxShadow: isGlass ? "var(--ci-inset-highlight)" : "var(--ci-card-shadow-strong)",
      }}>
        <div
          data-tauri-drag-region
          style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px 14px",
          flexShrink: 0,
          background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
          cursor: "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, marginBottom: 3 }}>
              Preferences
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3, textShadow: strongTextShadow }}>
              设置
            </span>
          </div>
          <button
            onClick={closeSettings}
            style={{
              width: 28, height: 28, borderRadius: 9,
              background: "var(--ci-close-bg)",
              border: `0.5px solid var(--ci-close-border)`,
              color: C.textMuted, cursor: "pointer", fontSize: 11,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = isGlass ? "var(--ci-close-bg)" : "rgba(255,59,48,0.15)";
              e.currentTarget.style.color = C.red;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--ci-close-bg)";
              e.currentTarget.style.color = C.textMuted;
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            ✕
          </button>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          padding: "0px 18px 18px",
          background: isGlass ? "var(--ci-bg-grad)" : "transparent",
        }}>
          <div style={{
            minHeight: 0,
            height: "100%",
            borderRadius: 22,
            background: "transparent",
            boxShadow: "none",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 20,
              flexWrap: "wrap",
              padding: "0 18px",
              background: "transparent",
              flexShrink: 0,
            }}>
              {SETTINGS_NAV_ITEMS.map((item) => {
                const active = visibleTab === item.value;
                return (
                  <button
                    key={item.value}
                    onClick={() => setTab(item.value)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "14px 0 12px",
                      marginBottom: -1,
                      border: "none",
                      borderBottom: `2px solid ${active ? C.accent : "transparent"}`,
                      background: "transparent",
                      color: active ? C.text : C.textMuted,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      transition: "border-color 0.16s, color 0.16s",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              scrollbarWidth: "none",
              padding: "18px",
            }}>
              {visibleTab === "appearance" ? <AppearanceTab /> : <SystemTab />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
