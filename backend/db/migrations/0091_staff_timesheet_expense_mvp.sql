-- Migration 0091: Household staff (nanny/employee) timesheet + expense MVP
-- Scope: onboarding, weekly timesheet, expense claims, approval, pay summary.
-- Explicitly out of scope this pass: tax withholding, FLSA overtime, compliance calendar
-- (full version is epic #121 / PY-1..PY-9, milestone V7 — untouched by this migration).

ALTER TABLE app_user DROP CONSTRAINT app_user_role_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'staff'));

CREATE TABLE staff_profile (
  id                    TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id          TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_profile_id     TEXT        NOT NULL UNIQUE REFERENCES person_profile(id) ON DELETE CASCADE,
  employment_start_date TEXT        NOT NULL,
  regular_schedule_json TEXT        NOT NULL DEFAULT '{}',
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_profile_household ON staff_profile (household_id);

CREATE TABLE staff_rate (
  id                TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id      TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  staff_profile_id  TEXT        NOT NULL REFERENCES staff_profile(id) ON DELETE CASCADE,
  hourly_rate_cents INTEGER     NOT NULL CHECK (hourly_rate_cents > 0),
  effective_date    TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_rate_staff_effective ON staff_rate (staff_profile_id, effective_date);

CREATE TABLE timesheet_period (
  id                  TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id        TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  staff_profile_id    TEXT        NOT NULL REFERENCES staff_profile(id) ON DELETE CASCADE,
  week_start_date     TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at        TIMESTAMPTZ,
  reviewed_by_user_id TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_profile_id, week_start_date)
);

CREATE INDEX idx_timesheet_period_household_status ON timesheet_period (household_id, status);

CREATE TABLE timesheet_entry (
  id                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  timesheet_period_id  TEXT        NOT NULL REFERENCES timesheet_period(id) ON DELETE CASCADE,
  work_date            TEXT        NOT NULL,
  hours_worked         NUMERIC(4,2) NOT NULL CHECK (hours_worked > 0 AND hours_worked <= 24),
  note                 TEXT,
  UNIQUE (timesheet_period_id, work_date)
);

CREATE TABLE staff_expense (
  id                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  staff_profile_id     TEXT        NOT NULL REFERENCES staff_profile(id) ON DELETE CASCADE,
  expense_date         TEXT        NOT NULL,
  category              TEXT       NOT NULL,
  amount_cents          INTEGER    NOT NULL CHECK (amount_cents > 0),
  description           TEXT,
  status                TEXT       NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id    TEXT       REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at            TIMESTAMPTZ,
  review_note            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_expense_household_status ON staff_expense (household_id, status);

CREATE TABLE staff_pay_adjustment (
  id                TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id      TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  staff_profile_id  TEXT        NOT NULL REFERENCES staff_profile(id) ON DELETE CASCADE,
  adjustment_date   TEXT        NOT NULL,
  amount_cents      INTEGER     NOT NULL,
  reason            TEXT        NOT NULL,
  created_by_user_id TEXT       REFERENCES app_user(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_pay_adjustment_staff ON staff_pay_adjustment (staff_profile_id);
