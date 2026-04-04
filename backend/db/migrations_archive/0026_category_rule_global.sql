-- Global default category rules table (data: seeds/0002_seed_category_rule_global.sql).
CREATE TABLE IF NOT EXISTS category_rule_global (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL,
  amount_scope TEXT NOT NULL CHECK (amount_scope IN ('any', 'credit_only', 'debit_only')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES category(id)
);

CREATE INDEX IF NOT EXISTS idx_category_rule_global_enabled_priority
  ON category_rule_global (enabled, priority, datetime(created_at), id);
