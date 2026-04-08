import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useSettingsStore } from "../store/settingsStore";

interface Props {
  sessionId: string;
  command: string;     // e.g. "claude"
  args?: string[];     // e.g. ["--dangerously-skip-permissions"]
  workdir: string;
  active: boolean;     // 是否可见/激活
  onReady?: () => void; // PTY 进程启动成功后回调（用于透传初始 query）
  onWaiting?: () => void; // CLI 完成任务、等待下一条 query 时回调
  onRunning?: () => void; // CLI 开始处理 query 时回调
  onError?: (error: string) => void; // API 错误中断回调
  onNotification?: (title: string, message: string, notification_type: string) => void; // Claude Code hook 通知回调
  // 额外注入的环境变量，透传给 start_pty_session（如 CODE_BAR_* context 信息）
  env?: [string, string][];
}

// ── xterm 主题定义 ─────────────────────────────────────────────
const TERM_THEME_DARK = {
  background:           "#0a0a0c",
  foreground:           "#e2e8f0",
  cursor:               "#60a5fa",
  cursorAccent:         "#0a0a0c",
  selectionBackground:  "rgba(96,165,250,0.3)",
  black:                "#1e1e2e",
  red:                  "#f87171",
  green:                "#4ade80",
  yellow:               "#fbbf24",
  blue:                 "#60a5fa",
  magenta:              "#c084fc",
  cyan:                 "#34d399",
  white:                "#e2e8f0",
  brightBlack:          "#374151",
  brightRed:            "#fc8181",
  brightGreen:          "#6ee7b7",
  brightYellow:         "#fde68a",
  brightBlue:           "#93c5fd",
  brightMagenta:        "#d8b4fe",
  brightCyan:           "#6ee7b7",
  brightWhite:          "#f1f5f9",
};

// 浅色模式：终端背景改为暖白/米色，前景改为深色，但保留足够对比度
const TERM_THEME_LIGHT = {
  background:           "#1e1e2e",   // 浅色模式也保持深色终端背景（可读性好）
  foreground:           "#e2e8f0",
  cursor:               "#007AFF",
  cursorAccent:         "#1e1e2e",
  selectionBackground:  "rgba(0,122,255,0.25)",
  black:                "#1e1e2e",
  red:                  "#f87171",
  green:                "#4ade80",
  yellow:               "#fbbf24",
  blue:                 "#60a5fa",
  magenta:              "#c084fc",
  cyan:                 "#34d399",
  white:                "#e2e8f0",
  brightBlack:          "#4b5563",
  brightRed:            "#fc8181",
  brightGreen:          "#6ee7b7",
  brightYellow:         "#fde68a",
  brightBlue:           "#93c5fd",
  brightMagenta:        "#d8b4fe",
  brightCyan:           "#6ee7b7",
  brightWhite:          "#f1f5f9",
};

