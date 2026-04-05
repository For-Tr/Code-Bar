import React, { useState } from "react";
import {
  useSettingsStore,
  RUNNER_LABELS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  RUNNER_PROVIDER,
  type RunnerType,
  type ModelProvider,
} from "../store/settingsStore";
// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:        "rgba(14,14,16,0.0)",
  surface:   "rgba(255,255,255,0.04)",
  surfaceHi: "rgba(255,255,255,0.08)",
  border:    "rgba(255,255,255,0.07)",
  borderHi:  "rgba(255,255,255,0.15)",
  text:      "rgba(255,255,255,0.85)",
  textMuted: "rgba(255,255,255,0.4)",
  textDim:   "rgba(255,255,255,0.22)",
  accent:    "#7c6df0",
  accentBg:  "rgba(124,109,240,0.14)",
  accentBdr: "rgba(124,109,240,0.32)",
  accentTxt: "#a89ff5",
  green:     "#4ade80",
  greenBg:   "rgba(74,222,128,0.12)",
  greenBdr:  "rgba(74,222,128,0.3)",
  red:       "#f87171",
  yellow:    "#fbbf24",
  yellowBg:  "rgba(251,191,36,0.1)",
  yellowBdr: "rgba(251,191,36,0.25)",
};

// ── 通用小件 ──────────────────────────────────────────────────

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
        background: C.surface,
        border: `1px solid ${focused ? C.borderHi : C.border}`,
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 12,
        color: C.text,
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color 0.15s",
        opacity: disabled ? 0.45 : 1,
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

// ── 卡片式单选 ─────────────────────────────────────────────────

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
              background: active ? C.accentBg : C.surface,
              border: `1px solid ${active ? C.accentBdr : C.border}`,
              borderRadius: 9,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
              border: `2px solid ${active ? C.accent : C.border}`,
              background: active ? C.accent : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}>
              {active && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 500,
                color: active ? C.accentTxt : C.text,
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

// ── Toggle ────────────────────────────────────────────────────

function Toggle({
  value, onChange, label, desc,
}: {
  value: boolean; onChange: (v: boolean) => void; label: string; desc?: string;
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 0", cursor: "pointer",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: C.text }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{
        width: 34, height: 18, borderRadius: 99, flexShrink: 0,
        background: value ? C.accent : "rgba(255,255,255,0.12)",
        display: "flex", alignItems: "center",
        padding: "0 2px",
        transition: "background 0.2s",
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          transform: value ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.2s",
        }} />
      </div>
    </div>
  );
}

// ── 单个 API Key 编辑行 ───────────────────────────────────────

function ApiKeyRow({
  provider,
  label,
  hint,
  placeholder,
}: {
  provider: ModelProvider;
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
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 5,
      }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{label}</span>
        {hasKey ? (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: C.greenBg, border: `1px solid ${C.greenBdr}`,
            color: C.green,
          }}>
            已配置
          </span>
        ) : (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 99,
            background: C.yellowBg, border: `1px solid ${C.yellowBdr}`,
            color: C.yellow,
          }}>
            未配置
          </span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>{hint}</div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
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
            padding: "0 12px",
            borderRadius: 8,
            border: `1px solid ${saved ? C.greenBdr : C.accentBdr}`,
            background: saved ? C.greenBg : C.accentBg,
            color: saved ? C.green : C.accentTxt,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
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

// ── Runner Tab ────────────────────────────────────────────────

const RUNNER_HINTS: Record<RunnerType, string> = {
  "claude-code": "调用本地 claude CLI，需提前安装",
  "codex":       "调用本地 codex CLI，需提前安装",
  "custom-cli":  "任意兼容 CLI，自定义路径和参数",
  "native":      "内置工作流，直接用 API Key 驱动 LLM",
};

