const CHUNK_WORDS = 300;
const OVERLAP_WORDS = 40;

export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + CHUNK_WORDS).join(" "));
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }
  return chunks.filter((c) => c.trim().length > 20);
}
