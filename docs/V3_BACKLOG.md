# V3 Backlog — Design Notes & Feature Queue

This document tracks features, design decisions, and open questions for the v3 roadmap. Captures discussions during v2 live onboarding. No code changes yet — this is the planning record.

---

## Net Worth — Per-Account Balance History Chart (Expand-on-Click)

### Motivation
The net worth page shows household-level aggregate charts (total assets, liabilities, net worth over time) but nothing at the individual account level. Users can't see how a specific account moved over time without leaving the page.

### Proposed UX
Click on an account row in the net worth table → row expands inline to reveal a line chart showing that account's balance history. No modal/popup — inline expand keeps context. A second click collapses it. Only one account expanded at a time (or allow multiple — decide at implementation).

Chart: balance over time (monthly/quarterly depending on available snapshots). X-axis: date. Y-axis: balance. Simple Recharts `LineChart`. Show the data points that exist; no interpolation for missing months.

### Backend — already built
`GET /reports/balance-sheet/history?accountIds=<id>&interval=month&from=YYYY-MM&to=YYYY-MM` already accepts `accountIds` (up to 8 per request, comma-separated). The API returns per-account balance slices in `points[].accounts[]`. This is a **frontend-only feature** — no new API work needed.

See `reports.routes.ts` lines 99–194 and `balance-sheet.service.ts` `BalanceSheetHistoryAccountSlice` type.

### Edge cases to handle
- Account has only 1 or 2 snapshots — show a flat line or a "not enough data" placeholder
- Account has no snapshots at all — don't offer the expand (or show "No balance history yet")
- Real estate accounts — market value updates will be infrequent; chart still useful to show progression

### Implementation scope
- Frontend only: expand toggle on net worth table row, fetch `/reports/balance-sheet/history?accountIds=X` on first expand (lazy load), render Recharts LineChart
- No backend changes

---

## Real Estate / Property Accounts — Scope & Equity Linkage

### Scope (explicitly settled)
**In scope**: onboard a property as an asset account, enter current market value manually, link it to an existing mortgage/loan account, display equity inline in the net worth table.

**Out of scope (deferred indefinitely)**: rental income tracking, expense tracking, ROI calculation. The app is not a property management tool.

### How the math works (already correct)
If you add a real estate account (asset, e.g. $1.2M) and a mortgage account (liability, e.g. $790K), the net worth calculation already gives you the right answer — assets − liabilities. No special logic needed. The linkage is purely a **display/UX feature**, not a calculation requirement.

### What the linkage adds
Without it: the net worth table shows property and mortgage as unrelated rows. Users have to mentally do `$1.2M − $790K = $410K equity`.

With `linked_account_id` (mortgage → property):
```
Assets
  Primary Residence         $1,200,000
    └─ Mortgage            -$790,000        ← indented under property
    └─ Equity               $410,000        ← computed callout

Liabilities
  (mortgage excluded — already shown under its property)
```
The mortgage is shown nested under its property in the asset section and excluded from the standalone liabilities list to avoid double-counting in the display. The underlying math (assets − liabilities) doesn't change — just the presentation.

### Schema needed
```sql
-- Already planned in account enrichment migration:
linked_account_id TEXT REFERENCES financial_account(id) ON DELETE SET NULL

-- New type:
-- ALTER TABLE financial_account DROP CONSTRAINT financial_account_type_check;
-- ALTER TABLE financial_account ADD CONSTRAINT financial_account_type_check
--   CHECK (type IN ('checking','savings','credit_card','loan','mortgage',
--                   'investment','retirement','payslip','real_estate'));

-- property_use field (primary | rental | vacation):
property_use TEXT CHECK (property_use IN ('primary', 'rental', 'vacation'))
```

### Onboarding flow in UI

When user selects `type: Real Estate`, the account form changes:

- **Institution name** field becomes a display label only — pre-filled with "Real Estate" or "House". No need to enter a bank name.
- **Sub-type** (`property_use`) shown as a required toggle: `Primary` | `Rental` | `Vacation`.
- **Structured address fields** appear (hidden for all other account types), collected as separate inputs:
  - Street address
  - City
  - State
  - ZIP code
- **Link to mortgage/loan** — optional dropdown of existing loan/mortgage accounts in the household.
- User enters initial market value as a manual balance snapshot at creation time.
- Net worth table immediately shows equity callout if a mortgage is linked.

