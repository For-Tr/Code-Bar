/**
 * RunnerRouter — 根据用户配置分发到对应 Runner
 *
 * - claude-code / codex / custom-cli → Rust 侧子进程
 * - native → 前端 NativeHarness
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { createNativeHarness } from "./nativeHarness";
import type { RunnerConfig, ModelConfig, HarnessPermissions } from "../store/settingsStore";

export interface RunnerHandle {
  stop: () => void;
}

export interface RouterOptions {
  sessionId: string;
  workdir: string;
  task: string;
  runner: RunnerConfig;
  model: ModelConfig;
  harness: HarnessPermissions;
  onOutput: (line: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

export async function startRunner(opts: RouterOptions): Promise<RunnerHandle> {
  const { runner, sessionId, workdir, task, model, harness, onOutput, onDone, onError } = opts;

  if (runner.type === "native") {
    // 前端 NativeHarness
    const h = createNativeHarness(model, harness, workdir, onOutput, onDone, onError);
    h.start(task).catch(onError);
    return { stop: h.stop };
  }

  // CLI Runner：路由到 Rust 侧
  const cliType = runner.type; // "claude-code" | "codex" | "custom-cli"

  let unlistenOutput: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;

  // 监听 Rust 侧推送的输出事件
  unlistenOutput = await listen<{ session_id: string; line: string }>(
    "runner-output",
    (ev) => {
      if (ev.payload.session_id === sessionId) {
        onOutput(ev.payload.line);
      }
    }
  );

  unlistenDone = await listen<{ session_id: string; error?: string }>(
    "runner-done",
    (ev) => {
      if (ev.payload.session_id === sessionId) {
        if (ev.payload.error) onError(ev.payload.error);
        onDone();
        unlistenOutput?.();
        unlistenDone?.();
      }
    }
  );

  // 启动 Rust 侧 CLI 子进程
  await invoke("start_runner", {
    sessionId,
    workdir,
    task,
    runnerType: cliType,
    cliPath: runner.cliPath ?? "",
    cliArgs: runner.cliArgs ?? "",
  });

  return {
    stop: () => {
      invoke("stop_runner", { sessionId }).catch(console.error);
      unlistenOutput?.();
      unlistenDone?.();
    },
  };
}
