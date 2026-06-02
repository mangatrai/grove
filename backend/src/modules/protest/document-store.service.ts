import { qAll, qBegin, qExec, sqlBind } from "../../db/query.js";
import { embedBatch } from "./embedding.service.js";

const EMBED_BATCH_SIZE = 100;

export type DocumentChunkHit = {
  documentKey: string;
  chunkText: string;
  similarity: number;
};

export type DocumentListEntry = {
  documentKey: string;
  chunkCount: number;
};

export async function saveDocumentChunks(args: {
  householdId: string;
  propertyId: string;
  taxYear: number;
  documentKey: string;
  chunks: string[];
}): Promise<void> {
  const { householdId, propertyId, taxYear, documentKey, chunks } = args;
  if (chunks.length === 0) {
    await deleteDocumentChunks(propertyId, taxYear, documentKey);
    return;
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchEmbeddings = await embedBatch(batch);
    embeddings.push(...batchEmbeddings);
  }

  await qBegin(async (tx) => {
    const del = sqlBind(
      `DELETE FROM protest_document_chunks
        WHERE property_id = ? AND tax_year = ? AND document_key = ?`,
      [propertyId, taxYear, documentKey]
    );
    await tx.unsafe(del.text, del.values as never[]);

    for (let idx = 0; idx < chunks.length; idx += 1) {
      const ins = sqlBind(
        `INSERT INTO protest_document_chunks
           (household_id, property_id, tax_year, document_key, chunk_index, chunk_text, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?::vector)`,
        [
          householdId,
          propertyId,
          taxYear,
          documentKey,
          idx,
          chunks[idx],
          JSON.stringify(embeddings[idx]),
        ]
      );
      await tx.unsafe(ins.text, ins.values as never[]);
    }
  });
}

export async function deleteDocumentChunks(
  propertyId: string,
  taxYear: number,
  documentKey: string
): Promise<void> {
  await qExec(
    `DELETE FROM protest_document_chunks
      WHERE property_id = ? AND tax_year = ? AND document_key = ?`,
    propertyId,
    taxYear,
    documentKey
  );
}

export async function deleteAllChunksForProperty(propertyId: string, taxYear: number): Promise<void> {
  await qExec(
    `DELETE FROM protest_document_chunks WHERE property_id = ? AND tax_year = ?`,
    propertyId,
    taxYear
  );
}

export async function querySimilarChunks(args: {
  propertyId: string;
  taxYear: number;
  queryEmbedding: number[];
  topK?: number;
  minSimilarity?: number;
}): Promise<DocumentChunkHit[]> {
  const topK = args.topK ?? 5;
  const minSimilarity = args.minSimilarity ?? 0.65;
  const embeddingJson = JSON.stringify(args.queryEmbedding);

  const rows = await qAll<{
    document_key: string;
    chunk_text: string;
    similarity: number;
  }>(
    `SELECT document_key, chunk_text,
            1 - (embedding <=> ?::vector) AS similarity
       FROM protest_document_chunks
      WHERE property_id = ? AND tax_year = ? AND embedding IS NOT NULL
      ORDER BY embedding <=> ?::vector
      LIMIT ?`,
    embeddingJson,
    args.propertyId,
    args.taxYear,
    embeddingJson,
    topK
  );

  return rows
    .filter((r) => Number(r.similarity) >= minSimilarity)
    .map((r) => ({
      documentKey: r.document_key,
      chunkText: r.chunk_text,
      similarity: Number(r.similarity),
    }));
}

export async function listDocuments(propertyId: string, taxYear: number): Promise<DocumentListEntry[]> {
  const rows = await qAll<{ document_key: string; chunk_count: number }>(
    `SELECT document_key, COUNT(*)::int AS chunk_count
       FROM protest_document_chunks
      WHERE property_id = ? AND tax_year = ?
      GROUP BY document_key
      ORDER BY document_key`,
    propertyId,
    taxYear
  );
  return rows.map((r) => ({
    documentKey: r.document_key,
    chunkCount: Number(r.chunk_count),
  }));
}
