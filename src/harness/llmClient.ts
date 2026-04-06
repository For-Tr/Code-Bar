import type { HarnessTool, HarnessMessage, ContentBlock, ToolCall } from "./types";
import type { ModelConfig } from "../store/settingsStore";

// ── OpenAI 兼容格式（Anthropic 走自己格式）────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: HarnessTool[];
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

// ── Anthropic 客户端 ──────────────────────────────────────────

async function callAnthropic(
  cfg: ModelConfig,
  messages: HarnessMessage[],
  tools: HarnessTool[],
  systemPrompt: string
): Promise<{ text: string; toolCalls: ToolCall[]; stopReason: string }> {
  const baseUrl = cfg.baseUrl || "https://api.anthropic.com";
  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 8192,
      temperature: cfg.temperature ?? 0.7,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    } satisfies AnthropicRequest),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
  }

  const data: AnthropicResponse = await resp.json();
  const text = data.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls: ToolCall[] = data.content
    .filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use"
    )
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  return { text, toolCalls, stopReason: data.stop_reason };
}

// ── OpenAI / 兼容接口客户端 ───────────────────────────────────

async function callOpenAI(
  cfg: ModelConfig,
  messages: HarnessMessage[],
  tools: HarnessTool[],
  systemPrompt: string
): Promise<{ text: string; toolCalls: ToolCall[]; stopReason: string }> {
  const baseUrl = cfg.baseUrl || "https://api.openai.com";

  // 转换消息格式
  const oaiMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m): OpenAIMessage => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      // 处理 tool result blocks
      const toolResults = (m.content as ContentBlock[]).filter(
        (b): b is { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean } =>
          b.type === "tool_result"
      );
      if (toolResults.length > 0 && m.role === "user") {
        // OpenAI 格式：每个 tool result 是独立的 message（这里只返回第一条）
        return {
          role: "tool",
          content: toolResults[0].content,
          tool_call_id: toolResults[0].tool_use_id,
        };
      }
      const textBlocks = (m.content as ContentBlock[]).filter(
        (b): b is { type: "text"; text: string } => b.type === "text"
      );
      return { role: m.role, content: textBlocks.map((b) => b.text).join("") };
    }),
  ];

  // 转换工具格式
  const oaiTools =
    tools.length > 0
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined;

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 8192,
      temperature: cfg.temperature ?? 0.7,
      messages: oaiMessages,
      tools: oaiTools,
      tool_choice: oaiTools ? "auto" : undefined,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
  }

  const data: OpenAIResponse = await resp.json();
  const choice = data.choices[0];
  const text = choice.message.content ?? "";
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  const stopReason =
    choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason;

  return { text, toolCalls, stopReason };
}

// ── DeepSeek（复用 OpenAI 兼容接口）─────────────────────────

async function callDeepSeek(
  cfg: ModelConfig,
  messages: HarnessMessage[],
  tools: HarnessTool[],
  systemPrompt: string
) {
  return callOpenAI(
    { ...cfg, baseUrl: "https://api.deepseek.com" },
    messages,
    tools,
    systemPrompt
  );
}

// ── 统一入口 ──────────────────────────────────────────────────

export async function callLLM(
  cfg: ModelConfig,
  messages: HarnessMessage[],
  tools: HarnessTool[],
  systemPrompt: string
): Promise<{ text: string; toolCalls: ToolCall[]; stopReason: string }> {
  switch (cfg.provider) {
    case "anthropic":
      return callAnthropic(cfg, messages, tools, systemPrompt);
    case "openai":
      return callOpenAI(cfg, messages, tools, systemPrompt);
    case "deepseek":
      return callDeepSeek(cfg, messages, tools, systemPrompt);
    case "openai-compatible":
      return callOpenAI(cfg, messages, tools, systemPrompt);
    default:
      throw new Error(`不支持的服务商: ${cfg.provider}`);
  }
}
