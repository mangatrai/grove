-- 0022: Rich payslip extraction — payslip_line_item table + 7 new columns on payslip_snapshot
-- Captures every individual earnings/deduction row from LLM extraction as a queryable DB record.
-- New snapshot columns expose previously blob-only fields (taxable earnings, other info, hours YTD,
-- employment rate) as first-class columns.

ALTER TABLE payslip_snapshot
  ADD COLUMN taxable_earnings_current  NUMERIC,
  ADD COLUMN taxable_earnings_ytd      NUMERIC,
  ADD COLUMN other_information_current NUMERIC,
  ADD COLUMN other_information_ytd     NUMERIC,
  ADD COLUMN hours_or_days_ytd         TEXT,
  ADD COLUMN employment_rate           NUMERIC,
  ADD COLUMN employment_rate_type      TEXT;

COMMENT ON COLUMN payslip_snapshot.taxable_earnings_current  IS 'Taxable earnings section total — current period (e.g. IBM or Deloitte TAXABLE EARNINGS FED)';
COMMENT ON COLUMN payslip_snapshot.taxable_earnings_ytd      IS 'Taxable earnings section total — YTD';
COMMENT ON COLUMN payslip_snapshot.other_information_current IS 'Other Information section total — current (employer HSA, ESPP Discount, imputed income, etc.)';
COMMENT ON COLUMN payslip_snapshot.other_information_ytd     IS 'Other Information section total — YTD';
COMMENT ON COLUMN payslip_snapshot.hours_or_days_ytd         IS 'YTD hours or days worked; TEXT to match hours_or_days_current type';
COMMENT ON COLUMN payslip_snapshot.employment_rate           IS 'Base salary or hourly rate from employment_context.rate';
COMMENT ON COLUMN payslip_snapshot.employment_rate_type      IS 'Rate type: annual, biweekly, hourly, etc.';

CREATE TABLE payslip_line_item (
  id                     TEXT        NOT NULL PRIMARY KEY,
  payslip_snapshot_id    TEXT        NOT NULL REFERENCES payslip_snapshot(id) ON DELETE CASCADE,
  household_id           TEXT        NOT NULL REFERENCES household(id),
  section                TEXT        NOT NULL
    CHECK (section IN (
      'earnings',
      'pre_tax_deductions',
      'post_tax_deductions',
      'tax_deductions',
      'other_deductions',
      'other_information',
      'taxable_earnings'
    )),
  sort_order             INTEGER     NOT NULL DEFAULT 0,
  name                   TEXT,
  authority              TEXT,
  description            TEXT,
  date_start             TEXT,
  date_end               TEXT,
  date_raw               TEXT,
  hours_or_days_current  NUMERIC,
  hours_or_days_ytd      NUMERIC,
  rate                   NUMERIC,
  amount_current         NUMERIC,
  amount_ytd             NUMERIC,
  raw_section            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  payslip_line_item                        IS 'Individual line-item rows from payslip sections (earnings, deductions, taxes, etc.)';
COMMENT ON COLUMN payslip_line_item.section                IS 'Canonical section name — one of the 7 line_items keys in PayslipLlmExtract';
COMMENT ON COLUMN payslip_line_item.sort_order             IS 'Original array index in the LLM extract — preserves PDF row order for UI display';
COMMENT ON COLUMN payslip_line_item.raw_section            IS 'Visible section header from the PDF (e.g. "PRE-TAX DEDUCTION(S)") for display and debugging';

-- Primary access: all line items for a payslip ordered for display
CREATE INDEX idx_payslip_line_item_snapshot
  ON payslip_line_item (payslip_snapshot_id, section, sort_order);

-- Household-scoped queries for future cross-payslip analytics
CREATE INDEX idx_payslip_line_item_household
  ON payslip_line_item (household_id, section);
