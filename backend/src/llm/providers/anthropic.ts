import Anthropic from "@anthropic-ai/sdk";
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
import type { ToolExecutor } from "./openai.js";

function buildClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * Anthropic takes `system` as a top-level param (not in the messages array).
 * Extract all system messages and join them; filter them out of the array.
 */
function splitSystem(messages: ChatMessage[]): { system: string | undefined; rest: ChatMessage[] } {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    rest: messages.filter((m) => m.role !== "system"),
  };
}

function toAnthropicMessages(
  messages: ChatMessage[]
): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") continue; // handled via splitSystem

    if (m.role === "tool") {
      // Tool results must be batched into the preceding user message when possible.
      // For simplicity, each result goes as its own user message with tool_result block.
      const last = result[result.length - 1];
      const block: Anthropic.Messages.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId ?? "",
        content: m.content,
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.Messages.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.toolCalls && m.toolCalls.length > 0) {
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }
  return result;
}

// ── Chat completion ───────────────────────────────────────────────────────────

export async function anthropicChat(
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<{ content: string; usage: LlmUsage }> {
  const client = buildClient();
  const { system, rest } = splitSystem(messages);

  // Real structured-output enforcement: force the model to call a single synthetic tool whose
  // input_schema is the desired shape, then read the already-parsed tool_use input back out.
  // Anthropic has no json_object-equivalent mode — this is its actual enforcement mechanism
  // (same tools API anthropicToolLoop uses below, just tool_choice forced instead of "auto").
  if (options.responseFormat === "json" && options.jsonSchema && options.jsonSchemaName) {
    const res = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 1024,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(rest),
      tools: [
        {
          name: options.jsonSchemaName,
          description: "Return the structured result for this request.",
          input_schema: options.jsonSchema as Anthropic.Messages.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: options.jsonSchemaName },
    });
    const toolUse = res.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    return {
      content: toolUse ? JSON.stringify(toolUse.input) : "",
      usage: {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
      },
    };
  }

  const systemFull =
    options.responseFormat === "json"
      ? [system, "Return ONLY valid JSON. No prose outside the JSON."].filter(Boolean).join("\n\n")
      : system;
  const res = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens ?? 1024,
    ...(systemFull ? { system: systemFull } : {}),
    messages: toAnthropicMessages(rest),
  });
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    content: text,
    usage: {
      promptTokens: res.usage.input_tokens,
      completionTokens: res.usage.output_tokens,
      totalTokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  };
}

// ── Tool-use loop ─────────────────────────────────────────────────────────────

export async function anthropicToolLoop(
  initialMessages: ChatMessage[],
  tools: Tool[],
  executor: ToolExecutor,
  options: CompletionOptions & { maxIterations?: number }
): Promise<{ finalResponse: string }> {
  const client = buildClient();
  const { system, rest } = splitSystem(initialMessages);
  const messages: Anthropic.Messages.MessageParam[] = toAnthropicMessages(rest);
  const anthropicTools: Anthropic.Messages.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
  }));
  const maxIter = options.maxIterations ?? 5;

  for (let i = 0; i < maxIter; i++) {
    const res = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 2000,
      ...(system ? { system } : {}),
      messages,
      tools: anthropicTools,
      tool_choice: { type: "auto" },
    });

    const toolUseBlocks = res.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = res.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text"
    );

    if (toolUseBlocks.length === 0) {
      return { finalResponse: textBlocks.map((b) => b.text).join("\n") };
    }

    // Assistant turn with tool_use blocks
    messages.push({ role: "assistant", content: res.content });

    // Execute all tools and batch results into a single user message
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      let result: string;
      try {
        result = await executor(block.name, block.input as Record<string, unknown>);
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        log.warn("llm tool executor error", { tool: block.name, err });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { finalResponse: "" };
}

// ── Vision ────────────────────────────────────────────────────────────────────

export async function anthropicVision(
  messages: VisionMessage[],
  options: VisionCompletionOptions
): Promise<{ content: string; usage: LlmUsage }> {
  const client = buildClient();

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean);
  const systemPrompt = systemParts.join("\n\n") || undefined;

  const anthropicMessages: Anthropic.Messages.MessageParam[] = messages
    .filter((m) => m.role === "user")
    .map((m) => ({
      role: "user" as const,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) =>
              p.type === "text"
                ? { type: "text" as const, text: p.text }
                : {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: p.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                      data: p.base64Data,
                    },
                  }
            ),
    }));

  // Real structured-output enforcement (same mechanism as anthropicChat above): force a synthetic
  // tool call whose input_schema is the desired shape, read the already-parsed tool_use input back
  // out. Replaces the old "Return ONLY valid JSON" prompt coercion, which broke whenever Claude added
  // markdown fences or any prose around the JSON.
  if (options.responseFormat === "json" && options.jsonSchema && options.jsonSchemaName) {
    const res = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: anthropicMessages,
      tools: [
        {
          name: options.jsonSchemaName,
          description: "Return the structured result for this request.",
          input_schema: options.jsonSchema as Anthropic.Messages.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: options.jsonSchemaName },
    });
    const toolUse = res.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    return {
      content: toolUse ? JSON.stringify(toolUse.input) : "",
      usage: {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
      },
    };
  }

  const systemFull =
    options.responseFormat === "json"
      ? [systemPrompt, "Return ONLY valid JSON. No prose outside the JSON."].filter(Boolean).join("\n\n")
      : systemPrompt;

  const res = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens ?? 2048,
    ...(systemFull ? { system: systemFull } : {}),
    messages: anthropicMessages,
  });

  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    content: text,
    usage: {
      promptTokens: res.usage.input_tokens,
      completionTokens: res.usage.output_tokens,
      totalTokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  };
}
