# V4 Backlog — Design Notes

Design decisions, schema specs, and open questions for V4 features. Authoritative status in `docs/V4_PLAN.md`.

---

## Notification System (F-1)

### Overview

Bell icon in `AppTopBar` with unread badge. Click opens a dropdown notification panel. Settings → Notifications tab (currently a placeholder at `SettingsPage.tsx:1577`) becomes functional. Per-user, per-type preferences for in-app and email delivery.

### Database

```sql
-- Migration: 0047_v4_notifications.sql

CREATE TABLE notification (
  id          TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES app_user(id) ON DELETE CASCADE,  -- NULL = all household members
  type        TEXT NOT NULL,  -- see enum below
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  action_url  TEXT,           -- relative path to navigate to on click
  read_at     TIMESTAMPTZ,    -- NULL = unread
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_household_user ON notification(household_id, user_id, read_at, created_at DESC);

CREATE TABLE notification_preference (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  enabled_email     BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_inapp     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, notification_type)
);
```

### Notification types (enum)

| Type | Trigger | Default email | Default in-app |
|------|---------|--------------|----------------|
| `export_ready` | Export job completes | ✓ (already sends email) | ✓ |
| `restore_complete` | Household restore finishes | ✓ | ✓ |
| `backup_complete` | Google Drive backup succeeds | ✗ | ✓ |
| `backup_failed` | Google Drive backup fails | ✓ | ✓ |
| `property_valuation_updated` | Monthly auto-valuation scheduler fires | ✗ | ✓ |
| `budget_threshold_80` | Category spend reaches 80% of monthly budget | ✗ | ✓ |
| `budget_threshold_100` | Category spend reaches or exceeds 100% of budget | ✓ | ✓ |
| `large_transaction` | A transaction exceeds the household `large_txn_threshold_usd` setting | ✗ | ✓ |

**Future phase (not V4):** `monthly_digest` — monthly summary email.

### API routes

```
GET  /notifications                → list (unread first, max 50, incl. last 10 read)
GET  /notifications/unread-count   → { count: number }  (polled every 60s)
PATCH /notifications/:id/read      → mark single as read
POST /notifications/read-all       → mark all as read for this user
GET  /notifications/preferences    → array of NotificationPreference
PUT  /notifications/preferences    → bulk update preferences
```

### `createNotification` helper

All notification creation goes through a single service function so email + in-app can be dispatched together per the user's preferences:

```typescript
// backend/src/modules/notifications/notification.service.ts
export async function createNotification(opts: {
  householdId: string;
  userId?: string;          // omit for broadcast to all household members
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string;
}): Promise<void>
```

Called from:
- `export-job.service.ts` → `export_ready` (replaces direct `sendExportReadyEmail` call; email still sent via mailer if preference enabled)
- `import-household-bundle.service.ts` → `restore_complete`
- `gdrive-backup.service.ts` → `backup_complete` / `backup_failed`
- `realty-api.service.ts` scheduler → `property_valuation_updated`
- `import-session.service.ts` finalize → `budget_threshold_80` / `budget_threshold_100` (check after canonicalize)
- `canonical-ingest.service.ts` → `large_transaction` (check against `large_txn_threshold_usd` on insert)

### Budget threshold check

On import session finalize (after canonicalization), compute current-month actuals per category and compare against `budget_category` rows. Fire `budget_threshold_80` if a category crosses 80% (once per month per category — check `notification` for existing un-dismissed entry). Fire `budget_threshold_100` when 100% is breached.

`large_txn_threshold_usd` is a new column on the `household` table (nullable; feature disabled when NULL).

### Frontend

**`AppTopBar.tsx`:**
- Bell icon (`IconBell`) with a red badge showing unread count (max "99+")
- Polls `GET /notifications/unread-count` every 60 seconds when page is active
- Click opens `NotificationPanel` as a `Popover` or `Drawer` (mobile)

**`NotificationPanel.tsx` (new component):**
- List of last ~50 notifications (unread first, then recent read with dimmed style)
- Each row: icon (type-specific), title, body, time-ago, action link if present
- "Mark all read" button
- "Notification settings →" link to Settings → Notifications tab

