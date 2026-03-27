-- Epic 5.1 MVP: household-managed category rules + explainability metadata.

CREATE TABLE IF NOT EXISTS category_rule (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (category_id) REFERENCES category(id)
);

CREATE INDEX IF NOT EXISTS idx_category_rule_household_priority
  ON category_rule (household_id, enabled, priority, created_at);

ALTER TABLE transaction_canonical
ADD COLUMN classification_meta TEXT;
