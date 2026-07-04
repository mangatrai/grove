import OpenAI from "openai";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import type {
  ChatMessage,
  CompletionOptions,
  Tool,
  LlmUsage,
  VisionMessage,
  VisionCompletionOptions,
} from "../types.js";

function buildClient(): OpenAI {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

function toOaiMessages(
  messages: ChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId ?? "",
        content: m.content,
      };
    }
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant" as const,
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return {
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    };
  });
}

// ── Chat completion ───────────────────────────────────────────────────────────

export async function openaiChat(
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<{ content: string; usage: LlmUsage }> {
  const client = buildClient();
  const res = await client.chat.completions.create({
    model: options.model,
    messages: toOaiMessages(messages),
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    ...(options.responseFormat === "json" ? { response_format: { type: "json_object" as const } } : {}),
  });
  return {
    content: res.choices[0]?.message?.content ?? "",
    usage: {
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
      totalTokens: res.usage?.total_tokens,
    },
  };
}

// ── Tool-use loop ─────────────────────────────────────────────────────────────

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export async function openaiToolLoop(
  initialMessages: ChatMessage[],
  tools: Tool[],
  executor: ToolExecutor,
  options: CompletionOptions & { maxIterations?: number }
): Promise<{ finalResponse: string }> {
  const client = buildClient();
  const oaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = toOaiMessages(initialMessages);
  const maxIter = options.maxIterations ?? 5;

  for (let i = 0; i < maxIter; i++) {
    const res = await client.chat.completions.create({
      model: options.model,
      messages,
      tools: oaiTools,
      tool_choice: "auto",
      max_tokens: options.maxTokens,
    });
    const choice = res.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { finalResponse: msg.content ?? "" };
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        result = await executor(call.function.name, args);
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        log.warn("llm tool executor error", { tool: call.function.name, err });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  return { finalResponse: "" };
}

// ── Vision ────────────────────────────────────────────────────────────────────

function toOaiVisionContent(
  parts: NonNullable<VisionMessage["content"]>
): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  if (typeof parts === "string") return [{ type: "text", text: parts }];
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : {
          type: "image_url" as const,
          image_url: { url: `data:${p.mimeType};base64,${p.base64Data}` },
        }
  );
}

export async function openaiVision(
  messages: VisionMessage[],
  options: VisionCompletionOptions
): Promise<{ content: string; usage: LlmUsage }> {
  const client = buildClient();

  const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) =>
    m.role === "system"
      ? { role: "system" as const, content: typeof m.content === "string" ? m.content : "" }
      : { role: "user" as const, content: toOaiVisionContent(m.content) }
  );

  let responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
  if (options.responseFormat === "json" && options.jsonSchema && options.jsonSchemaName) {
    responseFormat = {
      type: "json_schema",
      json_schema: { name: options.jsonSchemaName, strict: true, schema: options.jsonSchema },
    };
  } else if (options.responseFormat === "json") {
    responseFormat = { type: "json_object" };
  }

  const res = await client.chat.completions.create({
    model: options.model,
    messages: oaiMessages,
    max_tokens: options.maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });

  return {
    content: res.choices[0]?.message?.content ?? "",
    usage: {
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
      totalTokens: res.usage?.total_tokens,
    },
  };
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function openaiEmbed(
  texts: string[],
  model: string
): Promise<number[][]> {
  const client = buildClient();
  const res = await client.embeddings.create({ model, input: texts });
  return res.data.map((d) => d.embedding);
}
