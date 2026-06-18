import { env } from "../config/env.js";
import { openaiChat } from "./providers/openai.js";
import { anthropicChat } from "./providers/anthropic.js";
import type { ChatMessage, CompletionOptions, LlmUsage } from "./types.js";

export interface ChatCompletionAdapter {
  complete(messages: ChatMessage[], options: CompletionOptions): Promise<{ content: string; usage: LlmUsage }>;
}

const openaiAdapter: ChatCompletionAdapter = { complete: openaiChat };
const anthropicAdapter: ChatCompletionAdapter = { complete: anthropicChat };

export function getChatAdapter(): ChatCompletionAdapter {
  return env.LLM_PROVIDER === "anthropic" ? anthropicAdapter : openaiAdapter;
}
