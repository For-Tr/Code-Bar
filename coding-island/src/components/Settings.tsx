import React, { useState } from "react";
import {
  useSettingsStore,
  RUNNER_LABELS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
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
  red:       "#f87171",
};

// ── 通用小件（全部用 inline style，匹配主界面风格）──────────

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

// ── 卡片式单选（替代 <select>）───────────────────────────────

function CardSelect<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
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
            {/* 选中圈 */}
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
              }}>
                {o.label}
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
      {/* pill toggle */}
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

// ── Runner Tab ────────────────────────────────────────────────

const RUNNER_HINTS: Record<RunnerType, string> = {
  "claude-code": "调用本地 claude CLI，需提前安装",
  "codex":       "调用本地 codex CLI，需提前安装",
  "custom-cli":  "任意兼容 CLI，自定义路径和参数",
  "native":      "内置工作流，直接用 API Key 驱动 LLM",
};

function RunnerTab() {
  const { settings, patchRunner } = useSettingsStore();
  const { runner } = settings;

  const runnerOptions = (Object.entries(RUNNER_LABELS) as [RunnerType, string][]).map(
    ([value, label]) => ({ value, label, hint: RUNNER_HINTS[value] })
  );

  return (
    <div>
      <CardSelect<RunnerType>
        value={runner.type}
        onChange={(v) => patchRunner({ type: v })}
        options={runnerOptions}
      />

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
            请在「模型」页配置 API Key。
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
  "openai-compatible": "兼容 OpenAI 接口的自定义服务",
};

function ModelTab() {
  const { settings, patchModel, saveApiKey } = useSettingsStore();
  const { model } = settings;
  const [apiKeyInput, setApiKeyInput] = useState(model.apiKey || "");
  const [keySaved, setKeySaved] = useState(false);

  const providerOptions = (Object.entries(PROVIDER_LABELS) as [ModelProvider, string][]).map(
    ([value, label]) => ({ value, label, hint: PROVIDER_HINTS[value] })
  );

  const modelOptions = PROVIDER_MODELS[model.provider].map((m) => ({
    value: m, label: m,
  }));

  const handleSaveKey = async () => {
    await saveApiKey(apiKeyInput);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

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
            placeholder="https://your-service.com/v1"
          />
          <div style={{ marginTop: 10 }}>
            <FieldLabel>模型名称</FieldLabel>
            <TextInput
              value={model.model}
              onChange={(v) => patchModel({ model: v })}
              placeholder="输入模型名"
            />
          </div>
        </>
      ) : (
        <CardSelect<string>
          value={model.model}
          onChange={(v) => patchModel({ model: v })}
          options={modelOptions}
        />
      )}

      <SectionDivider label="API Key" />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <TextInput
            type="password"
            value={apiKeyInput}
            onChange={setApiKeyInput}
            placeholder="sk-..."
          />
        </div>
        <button
          onClick={handleSaveKey}
          style={{
            padding: "0 14px",
            borderRadius: 8,
            border: `1px solid ${keySaved ? "rgba(74,222,128,0.3)" : C.accentBdr}`,
            background: keySaved ? C.greenBg : C.accentBg,
            color: keySaved ? C.green : C.accentTxt,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 0.2s",
          }}
        >
          {keySaved ? "✓ 已保存" : "保存"}
        </button>
      </div>
      <HintText>加密存储在本地，不上传任何服务器</HintText>

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
    </div>
  );
}

// ── 主 Settings Panel ─────────────────────────────────────────

type SettingsTab = "runner" | "model" | "harness";

export default function Settings() {
  const { settingsOpen, activeTab, setTab, closeSettings } = useSettingsStore();

  if (!settingsOpen) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "runner", label: "Runner" },
    { id: "model",  label: "模型" },
    { id: "harness",label: "Harness" },
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
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 7,
                border: `1px solid ${active ? C.accentBdr : "transparent"}`,
                background: active ? C.accentBg : "transparent",
                color: active ? C.accentTxt : C.textMuted,
                fontSize: 12, fontWeight: active ? 600 : 400,
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
        {activeTab === "harness" && <HarnessTab />}
      </div>
    </div>
  );
}
