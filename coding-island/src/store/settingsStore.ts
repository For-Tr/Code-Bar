import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Runner 类型 ───────────────────────────────────────────────

export type RunnerType =
  | "claude-code"    // Anthropic Claude Code CLI
  | "codex"          // OpenAI Codex CLI
  | "custom-cli"     // 用户自定义 CLI
  | "native";        // 内置 Harness（直接调 LLM API）

export interface RunnerConfig {
  type: RunnerType;
  // CLI 类 Runner 的可执行文件路径（留空则从 PATH 找）
  cliPath?: string;
  // CLI 附加参数
  cliArgs?: string;
}

// ── 模型配置 ─────────────────────────────────────────────────

export type ModelProvider =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openai-compatible"; // 兼容 OpenAI 接口的自定义服务

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;       // 明文暂存（Rust 侧加密写盘）
  baseUrl?: string;     // openai-compatible 时填写
  maxTokens?: number;
  temperature?: number;
}

// ── NativeHarness 工具权限 ───────────────────────────────────

export interface HarnessPermissions {
  allowReadFiles: boolean;
  allowWriteFiles: boolean;
  allowRunCommands: boolean;
  allowNetworkRequests: boolean;
  confirmBeforeWrite: boolean;
  confirmBeforeRun: boolean;
}

// ── 完整 Settings ────────────────────────────────────────────

export interface Settings {
  runner: RunnerConfig;
  model: ModelConfig;
  harness: HarnessPermissions;
  // 通用
  autoRefreshDiff: boolean;
  diffRefreshIntervalSec: number;
  theme: "dark" | "system";
}

const DEFAULT_SETTINGS: Settings = {
  runner: {
    type: "claude-code",
    cliPath: "",
    cliArgs: "",
  },
  model: {
    provider: "anthropic",
    model: "claude-opus-4-5",
    apiKey: "",
    baseUrl: "",
    maxTokens: 8192,
    temperature: 0.7,
  },
  harness: {
    allowReadFiles: true,
    allowWriteFiles: true,
    allowRunCommands: true,
    allowNetworkRequests: false,
    confirmBeforeWrite: true,
    confirmBeforeRun: true,
  },
  autoRefreshDiff: true,
  diffRefreshIntervalSec: 5,
  theme: "dark",
};

interface SettingsStore {
  settings: Settings;
  settingsOpen: boolean;
  activeTab: "runner" | "model" | "harness";

  openSettings: (tab?: SettingsStore["activeTab"]) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsStore["activeTab"]) => void;
  patchRunner: (patch: Partial<RunnerConfig>) => void;
  patchModel: (patch: Partial<ModelConfig>) => void;
  patchHarness: (patch: Partial<HarnessPermissions>) => void;
  patchSettings: (patch: Partial<Omit<Settings, "runner" | "model" | "harness">>) => void;
  saveApiKey: (key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      settingsOpen: false,
      activeTab: "runner",

      openSettings: (tab = "runner") =>
        set({ settingsOpen: true, activeTab: tab }),
      closeSettings: () => set({ settingsOpen: false }),
      setTab: (tab) => set({ activeTab: tab }),

      patchRunner: (patch) =>
        set((s) => ({
          settings: { ...s.settings, runner: { ...s.settings.runner, ...patch } },
        })),

      patchModel: (patch) =>
        set((s) => ({
          settings: { ...s.settings, model: { ...s.settings.model, ...patch } },
        })),

      patchHarness: (patch) =>
        set((s) => ({
          settings: { ...s.settings, harness: { ...s.settings.harness, ...patch } },
        })),

      patchSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      // 保存 API Key（同时通知 Rust 侧加密存储）
      saveApiKey: async (key: string) => {
        const { invoke } = await import("@tauri-apps/api/core");
        const { settings } = get();
        set((s) => ({
          settings: {
            ...s.settings,
            model: { ...s.settings.model, apiKey: key },
          },
        }));
        await invoke("save_api_key", {
          provider: settings.model.provider,
          key,
        }).catch(console.error);
      },
    }),
    {
      name: "coding-island-settings",
      // API Key 不存 localStorage，只存 Rust keychain
      partialize: (s) => ({
        settings: {
          ...s.settings,
          model: { ...s.settings.model, apiKey: "" }, // 不持久化明文 key
        },
      }),
    }
  )
);

// ── 便捷 Selectors ────────────────────────────────────────────

export const RUNNER_LABELS: Record<RunnerType, string> = {
  "claude-code": "Claude Code",
  "codex":       "OpenAI Codex",
  "custom-cli":  "自定义 CLI",
  "native":      "内置 Harness",
};

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic:          "Anthropic",
  openai:             "OpenAI",
  deepseek:           "DeepSeek",
  "openai-compatible": "OpenAI 兼容接口",
};

export const PROVIDER_MODELS: Record<ModelProvider, string[]> = {
  anthropic:          ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
  openai:             ["o3", "o4-mini", "gpt-4o", "gpt-4.1"],
  deepseek:           ["deepseek-chat", "deepseek-reasoner"],
  "openai-compatible": ["custom"],
};
