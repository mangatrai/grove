export type { ChatMessage, Tool, ToolCall, CompletionOptions, LlmUsage, VisionMessage, VisionContentPart, VisionCompletionOptions } from "./types.js";
export type { ChatCompletionAdapter } from "./chat.js";
export type { ToolUseAdapter, ToolExecutor } from "./tool-use.js";
export type { VisionAdapter } from "./vision.js";
export type { EmbeddingAdapter } from "./embeddings.js";
export { getChatAdapter } from "./chat.js";
export { getToolUseAdapter } from "./tool-use.js";
export { getVisionAdapter } from "./vision.js";
export { getEmbeddingAdapter } from "./embeddings.js";

import { env } from "../config/env.js";

/** The "fast/cheap" model for the active provider — use for summarization, insights. */
export function chatModel(): string {
  return env.LLM_PROVIDER === "anthropic" ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
}

/** The "capable" model for the active provider — use for vision, agentic loops, complex generation. */
export function strongModel(): string {
  return env.LLM_PROVIDER === "anthropic" ? env.ANTHROPIC_STRONG_MODEL : env.OPENAI_STRONG_MODEL;
}

/** True when the active LLM provider has its API key configured. */
export function isLlmConfigured(): boolean {
  return env.LLM_PROVIDER === "anthropic"
    ? Boolean(env.ANTHROPIC_API_KEY?.trim())
    : Boolean(env.OPENAI_API_KEY?.trim());
}

/** Source label for extraction metadata — reflects active provider + mode. */
export function visionParserSource(): string {
  return env.LLM_PROVIDER === "anthropic"
    ? "anthropic-messages-vision"
    : "openai-chat-completions-json_schema";
}
