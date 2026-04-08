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
  // 三方 API 端点（透传给 CLI 对应的 *_BASE_URL 环境变量）
  // claude-code → ANTHROPIC_BASE_URL，codex → OPENAI_BASE_URL
  apiBaseUrl?: string;
  // 三方 API Key 覆盖（留空则从 apiKeys 读取对应服务商的 key）
  // 适合使用 OpenRouter / AWS Bedrock / 其他代理时填写专属 key
  apiKeyOverride?: string;
}

export type RunnerProfile = Omit<RunnerConfig, "type">;
export type RunnerProfiles = Record<RunnerType, RunnerProfile>;

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

// ── 多 Provider API Keys（统一管理）─────────────────────────
// 每个服务商独立存储，不跟随 model 切换而丢失

export interface ApiKeys {
  anthropic: string;
  openai: string;
  deepseek: string;
  "openai-compatible": string;
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
  runnerProfiles: RunnerProfiles;
  model: ModelConfig;
  apiKeys: ApiKeys;
  harness: HarnessPermissions;
  // 通用
  autoRefreshDiff: boolean;
  diffRefreshIntervalSec: number;
  theme: "light" | "dark" | "system";
}

const DEFAULT_RUNNER_PROFILE: RunnerProfile = {
  cliPath: "",
  cliArgs: "",
  apiBaseUrl: "",
  apiKeyOverride: "",
};

const DEFAULT_RUNNER_PROFILES: RunnerProfiles = {
  "claude-code": { ...DEFAULT_RUNNER_PROFILE },
  "codex": { ...DEFAULT_RUNNER_PROFILE },
  "custom-cli": { ...DEFAULT_RUNNER_PROFILE },
  "native": { ...DEFAULT_RUNNER_PROFILE },
};