### Address storage and API identifier mapping

When the user saves the address, we do an **address lookup/validation call** against the chosen real estate API (RealtyAPI or similar). The API returns a canonical property identifier (a property ID or standardized address key unique to that listing in their system). We store:

```sql
-- Additional columns on financial_account for real_estate type:
property_address_json   TEXT   -- structured: { street, city, state, zip }
property_api_provider   TEXT   -- e.g. 'realtyapi' | 'freewebapi'
property_api_id         TEXT   -- canonical property ID from provider; used for subsequent valuation calls
```

The `property_api_id` is the key that makes monthly auto-updates cheap and reliable — no need to re-search by address each time, just hit the valuation endpoint with the stored ID.

If address validation/API lookup fails (API down, property not found), fall back to storing the raw address and flagging as manual-only until resolved.

### Balance updates — manual and automated

**Manual**: market value entered as a balance snapshot at any time. User always has full control.

**Automated**: monthly background job fetches latest valuation from the stored `property_api_id` and writes a new `account_balance_snapshot` row.

Candidate APIs (both have generous free tiers, include address search + valuation endpoints):
- https://www.realtyapi.io/
- https://freewebapi.com/data-apis/real-estate-api/#free-real-estate-api-getting-started

Implementation design:
- **Cadence**: monthly. Values don't move meaningfully week to week.
- **API key**: user-provided env var (e.g. `REALTY_API_KEY`). If absent, feature degrades gracefully to manual-only. No other functionality affected.
- **Balance source**: add `'api'` as a third value to `account_balance_snapshot.balance_source` (currently `'manual' | 'import'`). UI shows "Last updated by RealtyAPI · May 1" vs "Updated by you · Apr 15".
- **Scheduler**: follow `gdrive-scheduler.service.ts` pattern — periodic background job per household.
- **Override**: manual entry always takes precedence. User can also disable auto-fetch per account.
- **Per-account chart** (see above) makes the monthly progression immediately visible.

> Full implementation design to be worked through at build time. This section captures intent and key decisions made during grooming.

---

## Account Enrichment: Memo, Sub-type, Liquidity

