import { env } from "../config/env.js";
import { openaiEmbed } from "./providers/openai.js";

export interface EmbeddingAdapter {
  embed(texts: string[], model: string): Promise<number[][]>;
}

const openaiAdapter: EmbeddingAdapter = { embed: openaiEmbed };

export function getEmbeddingAdapter(): EmbeddingAdapter {
  // EMBEDDING_PROVIDER controls embedding provider independently of LLM_PROVIDER,
  // since embeddings often use a different vendor (Voyage AI, Cohere, etc.).
  // Only OpenAI is implemented today; add new providers here when needed.
  if (env.EMBEDDING_PROVIDER !== "openai") {
    throw new Error(`Unsupported EMBEDDING_PROVIDER: ${env.EMBEDDING_PROVIDER}. Only "openai" is supported.`);
  }
  return openaiAdapter;
}