function cliPathBasename(cliPath?: string): string {
  return (cliPath ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function sanitizeRunnerCliPath(type: RunnerType, cliPath?: string): string {
  const normalizedPath = cliPath ?? "";
  const base = cliPathBasename(normalizedPath);
  if (!base) return normalizedPath;

  if (type === "codex" && base.includes("claude")) return "";
  if (type === "claude-code" && base.includes("codex")) return "";
  return normalizedPath;
}

export function sanitizeRunnerConfig(runner: RunnerConfig): RunnerConfig {
  return {
    ...runner,
    cliPath: sanitizeRunnerCliPath(runner.type, runner.cliPath),
  };
}

function normalizeRunnerProfile(profile?: Partial<RunnerProfile>): RunnerProfile {
  return {
    ...DEFAULT_RUNNER_PROFILE,
    ...(profile ?? {}),
  };
}

function extractRunnerProfile(runner: RunnerConfig): RunnerProfile {
  return {
    cliPath: runner.cliPath ?? "",
    cliArgs: runner.cliArgs ?? "",
    apiBaseUrl: runner.apiBaseUrl ?? "",
    apiKeyOverride: runner.apiKeyOverride ?? "",
  };
}

function mergeRunnerProfiles(
  persistedProfiles?: Partial<RunnerProfiles>,
  legacyRunner?: Partial<RunnerConfig>
): RunnerProfiles {
  const profiles: RunnerProfiles = {
    "claude-code": normalizeRunnerProfile(persistedProfiles?.["claude-code"]),
    "codex": normalizeRunnerProfile(persistedProfiles?.codex),
    "custom-cli": normalizeRunnerProfile(persistedProfiles?.["custom-cli"]),
    "native": normalizeRunnerProfile(persistedProfiles?.native),
  };

  if (legacyRunner?.type) {
    profiles[legacyRunner.type] = {
      ...profiles[legacyRunner.type],
      ...extractRunnerProfile({ type: legacyRunner.type, ...profiles[legacyRunner.type], ...legacyRunner }),
    };
  }

  return profiles;
}

function resolveRunnerConfig(
  type: RunnerType,
  profiles: RunnerProfiles,
  currentRunner?: Partial<RunnerConfig>
): RunnerConfig {
  const profile = normalizeRunnerProfile(profiles[type]);
  return sanitizeRunnerConfig({
    type,
    ...profile,
    ...(currentRunner?.type === type ? extractRunnerProfile({ type, ...profile, ...currentRunner }) : {}),
  });
}

const DEFAULT_SETTINGS: Settings = {
  runner: resolveRunnerConfig("claude-code", DEFAULT_RUNNER_PROFILES),
  runnerProfiles: DEFAULT_RUNNER_PROFILES,
  model: {
    provider: "openai-compatible",
    model: "glm-4-flash",
    apiKey: "",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    maxTokens: 8192,
    temperature: 0.7,
  },
  apiKeys: {
    anthropic: "",
    openai: "",
    deepseek: "",
    "openai-compatible": "",
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
  theme: "light",
};

interface SettingsStore {
  settings: Settings;
  settingsOpen: boolean;
  activeTab: "runner" | "model" | "harness" | "apikeys" | "appearance";

  openSettings: (tab?: SettingsStore["activeTab"]) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsStore["activeTab"]) => void;
  patchRunner: (patch: Partial<RunnerConfig>) => void;
  patchModel: (patch: Partial<ModelConfig>) => void;
  patchHarness: (patch: Partial<HarnessPermissions>) => void;
  patchSettings: (patch: Partial<Omit<Settings, "runner" | "runnerProfiles" | "model" | "harness" | "apiKeys">>) => void;
  // 单个 provider 存 key（同时写 Rust keychain）
  saveProviderApiKey: (provider: ModelProvider, key: string) => Promise<void>;
  // 获取当前激活 provider 的 key（供 harness 使用）
  getActiveApiKey: () => string;
  getRunnerConfigForType: (type: RunnerType) => RunnerConfig;
  // 兼容旧接口
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
        set((s) => {
          const currentRunner = s.settings.runner;
          const nextType = patch.type ?? currentRunner.type;
          const baseRunner = nextType === currentRunner.type
            ? currentRunner
            : resolveRunnerConfig(nextType, s.settings.runnerProfiles);
          const nextRunner = sanitizeRunnerConfig({
            ...baseRunner,
            ...patch,
            type: nextType,
          });
          const nextProfiles: RunnerProfiles = {
            ...s.settings.runnerProfiles,
            [nextType]: extractRunnerProfile(nextRunner),
          };
          return {
            settings: {
              ...s.settings,
              runner: nextRunner,
              runnerProfiles: nextProfiles,
            },
          };
        }),

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

      saveProviderApiKey: async (provider: ModelProvider, key: string) => {
        const { invoke } = await import("@tauri-apps/api/core");
        set((s) => ({
          settings: {
            ...s.settings,
            apiKeys: { ...s.settings.apiKeys, [provider]: key },
            // 如果当前激活的 provider 就是这个，同步到 model.apiKey
            model: s.settings.model.provider === provider
              ? { ...s.settings.model, apiKey: key }
              : s.settings.model,
          },
        }));
        await invoke("save_api_key", { provider, key }).catch(console.error);
      },

      getActiveApiKey: () => {
        const { settings } = get();
        return settings.apiKeys[settings.model.provider] || settings.model.apiKey || "";
      },

      getRunnerConfigForType: (type) => {
        const { settings } = get();
        return resolveRunnerConfig(type, settings.runnerProfiles, settings.runner);
      },

      saveApiKey: async (key: string) => {
        const { settings } = get();
        await get().saveProviderApiKey(settings.model.provider, key);
      },
    }),
    {
      name: "code-bar-settings",
      // API Key 不存 localStorage，只存 Rust keychain
      partialize: (s) => ({
        settings: {
          ...s.settings,
          model: { ...s.settings.model, apiKey: "" },
          apiKeys: {
            anthropic: "",
            openai: "",
            deepseek: "",
            "openai-compatible": "",
          },
        },
      }),
      // 深度合并：旧版持久化数据缺失字段时，用 DEFAULT_SETTINGS 补全
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<typeof current>;
        const runnerProfiles = mergeRunnerProfiles(
          p.settings?.runnerProfiles,
          p.settings?.runner
        );
        return {
          ...current,
          ...p,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(p.settings ?? {}),
            runnerProfiles,
            runner: resolveRunnerConfig(
              p.settings?.runner?.type ?? DEFAULT_SETTINGS.runner.type,
              runnerProfiles,
              p.settings?.runner
            ),
            model: { ...DEFAULT_SETTINGS.model, ...(p.settings?.model ?? {}), apiKey: "" },
            apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(p.settings?.apiKeys ?? {}) },
            harness: { ...DEFAULT_SETTINGS.harness, ...(p.settings?.harness ?? {}) },
          },
        };
      },
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
  "openai-compatible": ["glm-4-flash"],
};

// ── Runner → 所需 Provider 的映射（用于 CLI 模式时的 API Key 提示）──
export const RUNNER_PROVIDER: Partial<Record<RunnerType, ModelProvider>> = {
  "claude-code": "anthropic",
  "codex":       "openai",
};
