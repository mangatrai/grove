-- Monthly budget per category per household.
-- One row per (household, category, month) — month stored as YYYY-MM text.
-- Global/builtin categories (category.household_id IS NULL) can be budgeted here;
-- the FK references category.id regardless of whether the category is global or custom.
CREATE TABLE budget_category (
  id           TEXT          PRIMARY KEY,
  household_id TEXT          NOT NULL REFERENCES household(id),
  category_id  TEXT          NOT NULL REFERENCES category(id),
  month        TEXT          NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, category_id, month)
);

CREATE INDEX idx_budget_category_household_month
  ON budget_category (household_id, month);
