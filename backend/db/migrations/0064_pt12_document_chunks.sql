-- PT-12: pgvector document store + conversation summarization columns
-- Requires pgvector extension (pgvector/pgvector:pg18 Docker image locally;
-- Koyeb managed Postgres / Neon supports CREATE EXTENSION vector natively).

CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunk store: holds chunked + embedded text for all protest-related documents
-- (CAD evidence PDF, arbitrary uploaded PDFs/images) per property+year.
CREATE TABLE IF NOT EXISTS protest_document_chunks (
  id              BIGSERIAL PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES household(id)         ON DELETE CASCADE,
  property_id     TEXT NOT NULL REFERENCES property(id)          ON DELETE CASCADE,
  tax_year        INT  NOT NULL,
  document_key    TEXT NOT NULL,  -- 'cad_evidence' | 'file:<filename>' | 'image:<filename>'
  chunk_index     INT  NOT NULL,
  chunk_text      TEXT NOT NULL,
  embedding       vector(1536),   -- text-embedding-3-small (1536 dims)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, tax_year, document_key, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pdc_property_year
  ON protest_document_chunks (property_id, tax_year);

-- HNSW index for fast approximate cosine similarity search.
-- Build after bulk inserts; if missing, falls back to exact scan (slower but correct).
CREATE INDEX IF NOT EXISTS idx_pdc_embedding_hnsw
  ON protest_document_chunks USING hnsw (embedding vector_cosine_ops);

-- Rolling summarization support on the worksheet
ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS summarization_cursor   INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversation_summary   TEXT,        -- rolling summary of turns 0..cursor-1
  ADD COLUMN IF NOT EXISTS cycle_summary          TEXT;        -- generated on protest close; injected next year
