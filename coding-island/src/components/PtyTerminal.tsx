import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string;
  command: string;     // e.g. "claude"
  args?: string[];     // e.g. []
  workdir: string;
  active: boolean;     // 是否可见/激活
}

export function PtyTerminal({ sessionId, command, args = [], workdir, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const [exited, setExited] = useState(false);

  // ── 初始化 xterm ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
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
      },
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
  }, [sessionId]);

  // ── 监听 PTY 数据事件 ─────────────────────────────────────
  useEffect(() => {
    const u1 = listen<{ session_id: string; data: string }>(
      "pty-data",
      ({ payload }) => {
        if (payload.session_id !== sessionId) return;
        const term = termRef.current;
        if (!term) return;
        // base64 → Uint8Array → 写入 xterm
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
      }
    );

    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
    };
  }, [sessionId]);

  // ── 启动 PTY 进程（延迟确保容器已经展开到正确宽度）─────
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

      invoke("start_pty_session", {
        sessionId,
        workdir,
        command,
        args,
        cols,
        rows,
      }).catch((e) => {
        termRef.current?.writeln(`\x1b[31m启动失败: ${e}\x1b[0m`);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [active, sessionId, workdir, command, args]);

  // ── 重新启动（退出后用户点击重启）───────────────────────
  const handleRestart = () => {
    setExited(false);
    startedRef.current = false;
    // 清屏
    termRef.current?.clear();

    // 立即触发重启
    const fit = fitRef.current;
    const term = termRef.current;
    if (fit) fit.fit();
    const cols = Math.max(term?.cols ?? 80, 40);
    const rows = Math.max(term?.rows ?? 24, 12);
    startedRef.current = true;

    invoke("start_pty_session", {
      sessionId,
      workdir,
      command,
      args,
      cols,
      rows,
    }).catch((e) => {
      termRef.current?.writeln(`\x1b[31m启动失败: ${e}\x1b[0m`);
    });
  };

  // ── 可见时 fit ────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [active]);

  // ── ResizeObserver：自动 fit + 同步 PTY 大小给 Rust ─────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      // 同步给 Rust PTY
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessionId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* xterm canvas */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0c",
        }}
      />

      {/* 退出后的重启覆盖层 */}
      {exited && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "12px 16px",
            background: "linear-gradient(to top, rgba(10,10,12,0.98) 70%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <span style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.35)",
            fontFamily: "monospace",
          }}>
            会话已结束
          </span>
          <button
            onClick={handleRestart}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 14px",
              borderRadius: 8,
              border: "1px solid rgba(96,165,250,0.35)",
              background: "rgba(96,165,250,0.1)",
              color: "#60a5fa",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
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