function RunnerTab() {
  const { settings, patchRunner, openSettings } = useSettingsStore();
  const { runner } = settings;

  // 为每个需要 API Key 的 runner 生成角标
  const getRunnerBadge = (type: RunnerType) => {
    const provider = RUNNER_PROVIDER[type];
    if (!provider) return undefined;
    const hasKey = (settings.apiKeys[provider] || "").length > 0;
    return (
      <span style={{
        fontSize: 9, padding: "1px 5px", borderRadius: 99,
        background: hasKey ? C.greenBg : C.yellowBg,
        border: `1px solid ${hasKey ? C.greenBdr : C.yellowBdr}`,
        color: hasKey ? C.green : C.yellow,
      }}>
        {hasKey ? "Key 已配置" : "需要 API Key"}
      </span>
    );
  };

  const runnerOptions = (Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(
    ([value, label]) => ({
      value,
      label,
      hint: RUNNER_HINTS[value],
      badge: getRunnerBadge(value),
    })
  );

  return (
    <div>
      <CardSelect<RunnerType>
        value={runner.type}
        onChange={(v) => patchRunner({ type: v })}
        options={runnerOptions}
      />

      {/* CLI 模式下显示 API Key 快捷入口 */}
      {RUNNER_PROVIDER[runner.type] && (
        <div style={{
          marginTop: 12,
          padding: "9px 12px",
          background: C.yellowBg,
          border: `1px solid ${C.yellowBdr}`,
          borderRadius: 9,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 11, color: C.yellow }}>
            {runner.type === "claude-code" ? "Claude Code 需要 Anthropic API Key" : "Codex 需要 OpenAI API Key"}
          </div>
          <button
            onClick={() => openSettings("apikeys")}
            style={{
              fontSize: 10, padding: "3px 10px", borderRadius: 6,
              background: C.yellowBg, border: `1px solid ${C.yellowBdr}`,
              color: C.yellow, cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: 600,
            }}
          >
            管理 Keys →
          </button>
        </div>
      )}

      {runner.type !== "native" && (
        <>
          <SectionDivider label="CLI 路径" />
          <FieldLabel>可执行文件（留空从 PATH 自动查找）</FieldLabel>
          <TextInput
            value={runner.cliPath ?? ""}
            onChange={(v) => patchRunner({ cliPath: v })}
            placeholder={
              runner.type === "claude-code" ? "/usr/local/bin/claude"
              : runner.type === "codex" ? "/usr/local/bin/codex"
              : "/path/to/my-agent"
            }
          />
        </>
      )}

      {runner.type === "custom-cli" && (
        <div style={{ marginTop: 10 }}>
          <FieldLabel>附加参数</FieldLabel>
          <TextInput
            value={runner.cliArgs ?? ""}
            onChange={(v) => patchRunner({ cliArgs: v })}
            placeholder="--model gpt-4o --no-color"
          />
          <HintText>任务描述会作为最后一个参数传入</HintText>
        </div>
      )}

      {/* 三方 API 配置（CLI 模式下显示） */}
      {runner.type !== "native" && (
        <>
          <SectionDivider label="三方 API（可选）" />
          <FieldLabel>
            {runner.type === "claude-code" ? "API Base URL（ANTHROPIC_BASE_URL）"
            : runner.type === "codex" ? "API Base URL（OPENAI_BASE_URL）"
            : "API Base URL（API_BASE_URL）"}
          </FieldLabel>
          <TextInput
            value={runner.apiBaseUrl ?? ""}
            onChange={(v) => patchRunner({ apiBaseUrl: v })}
            placeholder={
              runner.type === "claude-code" ? "https://openrouter.ai/api/v1  （留空用官方端点）"
              : runner.type === "codex" ? "https://api.deepseek.com/v1  （留空用官方端点）"
              : "https://your-proxy.com/v1"
            }
          />
          <HintText>
            {runner.type === "claude-code"
              ? "支持 OpenRouter、AWS Bedrock 代理、Cloudflare AI Gateway 等兼容 Anthropic API 的服务"
              : runner.type === "codex"
              ? "支持 Azure OpenAI、DeepSeek 等兼容 OpenAI API 的服务"
              : "将作为 API_BASE_URL 环境变量注入 CLI 进程"}
          </HintText>
          <div style={{ marginTop: 10 }}>
            <FieldLabel>专属 API Key（留空则使用 API Keys 页中配置的对应密钥）</FieldLabel>
            <TextInput
              type="password"
              value={runner.apiKeyOverride ?? ""}
              onChange={(v) => patchRunner({ apiKeyOverride: v })}
              placeholder={runner.type === "claude-code" ? "sk-or-...  （三方服务专属 key）" : "sk-..."}
            />
            <HintText>
              此处的 Key 优先级高于 API Keys 页，适合不同服务商使用不同密钥的场景
            </HintText>
          </div>
        </>
      )}

      {runner.type === "native" && (
        <div style={{
          marginTop: 12,
          padding: "10px 12px",
          background: C.accentBg,
          border: `1px solid ${C.accentBdr}`,
          borderRadius: 9,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.accentTxt, marginBottom: 3 }}>
            内置 Harness
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, lineHeight: "1.6" }}>
            无需安装任何 CLI，直接用 API Key 调用 LLM。内置文件读写、命令执行、git diff 工具。
            请在「API Keys」页配置各服务商的密钥。
          </div>
        </div>
      )}
    </div>
  );
}

