import { env } from "../../config/env.js";
import { getEmbeddingAdapter } from "../../llm/index.js";

export async function embedText(text: string): Promise<number[]> {
  const adapter = getEmbeddingAdapter();
  const results = await adapter.embed(
    [text.slice(0, env.EMBEDDING_MAX_INPUT_CHARS)],
    env.EMBEDDING_MODEL
  );
  return results[0]!;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const adapter = getEmbeddingAdapter();
  return adapter.embed(
    texts.map((t) => t.slice(0, env.EMBEDDING_MAX_INPUT_CHARS)),
    env.EMBEDDING_MODEL
  );
}