// 根据 settings.theme + 系统媒体查询，计算是否为深色模式
function getIsDark(theme: "light" | "dark" | "glass" | "system"): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (theme === "glass") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function PtyTerminal({ sessionId, command, args = [], workdir, active, onReady, onWaiting, onRunning, onError, onNotification, env }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const [exited, setExited] = useState(false);

  // 读取当前主题
  const theme = useSettingsStore((s) => s.settings.theme);

  // ── 初始化 xterm ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = getIsDark(theme);
    const termTheme = isDark ? TERM_THEME_DARK : TERM_THEME_LIGHT;
    const termBg = isDark ? "#0a0a0c" : "#1e1e2e";

    const term = new Terminal({
      theme: termTheme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      allowTransparency: true,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // 更新容器背景色
    if (containerRef.current) {
      containerRef.current.style.background = termBg;
    }

    // 键盘输入 → 发给 PTY（base64 编码）
    term.onData((data: string) => {
      const bytes = new TextEncoder().encode(data);
      const b64 = btoa(String.fromCharCode(...bytes));
      invoke("write_pty", { sessionId, data: b64 }).catch(() => {});
    });

    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── 主题切换时动态更新 xterm 颜色 ────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const isDark = getIsDark(theme);
    const termTheme = isDark ? TERM_THEME_DARK : TERM_THEME_LIGHT;
    const termBg = isDark ? "#0a0a0c" : "#1e1e2e";

    // xterm 5.x 支持直接更新 options.theme
    term.options.theme = termTheme;

    if (containerRef.current) {
      containerRef.current.style.background = termBg;
    }

    // system 模式：监听系统颜色变化
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        const t = termRef.current;
        if (!t) return;
        t.options.theme = e.matches ? TERM_THEME_DARK : TERM_THEME_LIGHT;
        const bg = e.matches ? "#0a0a0c" : "#1e1e2e";
        if (containerRef.current) containerRef.current.style.background = bg;
      };
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    }
  }, [theme]);

  // 用 ref 保存最新回调，避免闭包过时（不加入依赖数组）
  const onWaitingRef = useRef(onWaiting);
  onWaitingRef.current = onWaiting;
  const onRunningRef = useRef(onRunning);
  onRunningRef.current = onRunning;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  // ── 监听 PTY 数据事件 ─────────────────────────────────────
  useEffect(() => {
    const u1 = listen<{ session_id: string; data: string }>(
      "pty-data",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        const term = termRef.current;
        if (!term) return;
        try {
          const bin = atob(payload.data);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          term.write(bytes);
        } catch {}
      }
    );

    const u2 = listen<{ session_id: string }>(
      "pty-exit",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        termRef.current?.writeln("\r\n\x1b[90m─────────────────────────────────────\x1b[0m");
        termRef.current?.writeln("\x1b[90m[进程已退出]\x1b[0m");
        setExited(true);
        startedRef.current = false; // 允许重启
      }
    );

    // CLI 完成任务，等待下一条 query（检测到 "? for shortcuts"）
    const u3 = listen<{ session_id: string }>(
      "pty-waiting",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        onWaitingRef.current?.();
      }
    );

    // CLI 开始处理 query（检测到 "esc to interrupt"）
    const u4 = listen<{ session_id: string }>(
      "pty-running",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        onRunningRef.current?.();
      }
    );

    // API 错误中断（StopFailure hook）
    const u5 = listen<{ session_id: string; error: string }>(
      "pty-error",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        onErrorRef.current?.(payload.error);
      }
    );

    // Claude Code hook: Notification（需要用户确认/输入）
    const u6 = listen<{ session_id: string; title: string; message: string; notification_type: string }>(
      "pty-notification",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        onNotificationRef.current?.(payload.title, payload.message, payload.notification_type);
      }
    );

    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      u3.then((f) => f());
      u4.then((f) => f());
      u5.then((f) => f());
      u6.then((f) => f());
    };
  }, [sessionId]);

  // ── 启动 PTY 进程（仅第一次，之后常驻直到 exit）────────
  // 用 ref 保存最新的 args/onReady/env，避免加入依赖导致每次渲染重启
  const argsRef = useRef(args);
  argsRef.current = args;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const envRef = useRef(env);
  envRef.current = env;

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    setExited(false);

    // 延迟 250ms：等 resize_popup_full 动画完成，容器达到目标尺寸
    const timer = setTimeout(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (fit) fit.fit();
      const cols = Math.max(term?.cols ?? 80, 40);
      const rows = Math.max(term?.rows ?? 24, 12);

      // 打印启动提示，方便调试确认实际启动的命令
      const displayCmd = [command, ...argsRef.current].join(" ");
      term?.writeln(`\x1b[90m$ ${displayCmd}\x1b[0m`);

      invoke("start_pty_session", {
        sessionId,
        workdir,
        command,
        args: argsRef.current,
        cols,
        rows,
        env: envRef.current ?? null,
      })
        .then(() => {
          // spawn 返回 = CLI 进程已启动（resolve_command_path 保证是完整路径直接 spawn）
          onReadyRef.current?.();
        })
        .catch((e) => {
          termRef.current?.writeln(`\x1b[31m启动失败: ${e}\x1b[0m`);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [active, sessionId, workdir, command]);

  // ── 重新启动（退出后用户点击重启）───────────────────────
  const handleRestart = () => {
    setExited(false);
    startedRef.current = false;
    termRef.current?.clear();

    const fit = fitRef.current;
    const term = termRef.current;
    if (fit) fit.fit();
    const cols = Math.max(term?.cols ?? 80, 40);
    const rows = Math.max(term?.rows ?? 24, 12);
    startedRef.current = true;

    const displayCmd = [command, ...argsRef.current].join(" ");
    term?.writeln(`\x1b[90m$ ${displayCmd}\x1b[0m`);

    invoke("start_pty_session", {
      sessionId,
      workdir,
      command,
      args: argsRef.current,
      cols,
      rows,
      env: envRef.current ?? null,
    })
      .then(() => {
        onReadyRef.current?.();
      })
      .catch((e) => {
        termRef.current?.writeln(`\x1b[31m启动失败: ${e}\x1b[0m`);
      });
  };

  // ── 可见时 fit + focus（重新展开时恢复焦点，不重启 PTY）──
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [active]);

  // active ref：供 ResizeObserver 回调访问（避免闭包过时）
  const activeRef = useRef(active);
  activeRef.current = active;

  // ── ResizeObserver：自动 fit + 同步 PTY 大小给 Rust ─────
  // 只有 active=true（面板可见）时才向 Rust 同步尺寸，
  // 避免面板收起时窗口缩小导致 resize_pty 传入极小值使进程崩溃
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      fit.fit();
      // 仅在面板可见时同步给 Rust，防止收起时 cols/rows 为 0 导致进程崩溃
      if (!activeRef.current) return;
      const cols = Math.max(term.cols, 20);
      const rows = Math.max(term.rows, 5);
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessionId]);

  const isDark = getIsDark(theme);
  const termBg = isDark ? "#0a0a0c" : "#1e1e2e";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* xterm canvas */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", background: termBg }}
      />

      {/* 退出后的重启覆盖层 */}
      {exited && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "12px 16px",
          background: `linear-gradient(to top, ${termBg} 70%, transparent)`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
            会话已结束
          </span>
          <button
            onClick={handleRestart}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", borderRadius: 8,
              border: "1px solid rgba(96,165,250,0.35)",
              background: "rgba(96,165,250,0.1)",
              color: "#60a5fa", fontSize: 12, fontWeight: 600,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(96,165,250,0.2)";
              e.currentTarget.style.borderColor = "rgba(96,165,250,0.6)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(96,165,250,0.1)";
              e.currentTarget.style.borderColor = "rgba(96,165,250,0.35)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            重新启动
          </button>
        </div>
      )}
    </div>
  );
}
