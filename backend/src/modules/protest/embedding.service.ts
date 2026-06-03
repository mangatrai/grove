import OpenAI from "openai";

import { env } from "../../config/env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: text.slice(0, env.EMBEDDING_MAX_INPUT_CHARS),
  });
  return res.data[0]!.embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: texts.map((t) => t.slice(0, env.EMBEDDING_MAX_INPUT_CHARS)),
  });
  return res.data.map((d) => d.embedding);
}
