/**
 * NativeHarness — 内置 Tool-Calling 工作流
 *
 * 直接调用 LLM API，内置 read_file / write_file / run_command / get_git_diff 工具，
 * 无需安装任何 CLI。
 */

import { callLLM } from "./llmClient";
import { executeTool, getAvailableTools } from "./tools";
import type { HarnessMessage, ContentBlock, ToolCall } from "./types";
import type { ModelConfig, HarnessPermissions } from "../store/settingsStore";

const SYSTEM_PROMPT = `你是 Code Bar 内置的编程助手，运行在用户的 Mac 电脑上。

你的工作方式：
1. 分析用户的任务需求
2. 使用提供的工具（读文件、写文件、执行命令、查看 git diff）来完成任务
3. 每次工具调用后，根据结果决定下一步
4. 任务完成后，给出简洁的总结

工作原则：
- 优先读取文件了解代码结构，再进行修改
- 修改文件时给出完整内容，不要截断
- 命令执行结果为空时，确认操作是否成功
- 遇到错误时，分析原因并尝试修复
- 所有路径使用相对路径（相对于工作目录）

语言：使用中文回复，代码保持原语言。`;

export interface HarnessRunner {
  start: (task: string) => Promise<void>;
  stop: () => void;
}

export function createNativeHarness(
  modelCfg: ModelConfig,
  permissions: HarnessPermissions,
  workdir: string,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): HarnessRunner {
  let aborted = false;

  const stop = () => {
    aborted = true;
    onOutput("⏹️  任务已停止");
    onDone();
  };

  const start = async (task: string) => {
    aborted = false;
    const tools = getAvailableTools(permissions);
    const messages: HarnessMessage[] = [{ role: "user", content: task }];

    onOutput(`🚀 启动内置 Harness（${modelCfg.provider}/${modelCfg.model}）`);
    onOutput(`📁 工作目录: ${workdir}`);
    onOutput(`🛠️  可用工具: ${tools.map((t) => t.name).join(", ")}`);
    onOutput("─".repeat(40));

    let round = 0;
    const MAX_ROUNDS = 20; // 防止无限循环

    try {
      while (!aborted && round < MAX_ROUNDS) {
        round++;
        onOutput(`\n[轮次 ${round}] 调用 LLM...`);

        const { text, toolCalls, stopReason } = await callLLM(
          modelCfg,
          messages,
          tools,
          SYSTEM_PROMPT
        );

        if (aborted) break;

        // 收集 assistant 的回复块
        const assistantContent: ContentBlock[] = [];
        if (text) {
          onOutput(`\n💬 ${text}`);
          assistantContent.push({ type: "text", text });
        }

        // 执行工具调用
        if (toolCalls.length > 0) {
          const toolResults: ContentBlock[] = [];

          for (const call of toolCalls as ToolCall[]) {
            if (aborted) break;
            onOutput(`\n🔧 工具调用: ${call.name}`);
            assistantContent.push({
              type: "tool_use",
              id: call.id,
              name: call.name,
              input: call.input,
            });

            const result = await executeTool(call, workdir, permissions, onOutput);
            onOutput(
              result.is_error
                ? `❌ ${result.content}`
                : `✅ ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}`
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: result.tool_use_id,
              content: result.content,
              is_error: result.is_error,
            });
          }

          // 把 assistant 的工具调用内容和结果加入对话
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({ role: "user", content: toolResults });

          // 工具执行完后继续对话
          continue;
        }

        // 没有工具调用，加入 assistant 的文本回复，结束对话
        messages.push({ role: "assistant", content: assistantContent });

        if (stopReason === "end_turn" || stopReason === "stop") {
          onOutput("\n" + "─".repeat(40));
          onOutput("✅ 任务完成");
          break;
        }

        if (stopReason === "max_tokens") {
          onOutput("\n⚠️  已达到最大 Token 数，任务可能未完成");
          break;
        }
      }

      if (round >= MAX_ROUNDS) {
        onOutput(`\n⚠️  已达到最大轮次（${MAX_ROUNDS}），停止执行`);
      }
    } catch (e) {
      onError(String(e));
      onOutput(`\n❌ 错误: ${e}`);
    } finally {
      onDone();
    }
  };

  return { start, stop };
}