### Motivation
The current `financial_account` schema has a `type` enum (`checking`, `savings`, `credit_card`, `loan`, `mortgage`, `investment`, `retirement`, `payslip`) that can't express important distinctions — HSA vs brokerage, 401k vs Roth IRA, primary home vs rental property. This creates problems for:
- AI insight context (no signal about what the account actually is)
- Net worth reporting (retirement and brokerage look the same today)
- Liquidity analysis (can't distinguish money accessible today vs money locked behind penalty)

### Proposed schema additions to `financial_account`

| Column | Type | Notes |
|---|---|---|
| `memo` | TEXT, nullable | Free-form user note. Fed into AI insights as account context. "HSA — maxing annually, treating as LT investment. Invested in VTSAX." |
| `sub_type` | TEXT, nullable | Descriptive sub-classification. Not enum-constrained — UI offers suggestions per type, memo covers the long tail. |
| `liquidity` | TEXT, CHECK ('liquid','semi_liquid','restricted'), nullable | Behavioral tag for reporting. Inferred from type as default but user-overridable. |
| `property_use` | TEXT, CHECK ('primary','rental','vacation'), nullable | Only meaningful for `real_estate` type accounts. |
| `linked_account_id` | TEXT, nullable, FK → financial_account(id) | Pairs a mortgage to its property. Used for home equity callout on net worth. |

### `liquidity` defaults by type

| Type | Default liquidity | Notes |
|---|---|---|
| checking, savings | `liquid` | Access today, no penalty |
| investment | `semi_liquid` | Days to settle; override to `restricted` for HSA, 529, ABLE |
| retirement | `restricted` | 401k, IRA, Roth — early withdrawal penalties |
| credit_card, loan, mortgage | N/A (liability) | Liquidity tag not shown for liabilities |
| real_estate | `restricted` | Can't liquidate without selling |

User can override — the critical case is HSA: it's `type: investment` but `liquidity: restricted` (non-medical withdrawals before 65 trigger 20% penalty + income tax).

### `sub_type` suggestions by type

These are UI suggestions only — not DB-enforced:

| Type | Suggested sub_types |
|---|---|
| retirement | 401k, 403b, traditional_ira, roth_ira, sep_ira, simple_ira |
| investment | brokerage, hsa, 529, able, crypto |
| savings | hysa, money_market, cd |
| loan | auto, personal, student |
| real_estate | (driven by `property_use` field instead) |

---

## HSA Accounts

### Design decision
Model HSA as:
- `type: investment`
- `sub_type: hsa`
- `liquidity: restricted`
- `memo`: "HSA — triple tax advantaged. Treating as LT investment. [investment strategy if applicable]"

### Why not a dedicated `hsa` type?
HSA is a hybrid (savings/investment/retirement-adjacent). A first-class type would need special-casing in many places. Modeling it as `investment + restricted + sub_type:hsa` is accurate and fits naturally into the net worth liquidity breakdown without schema proliferation.

### Financial context for AI insights
HSA has a triple tax advantage: pre-tax contributions, tax-free growth, tax-free withdrawal for qualified medical expenses. After 65 it behaves like a traditional IRA (taxed income on withdrawal, no penalty). Letting it grow untouched and paying medical expenses out-of-pocket in the interim is the optimal long-term strategy if cash flow allows. The memo + sub_type together give AI insights enough signal to contextualize this.

---

## 529 / 529A (ABLE) Accounts

### 529 (education savings)
- `type: investment`, `sub_type: 529`, `liquidity: restricted`
- Non-qualified withdrawals: income tax + 10% penalty on earnings
- SECURE 2.0: unused 529 can roll into Roth IRA (subject to limits) after 15 years

### 529A / ABLE Act (disability savings)
- `type: investment`, `sub_type: able`, `liquidity: restricted`
- Tax-advantaged savings for individuals with disabilities
- Memo: "ABLE Act 529A — [beneficiary name]"

Both are adequately modeled with the sub_type + liquidity approach. No dedicated types needed.

---

## Real Estate / Home Equity

### Model: two linked accounts

| Account | Type | Balance |
|---|---|---|
| Property (asset) | `real_estate` (new) | Current market value — manually entered or future Zillow/Zestimate feed |
| Mortgage (liability) | `mortgage` (existing) | Remaining loan balance |

Home equity = market value − mortgage balance. The net worth calculation already handles this correctly (assets − liabilities) if both accounts exist.

### New fields needed
- Add `real_estate` to the `type` CHECK constraint (new migration)
- `property_use: primary | rental | vacation` — tax treatment and reporting differ
- `linked_account_id` on `financial_account` (nullable FK, self-referential): links a mortgage to its property for equity callout display
- `memo`: address, purchase year, notes ("Primary residence — 3/2 in [city]")

### Net worth display
When a mortgage has a linked real_estate account, show a "Home equity" callout:
```
Primary Residence    $650,000
  Mortgage          -$420,000
  Equity             $230,000
```

### Rental property — extended feature (v3+ or v4)
Rental property introduces income tracking (rent received), expense tracking (maintenance, HOA, taxes, insurance), and ROI calculation. This is a significant feature thread beyond simple net worth modeling. Track separately; don't block real_estate type addition on it.

**For now in v3**: add the account type + equity display. Rental income tracking is its own backlog item.

---

## Net Worth — Liquidity Breakdown

### Current state
Balance sheet shows: total assets, total liabilities, net worth. All assets treated equally.

### Proposed v3 display

```
Net Worth:         $XXX,XXX
  Liquid:           $XX,XXX   (checking, savings — accessible today)
  Semi-liquid:      $XX,XXX   (brokerage — days to settle, capital gains apply)
  Restricted:       $XX,XXX   (retirement, HSA, 529, real estate — penalties to access early)
  Liabilities:     -$XX,XXX
```

The breakdown uses the `liquidity` field. Accounts with no `liquidity` set (or null) fall into an "Uncategorized" bucket to prompt the user to tag them.

### Why this matters
The financial planning question isn't just "what's my net worth" — it's "how much can I actually touch without triggering a tax event or penalty?" The liquidity breakdown answers that directly.

---

## Open Questions / Deferred

- **Rental income tracking**: link rent deposits to a rental property account; track expenses, ROI. Needs design work — v4 candidate.
- **Market value feeds**: Zillow/Zestimate API for real_estate auto-valuation. Nice to have, not blocking.
- **Roth vs Traditional IRA in reporting**: Roth withdrawals are tax-free in retirement, which changes the "real" value of a restricted asset. Could surface this in AI insights (not in numbers — too speculative). Deferred.
- **HELOC**: Home equity line of credit — hybrid liability (acts like credit_card, secured by home equity). Model as `credit_card` + `linked_account_id` → real_estate for now? Needs more thought.
- **Crypto**: `type: investment, sub_type: crypto` works. Liquidity is `semi_liquid` (exchange settlement + volatility). No dedicated type needed.
- **Employer match tracking**: 401k employer match context in AI insights (e.g., "you're contributing X%, employer matches up to Y% — are you leaving money on the table?"). Memo field for now.

---

## Migration sketch (when implementation begins)

```sql
-- 1. Add enrichment columns to financial_account
ALTER TABLE financial_account
  ADD COLUMN memo              TEXT,
  ADD COLUMN sub_type          TEXT,
  ADD COLUMN liquidity         TEXT CHECK (liquidity IN ('liquid', 'semi_liquid', 'restricted')),
  ADD COLUMN property_use      TEXT CHECK (property_use IN ('primary', 'rental', 'vacation')),
  ADD COLUMN linked_account_id TEXT REFERENCES financial_account(id) ON DELETE SET NULL;

-- 2. Add real_estate to type enum (Postgres requires recreating the CHECK constraint)
-- (migration approach: ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...)
```

See `backend/db/migrations/` for the numbered migration pattern to follow.

---

---

## Date of Birth — Encrypted at Rest, Age Computed in App

### Motivation
`person_profile` has an `age INTEGER` field (manual entry). Users must remember to update it every year. Storing DOB lets the app compute age automatically and keeps it accurate permanently. The LLM must never receive the raw DOB — only the computed integer age.

### Current state
`insight-prompt.service.ts` already passes `age: number | null` to the LLM (not DOB). The privacy boundary is already correct. The change is in *how* that number is sourced — from computed DOB instead of manual entry.

### Schema change
```sql
ALTER TABLE person_profile
  ADD COLUMN date_of_birth_encrypted TEXT;
-- Keep existing `age INTEGER` as nullable fallback (profiles without DOB set)
```

The existing `age` column is retained for backward compatibility. Profiles with `date_of_birth_encrypted` set use computed age. Profiles without it fall back to the stored `age` integer. Eventually manual `age` input is hidden in the UI when DOB is set.

### Encryption approach
Field-level AES-256-GCM — same pattern as `gdrive.service.ts` (oauth2_refresh_token). Key derived from `JWT_SECRET` via `crypto.scryptSync` (produces deterministic 32-byte key; no new env var required). Storage format: `iv(12) + authTag(16) + ciphertext` → base64 string.

The encrypted column stays in DB. The service layer decrypts it and computes the integer age. The raw DOB never appears in any API response.

### API surface — privacy contract
- **Write**: `PATCH /household/members/:id` accepts `dateOfBirth: "YYYY-MM-DD"` → service encrypts → stored
- **Read**: All profile API responses return `hasDob: boolean` and computed `age: number | null`. The raw date is never returned.
- **UI**: Date picker to set DOB. Once set, age field becomes read-only + auto-computed. User can clear DOB (sets column to NULL, age returns to manual input mode).

### Age calculation (service layer)
```typescript
function ageFromDob(dobIsoDate: string): number {
  const dob = new Date(dobIsoDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
```
Computed fresh on every profile read. No staleness. Correct on birthday automatically.

### Export / restore
DOB is **excluded from `.hfb` exports**. PII that is encrypted with a household-specific key derived from `JWT_SECRET` cannot be meaningfully transported to a different instance. Users re-enter DOB after restore on a new instance. A restore completion notice should say: "Date of birth for each person profile must be re-entered." This is the correct privacy-preserving behavior.

### Scope note
Applies to all `person_profile` rows — head of household, spouse, dependents. Each row has its own `date_of_birth_encrypted`. The insight prompt already handles head + spouse separately; no structural change needed there, only the source of the `age` value.

---

*Last updated: 2026-05-07. Discussion: v2 live onboarding session.*