**`SettingsPage.tsx` Notifications tab (replace placeholder):**
- Toggle grid: rows = notification types, columns = In-App / Email
- Master email enable/disable toggle at top
- Saved to `PUT /notifications/preferences`

### Open questions for grooming

- [ ] Should `large_txn_threshold_usd` appear in Settings → Household alongside the savings target slider?
- [ ] For budget threshold: check at canonicalize time or at finalize time? (finalize is cleaner; fewer partial-import false alerts)
- [ ] Notification retention: auto-delete after 90 days? Or user-managed?
- [ ] When `user_id` is NULL (household broadcast), does each member get their own `read_at`? Or a single shared row? (Per-user row is simpler for read state tracking; overhead is low for 2-4 users)

---

## Payslip Enhancement Pass (F-3)

### PS-1: Month-over-month delta badges

**Service change:** Add `getPriorPayslip(personProfileId, currentPayPeriodEnd)` to `payslip.service.ts`. Query:
```sql
SELECT id, net_pay, gross_pay, tax_deductions_json, pre_tax_deductions_json
FROM payslip_snapshot
WHERE person_profile_id = ? AND pay_period_end < ?
ORDER BY pay_period_end DESC
LIMIT 1
```

**Response addition:** Include `priorPayslip: { net, gross, totalTax, totalPreTaxDeductions } | null` in `GET /payslips/:id`. Frontend computes deltas inline.

**UI:** Below each headline figure in the payslip detail header section, render a small `<DeltaBadge>` component:
- ↑ green for net/gross improvement (higher is better)
- ↓ red for net/gross decrease
- ↑ red for tax increase (more withheld = worse for take-home)
- "—" when delta is zero or prior payslip unavailable

### PS-2: Investment contribution grouping

Line items already extracted by LLM into `payslip_line_items` with `item_category = 'pre_tax_deduction'` and names like "401(k)", "ESPP", "HSA Employee", "Dental". Group by contribution bucket:

| Bucket | Matches |
|--------|---------|
| Retirement | 401k, 403b, 457, Roth 401k, pension, SIMPLE IRA |
| Equity | ESPP, RSU, stock purchase |
| Health | HSA, FSA, DCFSA, HRA, dental, vision, medical |
| Other | everything else in pre_tax_deduction |

Display as a collapsed "Pre-tax contributions" section in the payslip detail page, grouping items under these buckets with a subtotal per bucket and a grand total.

**YTD totals:** For a selected person, query all payslips in the same calendar year and sum each bucket. Show as a sidebar "YTD contributions" card on the detail page.

### PS-3: Savings / wealth-building rate

Per payslip: `pre_tax_contributions / gross_pay`. Running YTD rate across the pay year: `sum(pre_tax_contributions_ytd) / sum(gross_pay_ytd)`.

Display as a single KPI on the payslip detail page: "X% of gross to pre-tax savings this period / Y% YTD".

This is pure derivation from already-extracted data — no LLM changes, no schema changes.

### PS-4: Tax sufficiency signal

Annualise withholding: `(federal_withheld_ytd / gross_ytd) × 100`. Compare against 20% general benchmark. If annualised rate < 20% federal, show a subtle `Alert` (info, not error):

> "Your annualised federal withholding rate is X%. Consider reviewing your W-4 if your effective tax rate is typically higher."

**Not built:** Full tax liability calculation (requires filing status, deductions, credits, state-specific rules). This is a data signal only.

**Dependency:** Reliable `federal_income_tax` extraction in `tax_deductions_json`. Verify IBM + Deloitte parse quality before shipping PS-4.

---

## Balance Sheet Member Subtotals (F-2)

### Backend change

`GET /reports/balance-sheet` already loads all accounts with their latest `account_balance_snapshot` values. Add an aggregation step at the end of `getBalanceSheet`:

```typescript
// Group accounts by owner_person_profile_id
// For each person: sum asset accounts, sum liability accounts
// Include a "Shared / Household" row for accounts with no owner
const memberSummary: MemberSummaryRow[] = people.map(person => ({
  personProfileId: person.id,
  name: person.name,
  totalAssets: ...,
  totalLiabilities: ...,
  netWorth: ...
}));
```

