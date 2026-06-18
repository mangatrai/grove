import { env } from "../../config/env.js";

const OVERLAP_WORDS = 40;

export function chunkText(text: string): string[] {
  const chunkWords = env.RAG_CHUNK_WORDS;
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkWords).join(" "));
    i += chunkWords - OVERLAP_WORDS;
  }
  return chunks.filter((c) => c.trim().length > 20);
}
