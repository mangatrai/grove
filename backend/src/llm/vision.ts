import { env } from "../config/env.js";
import { openaiVision } from "./providers/openai.js";
import { anthropicVision } from "./providers/anthropic.js";
import type { VisionMessage, VisionCompletionOptions, LlmUsage } from "./types.js";

export interface VisionAdapter {
  complete(messages: VisionMessage[], options: VisionCompletionOptions): Promise<{ content: string; usage: LlmUsage }>;
}

const openaiAdapter: VisionAdapter = { complete: openaiVision };
const anthropicAdapter: VisionAdapter = { complete: anthropicVision };

export function getVisionAdapter(): VisionAdapter {
  return env.LLM_PROVIDER === "anthropic" ? anthropicAdapter : openaiAdapter;
}