// ── Model Tab ─────────────────────────────────────────────────

const PROVIDER_HINTS: Record<ModelProvider, string> = {
  anthropic:           "Claude 系列模型",
  openai:              "GPT / o 系列模型",
  deepseek:            "DeepSeek Chat & Reasoner",
  "openai-compatible": "兼容 OpenAI 接口的自定义服务（智谱 GLM、OpenRouter 等）",
};

function ModelTab() {
  const { settings, patchModel } = useSettingsStore();
  const { model } = settings;

  const providerOptions = (Object.entries(PROVIDER_LABELS) as [ModelProvider, string][]).map(
    ([value, label]) => ({ value, label, hint: PROVIDER_HINTS[value] })
  );

  const modelOptions = PROVIDER_MODELS[model.provider].map((m) => ({
    value: m, label: m,
  }));

  return (
    <div>
      <SectionDivider label="服务商" />
      <CardSelect<ModelProvider>
        value={model.provider}
        onChange={(v) => patchModel({ provider: v, model: PROVIDER_MODELS[v][0] })}
        options={providerOptions}
      />

      <SectionDivider label="模型" />
      {model.provider === "openai-compatible" ? (
        <>
          <FieldLabel>Base URL</FieldLabel>
          <TextInput
            value={model.baseUrl ?? ""}
            onChange={(v) => patchModel({ baseUrl: v })}
            placeholder="https://open.bigmodel.cn/api/paas/v4"
          />
          <HintText>智谱 GLM 默认：https://open.bigmodel.cn/api/paas/v4</HintText>
          <div style={{ marginTop: 10 }}>
            <FieldLabel>模型名称</FieldLabel>
            <CardSelect<string>
              value={model.model}
              onChange={(v) => patchModel({ model: v })}
              options={[
                { value: "glm-4-flash",     label: "glm-4-flash",     hint: "免费额度，速度快" },
                { value: "glm-4-flash-250414", label: "glm-4-flash-250414", hint: "最新版 flash，免费额度" },
                { value: "glm-4",           label: "glm-4",           hint: "标准版，付费" },
                { value: "glm-4-plus",      label: "glm-4-plus",      hint: "高性能版，付费" },
                { value: "glm-z1-flash",    label: "glm-z1-flash",    hint: "推理增强，免费额度" },
              ]}
            />
            <div style={{ marginTop: 8 }}>
              <FieldLabel>自定义模型名（留空则用上方选择）</FieldLabel>
              <TextInput
                value={PROVIDER_MODELS[model.provider].includes(model.model) ? "" : model.model}
                onChange={(v) => { if (v) patchModel({ model: v }); }}
                placeholder="输入其他模型名，如 glm-4-airx"
              />
            </div>
          </div>
        </>
      ) : (
        <CardSelect<string>
          value={model.model}
          onChange={(v) => patchModel({ model: v })}
          options={modelOptions}
        />
      )}

      <SectionDivider label="参数" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <FieldLabel>Max Tokens</FieldLabel>
          <TextInput
            type="number"
            value={String(model.maxTokens ?? 8192)}
            onChange={(v) => patchModel({ maxTokens: Number(v) })}
          />
        </div>
        <div>
          <FieldLabel>Temperature</FieldLabel>
          <TextInput
            type="number"
            value={String(model.temperature ?? 0.7)}
            onChange={(v) => patchModel({ temperature: Number(v) })}
          />
        </div>
      </div>
    </div>
  );
}

// ── API Keys Tab ───────────────────────────────────────────────

