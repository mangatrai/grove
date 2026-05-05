CREATE TABLE recurring_merchant_override (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  display_name TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'dismissed')),
  amount_anchor NUMERIC(12,2),
  amount_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  tagged_by_user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant_key)
);
