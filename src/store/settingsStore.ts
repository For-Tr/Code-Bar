import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RunnerType =
  | "claude-code"
  | "codex";

export interface RunnerConfig {
  type: RunnerType;
  cliPath?: string;
  cliArgs?: string;
  apiBaseUrl?: string;
  apiKeyOverride?: string;
}

export type RunnerProfile = Omit<RunnerConfig, "type">;
export type RunnerProfiles = Record<RunnerType, RunnerProfile>;

export type ApiKeyProvider = "anthropic" | "openai";

export interface ApiKeys {
  anthropic: string;
  openai: string;
}

export type ThemeMode = "light" | "dark" | "glass" | "system";

export function isGlassTheme(theme: ThemeMode): theme is "glass" {
  return theme === "glass";
}

export function normalizeThemeMode(theme: string | undefined): ThemeMode {
  if (theme === "liquid") return "glass";
  if (theme === "dark" || theme === "glass" || theme === "system") return theme;
  return "light";
}

export interface Settings {
  runner: RunnerConfig;
  runnerProfiles: RunnerProfiles;
  apiKeys: ApiKeys;
  theme: ThemeMode;
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
};

export function sanitizeRunnerConfig(runner: RunnerConfig): RunnerConfig {
  return { ...runner };
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
  apiKeys: {
    anthropic: "",
    openai: "",
  },
  theme: "light",
};

interface SettingsStore {
  settings: Settings;
  settingsOpen: boolean;
  activeTab: "system" | "appearance";

  openSettings: (tab?: SettingsStore["activeTab"]) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsStore["activeTab"]) => void;
  patchRunner: (patch: Partial<RunnerConfig>) => void;
  patchSettings: (patch: Partial<Omit<Settings, "runner" | "runnerProfiles" | "apiKeys">>) => void;
  saveProviderApiKey: (provider: ApiKeyProvider, key: string) => Promise<void>;
  getRunnerConfigForType: (type: RunnerType) => RunnerConfig;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      settingsOpen: false,
      activeTab: "system",

      openSettings: (tab = "system") =>
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
          return {
            settings: {
              ...s.settings,
              runner: nextRunner,
              runnerProfiles: {
                ...s.settings.runnerProfiles,
                [nextType]: extractRunnerProfile(nextRunner),
              },
            },
          };
        }),

      patchSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      saveProviderApiKey: async (provider, key) => {
        const { invoke } = await import("@tauri-apps/api/core");
        set((s) => ({
          settings: {
            ...s.settings,
            apiKeys: { ...s.settings.apiKeys, [provider]: key },
          },
        }));
        await invoke("save_api_key", { provider, key }).catch(console.error);
      },

      getRunnerConfigForType: (type) => {
        const { settings } = get();
        return resolveRunnerConfig(type, settings.runnerProfiles, settings.runner);
      },
    }),
    {
      name: "code-bar-settings",
      partialize: (s) => ({
        settings: {
          ...s.settings,
          apiKeys: {
            anthropic: "",
            openai: "",
          },
        },
      }),
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<typeof current>;
        const persistedSettings = (p.settings ?? {}) as Partial<Settings> & { theme?: string };
        const runnerProfiles: RunnerProfiles = {
          "claude-code": normalizeRunnerProfile(persistedSettings.runnerProfiles?.["claude-code"]),
          "codex": normalizeRunnerProfile(persistedSettings.runnerProfiles?.codex),
        };
        return {
          ...current,
          ...p,
          settings: {
            ...DEFAULT_SETTINGS,
            ...persistedSettings,
            theme: normalizeThemeMode(persistedSettings.theme),
            runnerProfiles,
            runner: resolveRunnerConfig(
              persistedSettings.runner?.type ?? DEFAULT_SETTINGS.runner.type,
              runnerProfiles,
              persistedSettings.runner
            ),
            apiKeys: {
              ...DEFAULT_SETTINGS.apiKeys,
              ...(persistedSettings.apiKeys ?? {}),
            },
          },
        };
      },
    }
  )
);

export const RUNNER_LABELS: Record<RunnerType, string> = {
  "claude-code": "Claude Code",
  "codex": "OpenAI Codex",
};

export const RUNNER_PROVIDER: Record<RunnerType, ApiKeyProvider> = {
  "claude-code": "anthropic",
  "codex": "openai",
};
