import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mirroredPersistStorage } from "./persistStorage";

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
export type LayoutMode = "original" | "split";

export function isGlassTheme(theme: ThemeMode): theme is "glass" {
  return theme === "glass";
}

export function normalizeThemeMode(theme: string | undefined): ThemeMode {
  if (theme === "liquid") return "glass";
  if (theme === "dark" || theme === "glass" || theme === "system") return theme;
  return "light";
}

export function normalizeLayoutMode(layoutMode: string | undefined): LayoutMode {
  return layoutMode === "split" ? "split" : "original";
}

export function normalizeSplitPaneSidebarWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return 420;
  return Math.min(560, Math.max(280, Math.round(width)));
}

export function normalizeSplitWidgetPanelWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return 260;
  return Math.min(420, Math.max(220, Math.round(width)));
}

export interface SplitWidgetCanvasItem {
  id: string;
  type: "terminal";
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface SplitWidgetCanvas {
  items: SplitWidgetCanvasItem[];
}

function normalizeSplitWidgetCanvasItem(item: unknown): SplitWidgetCanvasItem | null {
  if (!item || typeof item !== "object") return null;
  const candidate = item as Partial<SplitWidgetCanvasItem>;
  if (candidate.type !== "terminal") return null;
  if (!candidate.id || typeof candidate.id !== "string") return null;
  return {
    id: candidate.id,
    type: "terminal",
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? Math.round(candidate.x) : 16,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? Math.round(candidate.y) : 16,
    width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? Math.max(180, Math.round(candidate.width)) : 220,
    height: typeof candidate.height === "number" && Number.isFinite(candidate.height) ? Math.max(140, Math.round(candidate.height)) : 160,
    visible: candidate.visible !== false,
  };
}

export function normalizeSplitWidgetCanvas(canvas: unknown): SplitWidgetCanvas {
  const candidate = (canvas && typeof canvas === "object") ? canvas as Partial<SplitWidgetCanvas> : {};
  const items = Array.isArray(candidate.items)
    ? candidate.items.map(normalizeSplitWidgetCanvasItem).filter((item): item is SplitWidgetCanvasItem => item !== null)
    : [];
  return {
    items: items.length > 0
      ? items
      : [{ id: "terminal-widget-1", type: "terminal", x: 16, y: 16, width: 220, height: 160, visible: true }],
  };
}

export interface Settings {
  runner: RunnerConfig;
  runnerProfiles: RunnerProfiles;
  apiKeys: ApiKeys;
  autoRefreshDiff: boolean;
  diffRefreshIntervalSec: number;
  theme: ThemeMode;
  layoutMode: LayoutMode;
  splitPaneSidebarWidth: number;
  splitWidgetPanelWidth: number;
  splitWidgetPanelCollapsed: boolean;
  splitWidgetCanvas: SplitWidgetCanvas;
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
  autoRefreshDiff: true,
  diffRefreshIntervalSec: 5,
  theme: "light",
  layoutMode: "original",
  splitPaneSidebarWidth: 420,
  splitWidgetPanelWidth: 260,
  splitWidgetPanelCollapsed: true,
  splitWidgetCanvas: {
    items: [{ id: "terminal-widget-1", type: "terminal", x: 16, y: 16, width: 220, height: 160, visible: true }],
  },
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
      storage: createJSONStorage(() => mirroredPersistStorage),
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
        const persistedSettings = (p.settings ?? {}) as Partial<Settings> & {
          theme?: string;
          layoutMode?: string;
          splitPaneSidebarWidth?: unknown;
          splitWidgetPanelWidth?: unknown;
          splitWidgetPanelCollapsed?: unknown;
          splitWidgetCanvas?: unknown;
        };
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
            layoutMode: normalizeLayoutMode(persistedSettings.layoutMode),
            splitPaneSidebarWidth: normalizeSplitPaneSidebarWidth(persistedSettings.splitPaneSidebarWidth),
            splitWidgetPanelWidth: normalizeSplitWidgetPanelWidth(persistedSettings.splitWidgetPanelWidth),
            splitWidgetPanelCollapsed: persistedSettings.splitWidgetPanelCollapsed === true,
            splitWidgetCanvas: normalizeSplitWidgetCanvas(persistedSettings.splitWidgetCanvas),
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