function ApiKeysTab() {
  const { settings, saveProviderApiKey, patchRunner } = useSettingsStore();
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<string>("");

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
        claude_settings: Record<string, unknown>;
        claude_cli_path: string;
        codex_cli_path: string;
        claude_oauth_logged_in: boolean;
        claude_oauth_email: string;
      }>("detect_cli_config");

      // 回填检测到的值（仅当本地为空时才填充）
      const filled: string[] = [];
      if (result.anthropic_api_key && !settings.apiKeys.anthropic) {
        await saveProviderApiKey("anthropic", result.anthropic_api_key);
        filled.push("Anthropic Key");
      }
      if (result.openai_api_key && !settings.apiKeys.openai) {
        await saveProviderApiKey("openai", result.openai_api_key);
        filled.push("OpenAI Key");
      }
      if (result.anthropic_base_url && !settings.runner.apiBaseUrl) {
        patchRunner({ apiBaseUrl: result.anthropic_base_url });
        filled.push("Anthropic Base URL");
      }
      if (result.openai_base_url && !settings.runner.apiBaseUrl) {
        patchRunner({ apiBaseUrl: result.openai_base_url });
        filled.push("OpenAI Base URL");
      }

      if (filled.length > 0) {
        setDetectResult(`✓ 已导入: ${filled.join(", ")}`);
      } else if (result.claude_oauth_logged_in) {
        // Claude Code OAuth 登录模式：不需要 API Key
        const email = result.claude_oauth_email ? ` (${result.claude_oauth_email})` : "";
        setDetectResult(`✓ Claude Code 已登录${email}，无需配置 API Key`);
      } else if (result.claude_cli_path) {
        setDetectResult("Claude CLI 已安装，但未检测到 API Key。请在下方手动填写，或运行 claude /login 登录");
      } else {
        setDetectResult("未检测到配置。请手动填写 API Key 或安装 Claude Code CLI");
      }
    } catch (e) {
      setDetectResult(`检测失败: ${e}`);
    } finally {
      setDetecting(false);
      setTimeout(() => setDetectResult(""), 6000);
    }
  };

  return (
    <div>
      <div style={{
        padding: "8px 10px 12px",
        fontSize: 11,
        color: C.textMuted,
        lineHeight: "1.6",
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 14,
      }}>
        所有密钥均加密存储在本地，不上传任何服务器。切换模型服务商时会自动使用对应的密钥。
      </div>

      {/* 自动检测按钮 */}
      <div style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={handleAutoDetect}
          disabled={detecting}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: `1px solid ${C.accentBdr}`,
            background: C.accentBg,
            color: C.accentTxt,
            fontSize: 11,
            fontWeight: 500,
            cursor: detecting ? "default" : "pointer",
            opacity: detecting ? 0.6 : 1,
            transition: "all 0.15s",
          }}
        >
          {detecting ? "检测中…" : "🔍 自动检测系统配置"}
        </button>
        <button
          onClick={async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const result = await invoke("debug_env", { command: "claude" });
            alert(JSON.stringify(result, null, 2));
          }}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid rgba(251,191,36,0.3)",
            background: "rgba(251,191,36,0.08)",
            color: "rgba(251,191,36,0.8)",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          🐞 诊断 PATH
        </button>
        <button
          onClick={async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            try {
              const result = await invoke<string>("setup_claude_hooks");
              alert(result);
            } catch (e) {
              alert(`配置失败: ${e}`);
            }
          }}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid rgba(124,109,240,0.3)",
            background: "rgba(124,109,240,0.08)",
            color: "rgba(124,109,240,0.8)",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          🔔 启用 Claude Code Hooks
        </button>
        <button
          onClick={async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            try {
              await invoke("send_notification", {
                title: "Coding Island",
                body: "🔔 通知权限正常，任务完成时会弹出此提示",
              });
            } catch (e) {
              alert(`通知发送失败: ${e}\n\n请在「系统设置 → 通知 → Coding Island」中开启通知权限`);
            }
          }}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid rgba(74,222,128,0.3)",
            background: "rgba(74,222,128,0.08)",
            color: "rgba(74,222,128,0.8)",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          🔔 测试通知
        </button>
        {detectResult && (
          <span style={{ fontSize: 10, color: C.textMuted }}>{detectResult}</span>
        )}
      </div>
      <HintText>
        自动从 ~/.claude/settings.json、系统环境变量（ANTHROPIC_API_KEY 等）及 Shell 配置文件中检测 API Key 和 Base URL
      </HintText>

      <ApiKeyRow
        provider="anthropic"
        label="Anthropic"
        hint="用于 Claude Code CLI 和内置 Harness（Anthropic 模型）"
        placeholder="sk-ant-..."
      />

      <ApiKeyRow
        provider="openai"
        label="OpenAI"
        hint="用于 OpenAI Codex CLI 和内置 Harness（OpenAI 模型）"
        placeholder="sk-..."
      />

      <ApiKeyRow
        provider="deepseek"
        label="DeepSeek"
        hint="用于内置 Harness（DeepSeek 模型）"
        placeholder="sk-..."
      />

      <ApiKeyRow
        provider="openai-compatible"
        label="自定义服务"
        hint="用于 OpenAI 兼容接口"
        placeholder="sk-... 或自定义 token"
      />
    </div>
  );
}

