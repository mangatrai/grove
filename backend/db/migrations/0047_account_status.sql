ALTER TABLE financial_account
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  ADD COLUMN closed_at TIMESTAMPTZ;
