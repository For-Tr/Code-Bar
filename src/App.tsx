import { useEffect, useRef } from "react";
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
import Settings from "./components/Settings";
import { useSessionStore, DiffFile } from "./store/sessionStore";
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
    appendOutput,
    updateSession,
    setDiffFiles,
    setActiveSession,
    setExpandedSession,
  } = useSessionStore();

  const { settings } = useSettingsStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const isGlass = isGlassTheme(settings.theme);

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
        root.style.setProperty("--ci-shell-radius",   "18px");
        root.style.setProperty("--ci-card-shadow",    "0 8px 24px rgba(0,0,0,0.18)");
        root.style.setProperty("--ci-card-shadow-strong","0 12px 28px rgba(0,0,0,0.22)");
        root.style.setProperty("--ci-pill-bg",        "rgba(255,255,255,0.07)");
        root.style.setProperty("--ci-pill-border",    "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-primary-shadow", "0 10px 24px rgba(10,132,255,0.18)");
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
        root.style.setProperty("--ci-surface", "rgba(255,255,255,0.03)");
        root.style.setProperty("--ci-surface-hi", "rgba(255,255,255,0.05)");
        root.style.setProperty("--ci-border", "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-border-med", "rgba(255,255,255,0.12)");
        root.style.setProperty("--ci-border-hi", "rgba(134,194,255,0.22)");
        root.style.setProperty("--ci-text", "#16304e");
        root.style.setProperty("--ci-text-muted", "rgba(39,69,104,0.68)");
        root.style.setProperty("--ci-text-dim", "rgba(39,69,104,0.42)");
        root.style.setProperty("--ci-accent", "#2d8cff");
        root.style.setProperty("--ci-accent-bg", "rgba(63,145,255,0.08)");
        root.style.setProperty("--ci-accent-bdr", "rgba(96,175,255,0.18)");
        root.style.setProperty("--ci-green", "#34C759");
        root.style.setProperty("--ci-green-dark", "#19793a");
        root.style.setProperty("--ci-green-bg", "rgba(52,199,89,0.08)");
        root.style.setProperty("--ci-green-bdr", "rgba(52,199,89,0.16)");
        root.style.setProperty("--ci-red", "#FF3B30");
        root.style.setProperty("--ci-yellow", "#FF9F0A");
        root.style.setProperty("--ci-yellow-dark", "#a96500");
        root.style.setProperty("--ci-yellow-bg", "rgba(255,159,10,0.08)");
        root.style.setProperty("--ci-yellow-bdr", "rgba(255,159,10,0.16)");
        root.style.setProperty("--ci-purple", "#5856d6");
        root.style.setProperty("--ci-purple-bg", "rgba(88,86,214,0.08)");
        root.style.setProperty("--ci-purple-bdr", "rgba(88,86,214,0.14)");
        root.style.setProperty("--ci-code-bg", "rgba(255,255,255,0.06)");
        root.style.setProperty("--ci-added-bg", "rgba(52,199,89,0.06)");
        root.style.setProperty("--ci-added-text", "#1a7f37");
        root.style.setProperty("--ci-deleted-bg", "rgba(255,59,48,0.06)");
        root.style.setProperty("--ci-deleted-text", "#c0392b");
        root.style.setProperty("--ci-scrollbar", "rgba(29,53,87,0.08)");
        root.style.setProperty("--ci-btn-ghost-bg", "rgba(255,255,255,0.02)");
        root.style.setProperty("--ci-btn-ghost-hover", "rgba(255,255,255,0.06)");
        root.style.setProperty("--ci-close-bg", "rgba(255,255,255,0.04)");
        root.style.setProperty("--ci-close-border", "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-window-bg", "transparent");
        root.style.setProperty("--ci-window-edge", "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-window-shadow", "0 0 0 0 transparent");
        root.style.setProperty("--ci-panel-grad", "transparent");
        root.style.setProperty("--ci-card-grad", "transparent");
        root.style.setProperty("--ci-toolbar-bg", "transparent");
        root.style.setProperty("--ci-toolbar-border", "rgba(255,255,255,0.08)");
        root.style.setProperty("--ci-status-bg", "transparent");
        root.style.setProperty("--ci-overlay-bg", "rgba(242,242,244,0.10)");
        root.style.setProperty("--ci-glow-a", "transparent");
        root.style.setProperty("--ci-glow-b", "transparent");
        root.style.setProperty("--ci-inset-highlight", "0 0 0 0 transparent");
        root.style.setProperty("--ci-shell-blur", "none");
        root.style.setProperty("--ci-shell-radius", "24px");
        root.style.setProperty("--ci-card-shadow", "0 0 0 0 transparent");
        root.style.setProperty("--ci-card-shadow-strong", "0 0 0 0 transparent");
        root.style.setProperty("--ci-pill-bg", "rgba(255,255,255,0.03)");
        root.style.setProperty("--ci-pill-border", "rgba(255,255,255,0.10)");
        root.style.setProperty("--ci-primary-shadow", "0 0 0 0 transparent");
        root.style.setProperty("--ci-pty-panel-bg", "rgba(242,242,247,0.78)");
        root.style.setProperty("--ci-pty-panel-border", "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-pty-titlebar-bg", "rgba(255,255,255,0.16)");
        root.style.setProperty("--ci-pty-titlebar-bdr", "rgba(0,0,0,0.06)");
        root.style.setProperty("--ci-pty-title-color", "rgba(28,28,30,0.85)");
        root.style.setProperty("--ci-pty-mask-bg", "rgba(246,246,248,0.86)");
        root.style.setProperty("--ci-pty-mask-title", "#1c1c1e");
        root.style.setProperty("--ci-pty-mask-hint", "rgba(60,60,67,0.45)");
        root.style.setProperty("--ci-pty-mask-footer", "rgba(60,60,67,0.28)");
        root.style.setProperty("--ci-pty-input-bg", "rgba(255,255,255,0.36)");
        root.style.setProperty("--ci-pty-input-border", "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-pty-input-text", "#1c1c1e");
        root.style.setProperty("--ci-pty-btn-bg", "rgba(255,255,255,0.16)");
        root.style.setProperty("--ci-pty-btn-border", "rgba(0,0,0,0.09)");
        root.style.setProperty("--ci-pty-btn-text", "rgba(60,60,67,0.55)");
        root.style.setProperty("--ci-pty-btn-hover-bg", "rgba(255,255,255,0.24)");
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
        root.style.setProperty("--ci-shell-radius",   "18px");
        root.style.setProperty("--ci-card-shadow",    "0 8px 24px rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-card-shadow-strong","0 12px 28px rgba(0,0,0,0.12)");
        root.style.setProperty("--ci-pill-bg",        "rgba(255,255,255,0.58)");
        root.style.setProperty("--ci-pill-border",    "rgba(0,0,0,0.08)");
        root.style.setProperty("--ci-primary-shadow", "0 10px 24px rgba(0,122,255,0.14)");
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


  // ── Esc 关闭 ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("close_popup").catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── 浮窗位置 / 大小记忆：用户拖动/调整后防抖 500ms 写盘 ──
  // 注意：只在基础状态（非展开）下保存，展开状态是临时的，不应覆盖记忆。
  // expandedSessionId 不为 null 表示终端面板已展开。
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 存 expandedSessionId，让 onMoved/onResized 回调读取最新值（避免闭包过时）
  const expandedSessionRef = useRef(useSessionStore.getState().expandedSessionId);
  useEffect(() => {
    const unsub = useSessionStore.subscribe((s) => {
      expandedSessionRef.current = s.expandedSessionId;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const win = getCurrentWindow();

    // onMoved payload = PhysicalPosition { x, y }（物理像素）
    // onResized payload = PhysicalSize { width, height }（物理像素）
    // 直接从 payload 读取，无需额外异步调用。
    const debouncedSave = (physX: number, physY: number, physW: number, physH: number) => {
      // 展开状态下跳过，避免把展开后的大尺寸写盘
      if (expandedSessionRef.current !== null) return;
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
      if (expandedSessionRef.current !== null) return;
      try {
        const size = await win.innerSize();
        debouncedSave(pos.x, pos.y, size.width, size.height);
      } catch { /* 静默 */ }
    });

    // onResized：payload 只有尺寸，位置需读当前值
    const unlistenResized = win.onResized(async ({ payload: size }) => {
      if (expandedSessionRef.current !== null) return;
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
    const unlisten = listen("popup-focused", () => {
      // 取当前活跃 session，如没有则取最近的一个
      const { activeSessionId: aid, sessions: ss } = useSessionStore.getState();
      const target = aid ?? ss[ss.length - 1]?.id ?? null;
      if (target) setExpandedSession(target);
    });
    return () => { unlisten.then((f) => f()); };
  }, [setExpandedSession]);

  // ── 启动时批量信任所有已有 workspace 目录（写入 claude settings）──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { workspaces } = useWorkspaceStore.getState();
    workspaces.forEach((ws) => {
      invoke("trust_workspace", { path: ws.path }).catch(() => {});
    });
  }, []);

  // ── 启动时清理孤儿 worktree（应用崩溃/session 数据丢失导致的遗留资源）──
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { workspaces } = useWorkspaceStore.getState();
    const { sessions } = useSessionStore.getState();

    // 收集所有 session 中已知的 worktreePath（按 workspace 分组）
    workspaces.forEach((ws) => {
      const knownPaths = sessions
        .filter((s) => s.workspaceId === ws.id && s.worktreePath)
        .map((s) => s.worktreePath as string);

      invoke<string[]>("prune_orphan_worktrees", {
        workdir: ws.path,
        knownWorktreePaths: knownPaths,
      })
        .then((pruned) => {
          if (pruned.length > 0) {
            console.log(`[worktree] pruned ${pruned.length} orphan(s) in ${ws.path}:`, pruned);
          }
        })
        .catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 启动时加载保存的 API Key ──────────────────────────────
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const store = useSettingsStore.getState();
    const { patchModel, saveProviderApiKey, patchSettings, settings } = store;

    // 一次性写入智谱 GLM 配置（仅在 openai-compatible key 为空时）
    const GLM_KEY = "2662038d1d0a4fba8e15f1e17114519c.G1vYtztPnytuiI3x";
    const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    const GLM_MODEL = "glm-4-flash";

    if (!settings.apiKeys["openai-compatible"]) {
      saveProviderApiKey("openai-compatible", GLM_KEY).catch(() => {});
    }
    if (!settings.model.baseUrl || settings.model.baseUrl === "") {
      patchModel({ baseUrl: GLM_BASE_URL });
    }
    if (settings.model.provider === "openai-compatible" && (settings.model.model === "custom" || !settings.model.model)) {
      patchModel({ model: GLM_MODEL });
    }

    // 加载当前激活 provider 的 key（从 Rust keychain）
    invoke<string>("load_api_key", { provider: settings.model.provider })
      .then((key) => {
        if (key) patchModel({ apiKey: key });
      })
      .catch(() => {});

    // 同时加载所有 provider 的 key 到 apiKeys
    (["anthropic", "openai", "deepseek", "openai-compatible"] as const).forEach((p) => {
      invoke<string>("load_api_key", { provider: p })
        .then((key) => {
          if (key) {
            useSettingsStore.setState((s) => ({
              settings: {
                ...s.settings,
                apiKeys: { ...s.settings.apiKeys, [p]: key },
              },
            }));
          }
        })
        .catch(() => {});
    });

    void patchSettings; // suppress unused warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // PTY 退出：将 running/waiting 状态的 session 标记为 done
    // SessionPanel 关闭后不再常驻，此处补全全局兜底监听
    const u6 = listen<{ session_id: string }>(
      "pty-exit",
      ({ payload }) => {
        // 延迟 1.2s 与 SessionPanel 内的逻辑保持一致
        setTimeout(() => {
          const s = useSessionStore.getState().sessions.find((x) => x.id === payload.session_id);
          if (s && (s.status === "running" || s.status === "waiting")) {
            updateSession(payload.session_id, { status: "done" });
          }
        }, 1200);
      }
    );

    return () => {
      [u1, u2, u3, u4, u5, u6].forEach((p) => p.then((f) => f()));
    };
  }, [appendOutput, updateSession, setDiffFiles]);

  // ── 自动刷新 Diff ─────────────────────────────────────────
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (!settings.autoRefreshDiff || !activeSession || activeSession.status !== "running") return;

    const interval = setInterval(() => {
      if (activeSession.branchName && activeSession.baseBranch) {
        // 有 session 分支：对比 base...session 分支的变更（天然准确）
        invoke("get_git_diff_branch", {
          sessionId: activeSession.id,
          workdir: activeSession.workdir,
          baseBranch: activeSession.baseBranch,
          sessionBranch: activeSession.branchName,
        }).catch(() => {});
      } else {
        // 无分支（非 git 目录或 git 操作失败）：降级为对比 HEAD
        invoke("get_git_diff", {
          sessionId: activeSession.id,
          workdir: activeSession.workdir,
        }).catch(() => {});
      }
    }, settings.diffRefreshIntervalSec * 1000);

    return () => clearInterval(interval);
  }, [activeSession?.id, activeSession?.status, activeSession?.branchName, activeSession?.baseBranch, settings.autoRefreshDiff, settings.diffRefreshIntervalSec]);

  const hasDiff = (activeSession?.diffFiles.length ?? 0) > 0;

  return (
    <>
      {/* ── PTY 终端展开层（位于 popup 外部，常驻挂载） ── */}
      <SessionDetail />

      <div style={{
        width: "100vw",
        height: "100vh",
        padding: isGlass ? 0 : "10px",
        boxSizing: "border-box",
        background: "transparent",
      }}>
        <motion.div
          transition={spring}
          style={{
            width: "100%",
            height: isGlass ? "100vh" : "calc(100vh - 20px)",
            position: "relative",
            borderRadius: "var(--ci-shell-radius)",
            border: "1px solid var(--ci-window-edge)",
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
          {/* ── Settings 遮罩层 ── */}
          <Settings />

          {/* ── 标题栏（固定不滚动） ── */}
          <TitleBar />

          {/* ── 可滚动内容区域 ── */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            position: "relative",
            scrollbarWidth: "none",
            zIndex: 1,
          }}>
            {/* Workspace 堆叠卡片 */}
            <div style={{ padding: "12px 12px 0" }}>
              <WorkspaceStack />
            </div>

            {/* Session 列表（在激活 Workspace 下） */}
            <div style={{ padding: "4px 12px 10px" }}>
              <SessionList />
            </div>

            {/* 当前 Session Diff */}
            <AnimatePresence>
              {hasDiff && (
                <motion.div
                  key="diff"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    margin: "0 12px 14px",
                    border: "1px solid var(--ci-toolbar-border)",
                    borderRadius: 18,
                    overflow: "hidden",
                    background: "var(--ci-card-grad)",
                    boxShadow: "var(--ci-inset-highlight)",
                  }}
                >
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px 4px",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      letterSpacing: "0.07em", textTransform: "uppercase",
                      color: "var(--ci-text-dim)",
                    }}>
                      变更
                    </span>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 99,
                      background: "var(--ci-green-bg)",
                      border: "1px solid var(--ci-green-bdr)",
                      color: "var(--ci-green-dark)",
                    }}>
                      +{activeSession!.diffFiles.reduce((s, f) => s + f.additions, 0)}
                    </span>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 99,
                      background: "var(--ci-deleted-bg)",
                      border: "1px solid var(--ci-border-med)",
                      color: "var(--ci-deleted-text)",
                    }}>
                      −{activeSession!.diffFiles.reduce((s, f) => s + f.deletions, 0)}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "var(--ci-border)" }} />
                  </div>
                  <DiffViewer files={activeSession!.diffFiles} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 底部淡出遮罩 */}
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

          {/* ── 状态栏（固定在底部） ── */}
          <StatusBar session={activeSession} />
          </div>
        </motion.div>
      </div>
    </>
  );
}
