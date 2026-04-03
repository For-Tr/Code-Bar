import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { SessionList } from "./components/SessionList";
import { Toolbar } from "./components/Toolbar";
import { OutputConsole } from "./components/OutputConsole";
import { DiffViewer } from "./components/DiffViewer";
import { StatusBar } from "./components/StatusBar";
import Settings from "./components/Settings";
import { useSessionStore, DiffFile } from "./store/sessionStore";
import { useSettingsStore } from "./store/settingsStore";

const spring = { type: "spring" as const, stiffness: 320, damping: 28, mass: 1 };

export default function App() {
  const {
    sessions,
    activeSessionId,
    expandedDiffFileId,
    appendOutput,
    updateSession,
    setDiffFiles,
  } = useSessionStore();

  const { settings } = useSettingsStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Esc 关闭 ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("close_popup").catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── 动态窗口高度（防抖，用 offsetHeight 避免输入框影响） ──
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputFocusedRef = useRef(false); // Toolbar 输入框聚焦时暂停 resize

  // 暴露给 Toolbar 的焦点回调
  const onTaskInputFocus = useCallback(() => { inputFocusedRef.current = true; }, []);
  const onTaskInputBlur  = useCallback(() => {
    inputFocusedRef.current = false;
    // blur 后立刻重算一次，确保高度正确
    const el = panelRef.current;
    if (!el) return;
    const h = Math.min(Math.max(el.offsetHeight + 2, 240), 700);
    invoke("resize_popup", { height: h }).catch(() => {});
  }, []);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // 输入框聚焦期间跳过，防止输入时窗口抖动
      if (inputFocusedRef.current) return;
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        // offsetHeight = 实际渲染高度，不含溢出内容，不受 input 文字影响
        const h = Math.min(Math.max(el.offsetHeight + 2, 240), 700);
        invoke("resize_popup", { height: h }).catch(() => {});
      }, 60);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, [expandedDiffFileId, activeSessionId, sessions.length]);

  // ── 启动时加载保存的 API Key ──────────────────────────────
  useEffect(() => {
    const { patchModel, settings } = useSettingsStore.getState();
    invoke<string>("load_api_key", { provider: settings.model.provider })
      .then((key) => {
        if (key) patchModel({ apiKey: key });
      })
      .catch(() => {});
  }, []);

  // ── 监听 Rust 侧事件 ──────────────────────────────────────
  useEffect(() => {
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

    return () => {
      [u1, u2, u3, u4, u5].forEach((p) => p.then((f) => f()));
    };
  }, [appendOutput, updateSession, setDiffFiles]);

  // ── 自动刷新 Diff ─────────────────────────────────────────
  useEffect(() => {
    if (!settings.autoRefreshDiff || !activeSession || activeSession.status !== "running") return;

    const interval = setInterval(() => {
      invoke("get_git_diff", {
        sessionId: activeSession.id,
        workdir: activeSession.workdir,
      }).catch(() => {});
    }, settings.diffRefreshIntervalSec * 1000);

    return () => clearInterval(interval);
  }, [activeSession?.id, activeSession?.status, settings.autoRefreshDiff, settings.diffRefreshIntervalSec]);

  const hasDiff = (activeSession?.diffFiles.length ?? 0) > 0;

  return (
    <div style={{
      width: "360px",
      padding: "8px 8px 0 8px",
      background: "transparent",
    }}>
      <motion.div
        ref={panelRef}
        layout
        transition={spring}
        style={{
          width: "100%",
          position: "relative",
          background: "rgba(14,14,16,0.96)",
          backdropFilter: "blur(56px)",
          WebkitBackdropFilter: "blur(56px)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: [
            "0 4px 6px rgba(0,0,0,0.3)",
            "0 24px 48px rgba(0,0,0,0.5)",
            "inset 0 0 0 0.5px rgba(255,255,255,0.04)",
          ].join(", "),
          overflow: "hidden",
        }}
      >
        {/* ── Settings 遮罩层 ── */}
        <Settings />

        {/* ── 标题栏 ── */}
        <TitleBar />

        {/* ── Session 列表 ── */}
        <div style={{ padding: "8px 8px 4px" }}>
          <SessionList />
        </div>

        {/* ── 当前 Session 详情 ── */}
        <AnimatePresence mode="wait">
          {activeSession && (
            <motion.div
              key={activeSession.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Toolbar
                session={activeSession}
                onInputFocus={onTaskInputFocus}
                onInputBlur={onTaskInputBlur}
              />
              <OutputConsole session={activeSession} />

              <AnimatePresence>
                {hasDiff && (
                  <motion.div
                    key="diff"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.05)",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px 4px",
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        color: "rgba(255,255,255,0.22)",
                      }}>
                        变更
                      </span>
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 99,
                        background: "rgba(74,222,128,0.12)",
                        border: "1px solid rgba(74,222,128,0.25)",
                        color: "#4ade80",
                      }}>
                        +{activeSession.diffFiles.reduce((s, f) => s + f.additions, 0)}
                      </span>
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 99,
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.22)",
                        color: "#f87171",
                      }}>
                        −{activeSession.diffFiles.reduce((s, f) => s + f.deletions, 0)}
                      </span>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                    </div>
                    <DiffViewer files={activeSession.diffFiles} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 状态栏 ── */}
        <StatusBar session={activeSession} />
      </motion.div>
    </div>
  );
}
