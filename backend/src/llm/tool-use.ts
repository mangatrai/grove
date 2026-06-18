import { env } from "../config/env.js";
import { openaiToolLoop } from "./providers/openai.js";
import { anthropicToolLoop } from "./providers/anthropic.js";
import type { ChatMessage, CompletionOptions, Tool } from "./types.js";

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface ToolUseAdapter {
  runToolLoop(
    messages: ChatMessage[],
    tools: Tool[],
    executor: ToolExecutor,
    options: CompletionOptions & { maxIterations?: number }
  ): Promise<{ finalResponse: string }>;
}

const openaiAdapter: ToolUseAdapter = {
  runToolLoop: (messages, tools, executor, options) =>
    openaiToolLoop(messages, tools, executor, options),
};

const anthropicAdapter: ToolUseAdapter = {
  runToolLoop: (messages, tools, executor, options) =>
    anthropicToolLoop(messages, tools, executor, options),
};

export function getToolUseAdapter(): ToolUseAdapter {
  return env.LLM_PROVIDER === "anthropic" ? anthropicAdapter : openaiAdapter;
}