Add `memberSummary` to the balance sheet response type. Only populated when household has 2+ person profiles.

### Frontend change

Add a collapsible "Household Breakdown" section at the bottom of `NetWorthPage.tsx`:

```
┌────────────────────────────────────────────────────────────┐
│  Household Breakdown                              ▾         │
├─────────────────────┬──────────┬─────────────┬────────────┤
│ Member              │ Assets   │ Liabilities │ Net Worth  │
├─────────────────────┼──────────┼─────────────┼────────────┤
│ Household Total     │ $820,000 │ $312,000    │ $508,000   │
│ Mangat              │ $600,000 │ $280,000    │ $320,000   │
│ Spouse              │ $220,000 │ $32,000     │ $188,000   │
│ Shared              │ $0       │ $0          │ $0         │
└─────────────────────┴──────────┴─────────────┴────────────┘
```

Collapsed by default. Only renders when `memberSummary.length > 1`. Numbers match the existing filter perspective when user switches to per-member view.

---

## Playwright E2E Spike (I-8)

### Spike goals

1. Prove Playwright works with this stack (Vite dev server + Express + Postgres in Docker)
2. Establish test data isolation pattern (dedicated test user, cleanup in `afterAll`)
3. Write 4 specs covering the most regression-prone flows
4. Decide: run locally only or add to `npm test`?

### Initial 4 specs

| Spec | What it covers |
|------|---------------|
| `auth.spec.ts` | Sign in → forced password change → access home page |
| `import.spec.ts` | Create session → upload CSV → bind account → parse → canonicalize → finalize |
| `ledger.spec.ts` | Filter transactions → assign category inline → verify aggregate strip updates |
| `networth.spec.ts` | Add balance snapshot → verify it appears in chart + KPI tiles |

### Setup

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    // auth state reuse via storageState
  },
  webServer: [
    { command: 'npm run dev -w backend', url: 'http://localhost:4000/health' },
    { command: 'npm run dev:frontend', url: 'http://localhost:3000' }
  ]
});
```

### Open decisions

- [ ] Test database: same Docker Compose Postgres or separate test DB?
- [ ] Seed data: use `npm run db:seed:dev` or write Playwright fixtures?
- [ ] CI: local-only for now (no GitHub Actions); add later if spike proves value
- [ ] Screenshot/trace on failure: yes by default in Playwright; store in `.playwright-results/`

---

## Fuzzy Match Categorization (I-9)

### Problem

Exact-regex rules miss merchant names with trailing codes: `AMAZON.COM*AB12CD`, `WHOLEFDS #0521 MANHATTAN`, `NETFLIX.COM123456789`. Users have to create multiple rules or leave these as Unknown.

### Approach

After exact rules fail:
1. Normalize the transaction description: uppercase, strip trailing alphanumeric codes after `*` / `#` / space+digits, collapse whitespace.
2. Look up normalized form in a `merchant_memory` table (populated by confirmed categorizations).
3. If exact normalized match: use stored category.
4. If no exact match: compute Jaro-Winkler similarity against all known normalized merchant names for this household.
5. If highest similarity > threshold (suggest 0.85): use that category.
6. Below threshold: Unknown (no false positives).

```sql
-- New table (or extend category_rule)
CREATE TABLE merchant_memory (
  id          TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  normalized_merchant TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES category(id),
  source      TEXT NOT NULL,  -- 'user_assign' | 'rule_match' | 'import'
  match_count INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, normalized_merchant)
);
```

Normalization function lives in `backend/src/modules/category/merchant-normalize.ts`. Called by canonical ingest and by the Tier B fuzzy classifier.

### Open questions

- [ ] Threshold: 0.85 is conservative — validate against a sample of real transactions before settling
- [ ] Should this be a Settings toggle ("Fuzzy categorization: on/off")? Probably yes, so power users can disable it if they see false positives
- [ ] When a fuzzy match fires, should it create a rule automatically, or just categorize silently? (Recommendation: categorize silently, increment `match_count`; let the existing rule-learning flow propose the rule if threshold crossed)

---

*Last updated: 2026-05-15.*