// ── Harness Tab ───────────────────────────────────────────────

function HarnessTab() {
  const { settings, patchHarness, patchSettings } = useSettingsStore();
  const { harness } = settings;

  return (
    <div>
      <HintText>
        以下权限仅在「内置 Harness」模式下生效，CLI 工具的权限由其自身控制。
      </HintText>
      <div style={{ marginTop: 8 }}>
        <Toggle value={harness.allowReadFiles}    onChange={(v) => patchHarness({ allowReadFiles: v })}    label="读取文件"    desc="读取工作目录内的文件" />
        <Toggle value={harness.allowWriteFiles}   onChange={(v) => patchHarness({ allowWriteFiles: v })}   label="写入文件"    desc="创建或修改文件" />
        <Toggle value={harness.confirmBeforeWrite}onChange={(v) => patchHarness({ confirmBeforeWrite: v })} label="写入前确认"  desc="每次写操作前弹出确认框" />
        <Toggle value={harness.allowRunCommands}  onChange={(v) => patchHarness({ allowRunCommands: v })}  label="执行命令"    desc="运行 Shell 命令" />
        <Toggle value={harness.confirmBeforeRun}  onChange={(v) => patchHarness({ confirmBeforeRun: v })}  label="执行前确认"  desc="每次执行前弹出确认框" />
        <Toggle value={harness.allowNetworkRequests} onChange={(v) => patchHarness({ allowNetworkRequests: v })} label="网络请求" desc="调用外部 HTTP 接口" />
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
        padding: "8px 10px 10px",
        background: C.accentBg,
        border: `1px solid ${C.accentBdr}`,
        borderRadius: 9,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.accentTxt, marginBottom: 3 }}>
          ✦ 独立 Worktree 工作流
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, lineHeight: "1.6" }}>
          每次任务在独立的 <code style={{ color: C.accentTxt, fontSize: 10 }}>git worktree</code> 中运行，不影响主工作区。
          任务完成后可查看 Diff，选择「合并到主分支」或「丢弃」。
        </div>
      </div>
    </div>
  );
}

// ── 主 Settings Panel ─────────────────────────────────────────

type SettingsTab = "runner" | "model" | "apikeys" | "harness";

export default function Settings() {
  const { settingsOpen, activeTab, setTab, closeSettings } = useSettingsStore();

  if (!settingsOpen) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "runner",  label: "Runner" },
    { id: "model",   label: "模型" },
    { id: "apikeys", label: "API Keys" },
    { id: "harness", label: "Harness" },
  ];

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(10,10,12,0.85)",
      backdropFilter: "blur(8px)",
      borderRadius: 16,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "13px 14px 11px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>设置</span>
        <button
          onClick={closeSettings}
          style={{
            width: 22, height: 22, borderRadius: 6,
            background: C.surface, border: `1px solid ${C.border}`,
            color: C.textMuted, cursor: "pointer", fontSize: 11,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = C.red; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.textMuted; }}
        >
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 2,
        padding: "8px 10px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as SettingsTab)}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 7,
                border: `1px solid ${active ? C.accentBdr : "transparent"}`,
                background: active ? C.accentBg : "transparent",
                color: active ? C.accentTxt : C.textMuted,
                fontSize: 11, fontWeight: active ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "12px 14px 16px",
      }}>
        {activeTab === "runner"  && <RunnerTab />}
        {activeTab === "model"   && <ModelTab />}
        {activeTab === "apikeys" && <ApiKeysTab />}
        {activeTab === "harness" && <HarnessTab />}
      </div>
    </div>
  );
}
