import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setLiquidGlassEffect, GlassMaterialVariant } from "tauri-plugin-liquid-glass-api";
import { motion, AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { WorkspaceStack } from "./components/WorkspaceStack";
import { SessionList } from "./components/SessionList";
import { DiffViewer } from "./components/DiffViewer";
import { StatusBar } from "./components/StatusBar";
import { SessionDetail } from "./components/SessionDetail";
import { SplitWidgetPanel } from "./components/SplitWidgetPanel";
import Settings from "./components/Settings";
import { useSessionStore, DiffFile, type ClaudeSession } from "./store/sessionStore";
import {
  useSettingsStore,
  isGlassTheme,
  type ThemeMode,
} from "./store/settingsStore";
import { useWorkspaceStore } from "./store/workspaceStore";

const spring = { type: "spring" as const, stiffness: 320, damping: 28, mass: 1 };

export default function App() {
  const {
    sessions,
    activeSessionId,
    expandedSessionId,
    appendOutput,
    updateSession,
    setDiffFiles,
    setActiveSession,
    setExpandedSession,
  } = useSessionStore();

  const { settings, patchSettings } = useSettingsStore();
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const { activeWorkspaceId } = useWorkspaceStore();
  const isGlass = isGlassTheme(settings.theme);
  const isOriginalLayout = settings.layoutMode === "original";
  const overlaySessionOpen = isOriginalLayout && expandedSessionId !== null;
  const isSubPageOpen = settingsOpen || overlaySessionOpen;

  // ── 主题注入：根据 settings.theme 向 :root 写入 CSS 变量 ──────
  useEffect(() => {
    const applyTheme = (mode: Exclude<ThemeMode, "system">) => {
      const root = document.documentElement;
      if (mode === "dark") {
        // Dark mode tokens
        root.style.setProperty("--ci-bg",          "rgba(28,28,30,0.96)");
        root.style.setProperty("--ci-bg-grad",      "rgba(28,28,30,0.96)");
        root.style.setProperty("--ci-surface",      "rgba(44,44,46,0.80)");
        root.style.setProperty("--ci-surface-hi",   "rgba(58,58,60,0.95)");
        root.style.setProperty("--ci-border",       "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-border-med",   "rgba(255,255,255,0.16)");
        root.style.setProperty("--ci-border-hi",    "rgba(10,132,255,0.50)");
        root.style.setProperty("--ci-text",         "#f2f2f7");
        root.style.setProperty("--ci-text-muted",   "rgba(235,235,245,0.60)");
        root.style.setProperty("--ci-text-dim",     "rgba(235,235,245,0.35)");
        root.style.setProperty("--ci-accent",       "#0A84FF");
        root.style.setProperty("--ci-accent-bg",    "rgba(10,132,255,0.15)");
        root.style.setProperty("--ci-accent-bdr",   "rgba(10,132,255,0.30)");
        root.style.setProperty("--ci-green",        "#30D158");
        root.style.setProperty("--ci-green-dark",   "#4cd964");
        root.style.setProperty("--ci-green-bg",     "rgba(48,209,88,0.15)");
        root.style.setProperty("--ci-green-bdr",    "rgba(48,209,88,0.28)");
        root.style.setProperty("--ci-red",          "#FF453A");
        root.style.setProperty("--ci-yellow",       "#FFD60A");
        root.style.setProperty("--ci-yellow-dark",  "#ffd600");
        root.style.setProperty("--ci-yellow-bg",    "rgba(255,214,10,0.12)");
        root.style.setProperty("--ci-yellow-bdr",   "rgba(255,214,10,0.25)");
        root.style.setProperty("--ci-purple",       "#7D7AFF");
        root.style.setProperty("--ci-purple-bg",    "rgba(125,122,255,0.12)");
        root.style.setProperty("--ci-purple-bdr",   "rgba(125,122,255,0.25)");
        root.style.setProperty("--ci-code-bg",      "rgba(44,44,46,0.90)");
        root.style.setProperty("--ci-added-bg",     "rgba(48,209,88,0.12)");
        root.style.setProperty("--ci-added-text",   "#4cd964");
        root.style.setProperty("--ci-deleted-bg",   "rgba(255,69,58,0.10)");
        root.style.setProperty("--ci-deleted-text", "#ff6b6b");
        root.style.setProperty("--ci-scrollbar",    "rgba(255,255,255,0.15)");
        root.style.setProperty("--ci-btn-ghost-bg",  "rgba(255,255,255,0.07)");
        root.style.setProperty("--ci-btn-ghost-hover","rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-close-bg",      "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-close-border",  "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-window-bg",      "rgb(28,28,30)");
        root.style.setProperty("--ci-window-edge",    "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-window-shadow",  "0 18px 44px rgba(0,0,0,0.34)");
        root.style.setProperty("--ci-panel-grad",     "var(--ci-surface)");
        root.style.setProperty("--ci-card-grad",      "var(--ci-surface-hi)");
        root.style.setProperty("--ci-toolbar-bg",     "rgba(255,255,255,0.03)");
        root.style.setProperty("--ci-toolbar-border", "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-status-bg",      "rgba(255,255,255,0.02)");
        root.style.setProperty("--ci-overlay-bg",     "rgba(18,18,22,0.92)");
        root.style.setProperty("--ci-glow-a",         "transparent");
        root.style.setProperty("--ci-glow-b",         "transparent");
        root.style.setProperty("--ci-inset-highlight","none");
        root.style.setProperty("--ci-shell-blur",     "blur(22px) saturate(1.1)");
        root.style.setProperty("--ci-shell-radius",   "24px");
        root.style.setProperty("--ci-card-shadow",    "0 8px 24px rgba(0,0,0,0.18)");
        root.style.setProperty("--ci-card-shadow-strong","0 12px 28px rgba(0,0,0,0.22)");
        root.style.setProperty("--ci-pill-bg",        "rgba(255,255,255,0.07)");
        root.style.setProperty("--ci-pill-border",    "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-primary-shadow", "0 10px 24px rgba(10,132,255,0.18)");
        root.style.setProperty("--ci-glass-text-shadow", "none");
        root.style.setProperty("--ci-glass-text-shadow-strong", "none");
        // PTY 面板专用（深色模式保持深色终端风格）
        root.style.setProperty("--ci-pty-panel-bg",    "rgba(10,10,14,0.97)");
        root.style.setProperty("--ci-pty-panel-border","rgba(255,255,255,0.09)");
        root.style.setProperty("--ci-pty-titlebar-bg", "rgba(255,255,255,0.03)");
        root.style.setProperty("--ci-pty-titlebar-bdr","rgba(255,255,255,0.06)");
        root.style.setProperty("--ci-pty-title-color", "rgba(255,255,255,0.75)");
        root.style.setProperty("--ci-pty-mask-bg",     "rgba(12,12,16,0.96)");
        root.style.setProperty("--ci-pty-mask-title",  "rgba(240,240,248,0.88)");
        root.style.setProperty("--ci-pty-mask-hint",   "rgba(200,200,210,0.4)");
        root.style.setProperty("--ci-pty-mask-footer", "rgba(180,180,195,0.3)");
        root.style.setProperty("--ci-pty-input-bg",    "rgba(255,255,255,0.06)");
        root.style.setProperty("--ci-pty-input-border","rgba(255,255,255,0.13)");
        root.style.setProperty("--ci-pty-input-text",  "rgba(235,235,242,0.88)");
        root.style.setProperty("--ci-pty-btn-bg",      "rgba(255,255,255,0.07)");
        root.style.setProperty("--ci-pty-btn-border",  "rgba(255,255,255,0.12)");
        root.style.setProperty("--ci-pty-btn-text",    "rgba(255,255,255,0.42)");
        root.style.setProperty("--ci-pty-btn-hover-bg", "rgba(255,255,255,0.13)");
        root.style.setProperty("--ci-pty-btn-hover-text","rgba(255,255,255,0.85)");
        root.style.setProperty("--ci-pty-runner-bg",       "rgba(0,122,255,0.14)");
        root.style.setProperty("--ci-pty-runner-bg-hover",  "rgba(0,122,255,0.24)");
        root.style.setProperty("--ci-pty-runner-border",    "rgba(0,122,255,0.28)");
        root.style.setProperty("--ci-pty-runner-text",      "#60a5fa");
        root.style.setProperty("--ci-pty-term-bg",          "#0a0a0c");
        root.setAttribute("data-theme", "dark");
      } else if (isGlassTheme(mode)) {
        root.style.setProperty("--ci-bg", "transparent");
        root.style.setProperty("--ci-bg-grad", "rgba(255,255,255,0.02)");
        root.style.setProperty("--ci-surface", "rgba(255,255,255,0.06)");
        root.style.setProperty("--ci-surface-hi", "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-border", "rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-border-med", "rgba(255,255,255,0.20)");
        root.style.setProperty("--ci-border-hi", "rgba(134,194,255,0.26)");
        root.style.setProperty("--ci-text", "#10263d");
        root.style.setProperty("--ci-text-muted", "rgba(27,52,82,0.76)");
        root.style.setProperty("--ci-text-dim", "rgba(27,52,82,0.54)");
        root.style.setProperty("--ci-accent", "#2d8cff");
        root.style.setProperty("--ci-accent-bg", "rgba(63,145,255,0.10)");
        root.style.setProperty("--ci-accent-bdr", "rgba(96,175,255,0.20)");
        root.style.setProperty("--ci-green", "#34C759");
        root.style.setProperty("--ci-green-dark", "#19793a");
        root.style.setProperty("--ci-green-bg", "rgba(52,199,89,0.10)");
        root.style.setProperty("--ci-green-bdr", "rgba(52,199,89,0.18)");
        root.style.setProperty("--ci-red", "#FF3B30");
        root.style.setProperty("--ci-yellow", "#FF9F0A");
        root.style.setProperty("--ci-yellow-dark", "#a96500");
        root.style.setProperty("--ci-yellow-bg", "rgba(255,159,10,0.10)");
        root.style.setProperty("--ci-yellow-bdr", "rgba(255,159,10,0.18)");
        root.style.setProperty("--ci-purple", "#5856d6");
        root.style.setProperty("--ci-purple-bg", "rgba(88,86,214,0.10)");
        root.style.setProperty("--ci-purple-bdr", "rgba(88,86,214,0.16)");
        root.style.setProperty("--ci-code-bg", "rgba(250,252,255,0.14)");
        root.style.setProperty("--ci-added-bg", "rgba(52,199,89,0.08)");
        root.style.setProperty("--ci-added-text", "#1a7f37");
        root.style.setProperty("--ci-deleted-bg", "rgba(255,59,48,0.08)");
        root.style.setProperty("--ci-deleted-text", "#c0392b");
        root.style.setProperty("--ci-scrollbar", "rgba(29,53,87,0.08)");
        root.style.setProperty("--ci-btn-ghost-bg", "rgba(255,255,255,0.05)");
        root.style.setProperty("--ci-btn-ghost-hover", "rgba(255,255,255,0.09)");
        root.style.setProperty("--ci-close-bg", "rgba(255,255,255,0.07)");
        root.style.setProperty("--ci-close-border", "rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-window-bg", "transparent");
        root.style.setProperty("--ci-window-edge", "rgba(255,255,255,0.16)");
        root.style.setProperty("--ci-window-shadow", "0 12px 34px rgba(89,110,140,0.08)");
        root.style.setProperty("--ci-panel-grad", "rgba(255,255,255,0.05)");
        root.style.setProperty("--ci-card-grad", "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-toolbar-bg", "rgba(255,255,255,0.04)");
        root.style.setProperty("--ci-toolbar-border", "rgba(255,255,255,0.12)");
        root.style.setProperty("--ci-status-bg", "rgba(255,255,255,0.03)");
        root.style.setProperty("--ci-overlay-bg", "rgba(244,246,250,0.24)");
        root.style.setProperty("--ci-glow-a", "transparent");
        root.style.setProperty("--ci-glow-b", "transparent");
        root.style.setProperty("--ci-inset-highlight", "inset 0 0 0 0.5px rgba(255,255,255,0.18)");
        root.style.setProperty("--ci-shell-blur", "none");
        root.style.setProperty("--ci-shell-radius", "24px");
        root.style.setProperty("--ci-card-shadow", "0 10px 24px rgba(92,114,144,0.08)");
        root.style.setProperty("--ci-card-shadow-strong", "0 14px 28px rgba(92,114,144,0.10)");
        root.style.setProperty("--ci-pill-bg", "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-pill-border", "rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-primary-shadow", "0 8px 18px rgba(81,149,234,0.10)");
        root.style.setProperty("--ci-glass-text-shadow", "none");
        root.style.setProperty("--ci-glass-text-shadow-strong", "none");
        root.style.setProperty("--ci-pty-panel-bg", "rgba(242,242,247,0.74)");
        root.style.setProperty("--ci-pty-panel-border", "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-pty-titlebar-bg", "rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-pty-titlebar-bdr", "rgba(0,0,0,0.06)");
        root.style.setProperty("--ci-pty-title-color", "rgba(28,28,30,0.85)");
        root.style.setProperty("--ci-pty-mask-bg", "rgba(246,246,248,0.80)");
        root.style.setProperty("--ci-pty-mask-title", "#1c1c1e");
        root.style.setProperty("--ci-pty-mask-hint", "rgba(60,60,67,0.45)");
        root.style.setProperty("--ci-pty-mask-footer", "rgba(60,60,67,0.28)");
        root.style.setProperty("--ci-pty-input-bg", "rgba(255,255,255,0.30)");
        root.style.setProperty("--ci-pty-input-border", "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-pty-input-text", "#1c1c1e");
        root.style.setProperty("--ci-pty-btn-bg", "rgba(255,255,255,0.14)");
        root.style.setProperty("--ci-pty-btn-border", "rgba(0,0,0,0.09)");
        root.style.setProperty("--ci-pty-btn-text", "rgba(60,60,67,0.55)");
        root.style.setProperty("--ci-pty-btn-hover-bg", "rgba(255,255,255,0.20)");
        root.style.setProperty("--ci-pty-btn-hover-text", "rgba(28,28,30,0.9)");
        root.style.setProperty("--ci-pty-runner-bg", "rgba(64,156,255,0.08)");
        root.style.setProperty("--ci-pty-runner-bg-hover", "rgba(64,156,255,0.15)");
        root.style.setProperty("--ci-pty-runner-border", "rgba(64,156,255,0.20)");
        root.style.setProperty("--ci-pty-runner-text", "#2d8cff");
        root.style.setProperty("--ci-pty-term-bg", "#0a0a0c");
        root.setAttribute("data-theme", mode);
      } else {
        // Light mode tokens
        root.style.setProperty("--ci-bg",          "rgba(246,246,248,0.92)");
        root.style.setProperty("--ci-bg-grad",      "rgba(246,246,248,0.92)");
        root.style.setProperty("--ci-surface",      "rgba(255,255,255,0.70)");
        root.style.setProperty("--ci-surface-hi",   "rgba(255,255,255,0.95)");
        root.style.setProperty("--ci-border",       "rgba(0,0,0,0.07)");
        root.style.setProperty("--ci-border-med",   "rgba(0,0,0,0.10)");
        root.style.setProperty("--ci-border-hi",    "rgba(0,122,255,0.45)");
        root.style.setProperty("--ci-text",         "#1c1c1e");
        root.style.setProperty("--ci-text-muted",   "rgba(60,60,67,0.60)");
        root.style.setProperty("--ci-text-dim",     "rgba(60,60,67,0.36)");
        root.style.setProperty("--ci-accent",       "#007AFF");
        root.style.setProperty("--ci-accent-bg",    "rgba(0,122,255,0.08)");
        root.style.setProperty("--ci-accent-bdr",   "rgba(0,122,255,0.20)");
        root.style.setProperty("--ci-green",        "#34C759");
        root.style.setProperty("--ci-green-dark",   "#1a7f37");
        root.style.setProperty("--ci-green-bg",     "rgba(52,199,89,0.10)");
        root.style.setProperty("--ci-green-bdr",    "rgba(52,199,89,0.22)");
        root.style.setProperty("--ci-red",          "#FF3B30");
        root.style.setProperty("--ci-yellow",       "#FF9F0A");
        root.style.setProperty("--ci-yellow-dark",  "#b36a00");
        root.style.setProperty("--ci-yellow-bg",    "rgba(255,159,10,0.08)");
        root.style.setProperty("--ci-yellow-bdr",   "rgba(255,159,10,0.22)");
        root.style.setProperty("--ci-purple",       "#5856d6");
        root.style.setProperty("--ci-purple-bg",    "rgba(88,86,214,0.08)");
        root.style.setProperty("--ci-purple-bdr",   "rgba(88,86,214,0.20)");
        root.style.setProperty("--ci-code-bg",      "rgba(242,242,247,0.90)");
        root.style.setProperty("--ci-added-bg",     "rgba(52,199,89,0.10)");
        root.style.setProperty("--ci-added-text",   "#1a7f37");
        root.style.setProperty("--ci-deleted-bg",   "rgba(255,59,48,0.08)");
        root.style.setProperty("--ci-deleted-text", "#c0392b");
        root.style.setProperty("--ci-scrollbar",    "rgba(0,0,0,0.12)");
        root.style.setProperty("--ci-btn-ghost-bg",  "rgba(0,0,0,0.04)");
        root.style.setProperty("--ci-btn-ghost-hover","rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-close-bg",      "rgba(0,0,0,0.05)");
        root.style.setProperty("--ci-close-border",  "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-window-bg",      "rgb(246,246,248)");
        root.style.setProperty("--ci-window-edge",    "rgba(0,0,0,0.06)");
        root.style.setProperty("--ci-window-shadow",  "0 18px 40px rgba(0,0,0,0.14)");
        root.style.setProperty("--ci-panel-grad",     "var(--ci-surface)");
        root.style.setProperty("--ci-card-grad",      "var(--ci-surface-hi)");
        root.style.setProperty("--ci-toolbar-bg",     "rgba(255,255,255,0.45)");
        root.style.setProperty("--ci-toolbar-border", "rgba(0,0,0,0.06)");
        root.style.setProperty("--ci-status-bg",      "rgba(255,255,255,0.56)");
        root.style.setProperty("--ci-overlay-bg",     "rgba(246,246,248,0.94)");
        root.style.setProperty("--ci-glow-a",         "transparent");
        root.style.setProperty("--ci-glow-b",         "transparent");
        root.style.setProperty("--ci-inset-highlight","none");
        root.style.setProperty("--ci-shell-blur",     "blur(18px) saturate(1.08)");
        root.style.setProperty("--ci-shell-radius",   "24px");
        root.style.setProperty("--ci-card-shadow",    "0 8px 24px rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-card-shadow-strong","0 12px 28px rgba(0,0,0,0.12)");
        root.style.setProperty("--ci-pill-bg",        "rgba(255,255,255,0.58)");
        root.style.setProperty("--ci-pill-border",    "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-primary-shadow", "0 10px 24px rgba(0,122,255,0.14)");
        root.style.setProperty("--ci-glass-text-shadow", "none");
        root.style.setProperty("--ci-glass-text-shadow-strong", "none");
        // PTY 面板专用（浅色模式：外壳用毛玻璃浅色，终端本体仍保持深色）
        root.style.setProperty("--ci-pty-panel-bg",    "rgba(242,242,247,0.97)");
        root.style.setProperty("--ci-pty-panel-border","rgba(0,0,0,0.09)");
        root.style.setProperty("--ci-pty-titlebar-bg", "rgba(255,255,255,0.60)");
        root.style.setProperty("--ci-pty-titlebar-bdr","rgba(0,0,0,0.07)");
        root.style.setProperty("--ci-pty-title-color", "rgba(28,28,30,0.85)");
        root.style.setProperty("--ci-pty-mask-bg",     "rgba(246,246,248,0.97)");
        root.style.setProperty("--ci-pty-mask-title",  "#1c1c1e");
        root.style.setProperty("--ci-pty-mask-hint",   "rgba(60,60,67,0.45)");
        root.style.setProperty("--ci-pty-mask-footer", "rgba(60,60,67,0.28)");
        root.style.setProperty("--ci-pty-input-bg",    "rgba(255,255,255,0.80)");
        root.style.setProperty("--ci-pty-input-border","rgba(0,0,0,0.10)");
        root.style.setProperty("--ci-pty-input-text",  "#1c1c1e");
        root.style.setProperty("--ci-pty-btn-bg",      "rgba(0,0,0,0.04)");
        root.style.setProperty("--ci-pty-btn-border",  "rgba(0,0,0,0.09)");
        root.style.setProperty("--ci-pty-btn-text",    "rgba(60,60,67,0.55)");
        root.style.setProperty("--ci-pty-btn-hover-bg", "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-pty-btn-hover-text","rgba(28,28,30,0.9)");
        root.style.setProperty("--ci-pty-runner-bg",       "rgba(64,156,255,0.08)");
        root.style.setProperty("--ci-pty-runner-bg-hover",  "rgba(64,156,255,0.15)");
        root.style.setProperty("--ci-pty-runner-border",    "rgba(64,156,255,0.22)");
        root.style.setProperty("--ci-pty-runner-text",      "#2d8cff");
        root.style.setProperty("--ci-pty-term-bg",          "#0a0a0c");
        root.setAttribute("data-theme", "light");
      }
    };

    if (settings.theme === "system") {
      // 跟随系统
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches ? "dark" : "light");
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches ? "dark" : "light");
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    } else {
      applyTheme(settings.theme);
    }
  }, [settings.theme]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    if (settings.theme === "glass") {
      setLiquidGlassEffect({
        cornerRadius: 24,
        variant: GlassMaterialVariant.Clear,
      }).catch(() => {});
      return;
    }

    setLiquidGlassEffect({ enabled: false }).catch(() => {});
  }, [settings.theme]);

  // ── 切换 Workspace 时自动将 activeSession 切换到该 Workspace 的第一个 session ──
  useEffect(() => {
    const currentActive = useSessionStore.getState().activeSessionId;
    const currentSession = useSessionStore.getState().sessions.find((s) => s.id === currentActive);
    // 当前 activeSession 不属于当前 workspace 时，重新选择
    if (currentSession?.workspaceId !== activeWorkspaceId) {
      const wsSessions = useSessionStore.getState().sessions.filter(
        (s) => s.workspaceId === activeWorkspaceId
      );
      setActiveSession(wsSessions[0]?.id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // activeSession 必须属于当前 workspace，防止切换后仍显示旧 workspace 的内容
  const activeSession = sessions.find(
    (s) => s.id === activeSessionId && s.workspaceId === activeWorkspaceId
  );
  const expandedSession = sessions.find((s) => s.id === expandedSessionId) ?? null;
  const visibleSplitSessionId = expandedSession?.workspaceId === activeWorkspaceId
    ? expandedSession.id
    : null;

  const refreshSessionDiff = useCallback((sessionId?: string | null) => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const targetId = sessionId ?? useSessionStore.getState().activeSessionId;
    if (!targetId) return;

    const session = useSessionStore.getState().sessions.find((s) => s.id === targetId);
    if (!session) return;

    if (session.branchName && session.baseBranch) {
      // 有 session 分支：对比 base...session 分支的变更（天然准确）
      invoke("get_git_diff_branch", {
        sessionId: session.id,
        workdir: session.workdir,
        baseBranch: session.baseBranch,
        sessionBranch: session.branchName,
      }).catch(() => {});
    } else {
      // 无分支（非 git 目录或 git 操作失败）：降级为对比 HEAD
      invoke("get_git_diff", {
        sessionId: session.id,
        workdir: session.workdir,
      }).catch(() => {});
    }
  }, []);


  // ── Esc 关闭 ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpen) {
        closeSettings();
        return;
      }
      if (isOriginalLayout && expandedSessionId !== null) return;
      invoke("close_popup").catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settingsOpen, closeSettings, isOriginalLayout, expandedSessionId]);

  // ── 浮窗位置 / 大小记忆：用户拖动/调整后防抖 500ms 写盘 ──
  // 注意：只在基础状态（非展开）下保存，展开状态是临时的，不应覆盖记忆。
  // expandedSessionId 不为 null 表示终端面板已展开。
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressBoundsPersistenceRef = useRef(overlaySessionOpen);
  useEffect(() => {
    suppressBoundsPersistenceRef.current = overlaySessionOpen;
  }, [overlaySessionOpen]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const win = getCurrentWindow();

    // onMoved payload = PhysicalPosition { x, y }（物理像素）
    // onResized payload = PhysicalSize { width, height }（物理像素）
    // 直接从 payload 读取，无需额外异步调用。
    const debouncedSave = (physX: number, physY: number, physW: number, physH: number) => {
      // 仅 overlay 展开状态下跳过，避免把临时放大的尺寸写盘
      if (suppressBoundsPersistenceRef.current) return;
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = setTimeout(async () => {
        try {
          const scaleFactor = await win.scaleFactor();
          await invoke("save_popup_bounds", {
            x: physX / scaleFactor,
            y: physY / scaleFactor,
            width: physW / scaleFactor,
            height: physH / scaleFactor,
          });
        } catch {
          // 静默失败
        }
      }, 500);
    };

    // onMoved：payload 只有位置，宽高需读当前值
    const unlistenMoved = win.onMoved(async ({ payload: pos }) => {
      if (suppressBoundsPersistenceRef.current) return;
      try {
        const size = await win.innerSize();
        debouncedSave(pos.x, pos.y, size.width, size.height);
      } catch { /* 静默 */ }
    });

    // onResized：payload 只有尺寸，位置需读当前值
    const unlistenResized = win.onResized(async ({ payload: size }) => {
      if (suppressBoundsPersistenceRef.current) return;
      try {
        const pos = await win.outerPosition();
        debouncedSave(pos.x, pos.y, size.width, size.height);
      } catch { /* 静默 */ }
    });

    return () => {
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      unlistenMoved.then((f) => f());
      unlistenResized.then((f) => f());
    };
  }, []);

  // ── 弹窗重新显示时（托盘点击），保持当前界面状态（PTY 或菜单）──
  // 不再强制收起 PTY，让用户留在上次的位置

  // ── 通知点击唤起弹窗时，展开最近活跃的 session ──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = listen<{ session_id?: string | null }>("popup-focused", ({ payload }) => {
      const sid = payload?.session_id?.trim();
      const { activeSessionId: aid, sessions: ss } = useSessionStore.getState();
      const target =
        sid && ss.some((s) => s.id === sid)
          ? sid
          : (aid ?? ss[ss.length - 1]?.id ?? null);
      if (target) {
        requestAnimationFrame(() => {
          setExpandedSession(target);
          refreshSessionDiff(target);
        });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [setExpandedSession, refreshSessionDiff]);

  // ── 启动时批量信任所有已有 workspace 目录（写入 claude settings）──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { workspaces } = useWorkspaceStore.getState();
    workspaces.forEach((ws) => {
      invoke("trust_workspace", { path: ws.path }).catch(() => {});
    });
  }, []);

  // ── 启动时加载保存的 API Key ──────────────────────────────
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    (["anthropic", "openai"] as const).forEach((provider) => {
      invoke<string>("load_api_key", { provider })
        .then((key) => {
          if (key) {
            useSettingsStore.setState((s) => ({
              settings: {
                ...s.settings,
                apiKeys: { ...s.settings.apiKeys, [provider]: key },
              },
            }));
          }
        })
        .catch(() => {});
    });
  }, []);

  // ── 启动时补回仍在磁盘上的丢失 session（以 worktree/provider 历史为准）──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    let cancelled = false;

    (async () => {
      const workspaces = useWorkspaceStore.getState().workspaces;
      const knownIds = new Set(useSessionStore.getState().sessions.map((s) => s.id));
      const recovered = await invoke<ClaudeSession[]>("recover_workspace_sessions", {
        workspaces: workspaces.map((workspace) => ({
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        })),
        existingSessionIds: [...knownIds],
      }).catch(() => []);

      if (!cancelled && recovered.length > 0) {
        useSessionStore.getState().mergeRecoveredSessions(recovered);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── 监听 Rust 侧事件 ──────────────────────────────────────
  useEffect(() => {
    // 非 Tauri 环境（纯浏览器 dev）下 listen 会因为缺少 __TAURI_INTERNALS__ 而报错，跳过
    if (!("__TAURI_INTERNALS__" in window)) return;

    // 旧接口：claude-output（claude-code CLI）
    const u1 = listen<{ session_id: string; line: string }>(
      "claude-output",
      ({ payload }) => appendOutput(payload.session_id, payload.line)
    );

    // 新接口：runner-output（统一 Runner）
    const u2 = listen<{ session_id: string; line: string }>(
      "runner-output",
      ({ payload }) => appendOutput(payload.session_id, payload.line)
    );

    // Runner 完成
    const u3 = listen<{ session_id: string; error?: string }>(
      "runner-done",
      ({ payload }) => {
        if (payload.error) {
          updateSession(payload.session_id, { status: "error", currentTask: payload.error });
        } else {
          updateSession(payload.session_id, { status: "done", currentTask: "已完成" });
        }
        refreshSessionDiff(payload.session_id);
      }
    );

    // 旧接口：claude-status
    const u4 = listen<{ session_id: string; status: string; task: string }>(
      "claude-status",
      ({ payload }) => {
        updateSession(payload.session_id, {
          status: payload.status as Parameters<typeof updateSession>[1]["status"],
          currentTask: payload.task,
        });
      }
    );

    // git diff 更新
    const u5 = listen<{ session_id: string; files: DiffFile[] }>(
      "diff-update",
      ({ payload }) => setDiffFiles(payload.session_id, payload.files)
    );

    // PTY 退出：将 running/waiting/suspended 状态的 session 标记为 done
    // SessionPanel 关闭后不再常驻，此处补全全局兜底监听
    const u6 = listen<{ session_id: string }>(
      "pty-exit",
      ({ payload }) => {
        // 延迟 1.2s 与 SessionPanel 内的逻辑保持一致
        setTimeout(() => {
          const s = useSessionStore.getState().sessions.find((x) => x.id === payload.session_id);
          if (s && (s.status === "running" || s.status === "waiting" || s.status === "suspended")) {
            updateSession(payload.session_id, { status: "done" });
          }
        }, 1200);
      }
    );

    // Provider 原生会话绑定（用于下次进入时 resume）
    const u7 = listen<{ session_id: string; runner_type: string; provider_session_id: string }>(
      "provider-session-bound",
      ({ payload }) => {
        if (!payload.session_id || !payload.provider_session_id) return;
        const session = useSessionStore
          .getState()
          .sessions.find((x) => x.id === payload.session_id);
        const existing = session?.providerSessionId?.trim();
        // 避免被“新建但空壳”的 provider 会话覆盖已有可恢复会话 ID
        if (existing && existing !== payload.provider_session_id) {
          return;
        }
        updateSession(payload.session_id, {
          providerSessionId: payload.provider_session_id,
        });
        void invoke("save_recovery_binding", {
          input: {
            sessionId: payload.session_id,
            runnerType: payload.runner_type,
            providerSessionId: payload.provider_session_id,
            worktreePath: session?.worktreePath ?? null,
          },
        }).catch(() => {});
      }
    );

    return () => {
      [u1, u2, u3, u4, u5, u6, u7].forEach((p) => p.then((f) => f()));
    };
  }, [appendOutput, updateSession, setDiffFiles, refreshSessionDiff]);

  // ── 会话切换时主动拉一次 Diff（覆盖非 running / 外部改动场景）──
  useEffect(() => {
    if (!activeSession?.id) return;
    refreshSessionDiff(activeSession.id);
  }, [activeSession?.id, refreshSessionDiff]);

  const hasDiff = (activeSession?.diffFiles.length ?? 0) > 0;
  const splitSidebarWidth = settings.splitPaneSidebarWidth;
  const splitWidgetPanelWidth = settings.splitWidgetPanelWidth;
  const splitWidgetPanelCollapsed = settings.splitWidgetPanelCollapsed;

  const handleSplitPanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = splitSidebarWidth;
    const minWidth = 280;
    const maxWidth = 560;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX)));
      patchSettings({ splitPaneSidebarWidth: nextWidth });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [patchSettings, splitSidebarWidth]);

  const handleWidgetPanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = splitWidgetPanelWidth;
    const minWidth = 220;
    const maxWidth = 720;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth - (moveEvent.clientX - startX))));
      patchSettings({
        splitWidgetPanelWidth: nextWidth,
        splitWidgetPanelCollapsed: false,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [patchSettings, splitWidgetPanelWidth]);

  const menuContent = (
    <>
      <TitleBar />
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
        scrollbarWidth: "none",
        zIndex: 1,
      }}>
        <div style={{ padding: "6px 18px 0" }}>
          <WorkspaceStack />
        </div>

        <div style={{ padding: "0 18px 12px" }}>
          <SessionList />
        </div>

        <AnimatePresence>
          {hasDiff && (
            <motion.div
              key="diff"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                margin: "0 18px 16px",
                overflow: "hidden",
                background: "transparent",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 0 6px",
                borderTop: "1px solid var(--ci-toolbar-border)",
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  color: "var(--ci-text-dim)",
                }}>
                  变更
                </span>
                <span style={{
                  fontSize: 9.5, padding: "1px 6px", borderRadius: 999,
                  background: "var(--ci-green-bg)",
                  border: "1px solid var(--ci-green-bdr)",
                  color: "var(--ci-green-dark)",
                  fontWeight: 600,
                }}>
                  +{activeSession!.diffFiles.reduce((s, f) => s + f.additions, 0)}
                </span>
                <span style={{
                  fontSize: 9.5, padding: "1px 6px", borderRadius: 999,
                  background: "var(--ci-deleted-bg)",
                  border: "1px solid var(--ci-border-med)",
                  color: "var(--ci-deleted-text)",
                  fontWeight: 600,
                }}>
                  −{activeSession!.diffFiles.reduce((s, f) => s + f.deletions, 0)}
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--ci-border)" }} />
              </div>
              <div style={{
                border: "1px solid var(--ci-toolbar-border)",
                borderRadius: 14,
                overflow: "hidden",
                background: "var(--ci-surface)",
              }}>
                <DiffViewer files={activeSession!.diffFiles} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          height: 28,
          background: "linear-gradient(to bottom, transparent, var(--ci-bg-grad))",
          pointerEvents: "none",
          flexShrink: 0,
        }} />
      </div>

      <StatusBar session={activeSession} />
    </>
  );

  return (
    <>
      {isOriginalLayout && <SessionDetail mode="overlay" />}

      <div style={{
        width: "100vw",
        height: "100vh",
        padding: 0,
        boxSizing: "border-box",
        background: "transparent",
      }}>
        <motion.div
          transition={spring}
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            borderRadius: "var(--ci-shell-radius)",
            border: isGlass ? "none" : "1px solid var(--ci-window-edge)",
            background: isGlass ? "transparent" : "var(--ci-window-bg)",
            boxShadow: "var(--ci-window-shadow)",
            clipPath: "inset(0 round var(--ci-shell-radius))",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            isolation: "isolate",
          }}
        >
          <div style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            flexDirection: "column",
          }}>
            <Settings />

            {isOriginalLayout ? (
              !isSubPageOpen && menuContent
            ) : (
              <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                <div style={{
                  width: splitSidebarWidth,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
                }}>
                  {menuContent}
                </div>

                <div
                  onPointerDown={handleSplitPanePointerDown}
                  title="拖拽调整分栏宽度"
                  style={{
                    width: 10,
                    marginLeft: -5,
                    marginRight: -5,
                    cursor: "col-resize",
                    zIndex: 3,
                    touchAction: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: 2,
                    height: "100%",
                    background: "var(--ci-toolbar-border)",
                    borderRadius: 999,
                  }} />
                </div>

                <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", borderLeft: "1px solid var(--ci-toolbar-border)" }}>
                  <SessionDetail
                    mode="embedded"
                    openSessionId={visibleSplitSessionId}
                    emptyState={
                      <div style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                      }}>
                        <div style={{
                          maxWidth: 260,
                          padding: "20px 22px",
                          borderRadius: 18,
                          background: "var(--ci-surface)",
                          border: "1px solid var(--ci-toolbar-border)",
                          color: "var(--ci-text-dim)",
                          fontSize: 12,
                          textAlign: "center",
                          lineHeight: 1.7,
                        }}>
                          {expandedSessionId && !visibleSplitSessionId
                            ? "当前打开的终端不属于这个 workspace。切换回对应 workspace，或重新在左侧展开一个会话。"
                            : "从左侧会话列表中展开一个终端，中间会显示 PTY 详情。"}
                        </div>
                      </div>
                    }
                  />
                </div>

                {!splitWidgetPanelCollapsed && (
                  <div
                    onPointerDown={handleWidgetPanePointerDown}
                    title="拖拽调整组件区宽度"
                    style={{
                      width: 10,
                      marginLeft: -5,
                      marginRight: -5,
                      cursor: "col-resize",
                      zIndex: 3,
                      touchAction: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      width: 2,
                      height: "100%",
                      background: "var(--ci-toolbar-border)",
                      borderRadius: 999,
                    }} />
                  </div>
                )}

                {splitWidgetPanelCollapsed ? (
                  <div style={{
                    width: 36,
                    flexShrink: 0,
                    borderLeft: "1px solid var(--ci-toolbar-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
                  }}>
                    <button
                      onClick={() => patchSettings({ splitWidgetPanelCollapsed: false })}
                      title="展开组件区"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ci-text-muted)",
                        cursor: "pointer",
                        fontSize: 12,
                        writingMode: "vertical-rl",
                        padding: 0,
                      }}
                    >
                      展开
                    </button>
                  </div>
                ) : (
                  <div style={{
                    width: splitWidgetPanelWidth,
                    flexShrink: 0,
                    minHeight: 0,
                    background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
                  }}>
                    <SplitWidgetPanel />
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
