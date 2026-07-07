-- Migration 0081: household inbox email ingestion (FIX #215)
-- Dedicated household Gmail account, polled over IMAP (App Password), kept deliberately
-- separate from the per-parent Google OAuth integration (oauth_integrations) used for
-- Calendar/Drive — see ADMIN_GUIDE for rationale.

CREATE TABLE email_ingest_log (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id  TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  message_id    TEXT        NOT NULL,
  from_addr     TEXT,
  subject       TEXT,
  received_at   TIMESTAMPTZ,
  excerpt       TEXT,
  items_json    JSONB,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processed', 'ignored', 'error')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, message_id)
);

CREATE INDEX email_ingest_log_household ON email_ingest_log (household_id, created_at DESC);

-- Rendered alongside copy_paste_text on email-derived suggestion alerts: the ≤200-char verbatim
-- excerpt the extraction cited as support, so the user can sanity-check before approving.
ALTER TABLE family_agent_alerts
  ADD COLUMN IF NOT EXISTS source_quote TEXT;
