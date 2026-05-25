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

## Property Tax Protest Assistant (PT-1) — Feature Capture

**Status:** Deferred — not yet groomed. Captured 2026-05-15. Enough detail to pick up and run.

### The problem

Every year in Texas, county appraisal districts (CADs) send a Notice of Appraised Value. If the assessed value is too high, the property owner has a right to protest to an Appraisal Review Board (ARB). Building a strong protest case requires gathering evidence — comparable sales, unequal appraisal data, subject property details — from multiple sources. Today this is entirely manual: searching Redfin, pulling CAD records for comps, formatting evidence packets.

The app already holds most of the Redfin data needed for a market value argument. The gap is:
1. We don't pull the subject property's own physical characteristics from Redfin (only comp characteristics)
2. We have no CAD data integration (assessed values for neighboring properties)
3. No workflow to assemble evidence or judge whether to protest

### User context (captured 2026-05-15)

- **Denton County hearing: June 8, 2026 (~3 weeks out).** This year's protest may need to be manual given build time, but the feature could serve as real-world validation if buildable in time. Next year: fully prepared.
- **Current Denton protest:** Filed on unequal appraisal grounds primarily, with market value comps as backup. Asking for $994k assessed value; CAD may counter at $1,080k; goal is to land ~$1,020k. Needs strong evidence for both strategies.
- **Rental properties in Memphis, TN (Shelby County Assessor)** — different state, completely different appeals process. User noted LLM intelligence could bridge multi-state differences (see "LLM vs. feature" section below).
- This is an annual recurring workflow (Texas: notices ~April, deadline ~May 31, hearings June–August; Tennessee: different calendar)

### Reference services (for feature inspiration)

- **ownwell.com** — fully managed ARB service; collects property data, builds case, files protest, appears at hearing, charges % of tax savings (~25-35%). Aggregates multi-county CAD roll data + MLS sold data + equity comps (what CAD assessed similar properties at).
- **bezit.co** — similar model. Automated data collection, case building, filing, and hearing representation.

**What these tell us:** The key data they use is (1) county appraisal roll data for equity comps (unequal appraisal), (2) MLS sold data for market value comps, and (3) subject property CAD characteristics. We're not trying to automate the filing or hearing — just give the user the same quality of data to prepare themselves.

### What we already store (current `valuation_detail_json`)

```typescript
ValuationDetail {
  fetchedAt, source,
  estimate, estimateRange,          // Redfin AVM
  lastSold: { date, price, disclosed },
  taxCurrent: { year, assessedValue, landValue, improvementValue, taxesDue },
  taxHistory: [{ year, assessedValue, taxesDue }],
  comps: [{ address, city, state, zip, sqft, beds, baths, yearBuilt,
            lotSqft, listPrice, soldPrice, soldDate, pricePerSqft }]  // up to 6
}
```

**Gap in current extraction:** We parse sqft/beds/baths/yearBuilt/lotSqft for comps but NOT for the subject property itself. The subject property's physical facts are in the same Redfin response (`/detailsbyaddress`) — they're just not extracted. Critical for ARB because you need to show your home's characteristics vs. the comps.

**AVM endpoint (`/avm/estimate`) finding:** Checked the raw response at `data/apis/redfin-avm-estimate.json`. This endpoint returns only 6 comps (same limit as `/detailsbyaddress`) in the same positional `$ref`-encoded format. No additional tax data or subject property facts. No gain from switching to this endpoint for ARB purposes — continue using the full property details call.

### Texas ARB mechanics (product context)

Texas property owners have two protest grounds (can use both simultaneously):

**1. Market value argument**
> "The CAD's assessed value exceeds fair market value."

Evidence: recent sold comps within 1 mile, similar size/age/condition, sold within 12 months. The app already has this via Redfin comps. Need to frame as: "Similar homes sold for $X–$Y; my CAD assessment of $Z is above market."

**2. Unequal appraisal argument (often stronger)**
> "Similar nearby properties are appraised at a lower per-sqft rate than mine."

Evidence: pull the CAD's own assessed value for neighboring properties with similar characteristics. If your effective tax rate per sqft is higher than theirs, you have an unequal appraisal case regardless of market value.
This requires: knowing each comp's full address (we have this) → looking up that address in the CAD database → getting the CAD's assessed value and sqft for that property → computing the effective rate.

The unequal appraisal argument is procedurally harder to prepare but the county cannot easily refute their own numbers.

### LLM agent vs. built feature

The user asked whether this should be a Claude scheduled job/skill rather than a built feature. Recommendation: **both, layered.**

- **Built feature (required):** Data plumbing, persistent storage, annual tracking, protest history. You can't run an LLM analysis without structured data to feed it. The collection, storage, and UI are the feature.
- **LLM analysis layer (additive):** A "Generate protest strategy" button — similar to the existing AI Financial Health dashboard — that feeds the collected CAD + comp data to an LLM and returns: case strength assessment, which comps are strongest, suggested target value range, and a draft argument for the hearing. Cached per protest cycle.
- **A standalone Claude Code skill won't work** because it has no persistent access to the property data, protest history, or CAD records. The data infrastructure has to be in the app.

For **multi-state properties (Memphis, TN):** Tennessee has a completely different appeals process (Shelby County Board of Equalization, different deadlines, different evidence standards). Rather than hardcoding state-specific rules, the LLM layer can adapt: feed it the property details + CAD data + state/county context and let it reason about the right strategy. This is where LLM intelligence genuinely helps bridge multi-state differences without building per-state rule engines.

### CAD data landscape

#### Texas (Denton County — DCAD)

- **Portal:** `denton.prodigycad.com/property-search` — address-based search
- **Property detail URL:** `denton.prodigycad.com/property-detail/{propertyId}/{year}`
  - Example: `denton.prodigycad.com/property-detail/560912/2026`
  - The `{propertyId}` is the DCAD internal ID — not the same as Redfin's propertyId
  - **Unknown: how to look up DCAD propertyId by address programmatically.** The portal search may return this ID in the results HTML/JSON — needs investigation.
- **Data lag:** Denton CAD has significant lag in sharing 2026 appraisal data with Redfin/Zillow. The only source with current-year appraisal values is the DCAD portal itself. Texas Comptroller data also lags.
- **Approach for unequal appraisal:** For each Redfin comp address, search DCAD portal → get propertyId → fetch property detail page → extract CAD assessed value + sqft. This needs ~10 lookups per protest cycle per property.

**Other Texas counties:**

| County | Portal | Notes |
|--------|--------|-------|
| Harris (Houston) | hcad.org | Best-in-class; has API and bulk download |
| Travis (Austin) | traviscad.org | Annual roll CSV |
| Bexar (San Antonio) | bcad.net | Web portal |
| Dallas | dallascad.org | Web portal + CSV |

**Texas Comptroller:** Annual ratio studies and county-level summaries only — not parcel-level, and significant lag. Not useful for current-year ARB.

**Third-party aggregators:** PropertyShark, iOwn.com aggregate multi-county CAD data. Some offer APIs. Viable alternative to per-county scrapers if a paid tier is acceptable.

#### Tennessee (Shelby County — Memphis)

- **Assessor portal:** `assessormelvinburgess.com`
- **Property search:** `assessormelvinburgess.com/PropertySearch` (by owner name or parcel ID)
- **Property detail:** `assessormelvinburgess.com/propertyDetails?parcelid={parcelId}&IR=true`
  - Example: `assessormelvinburgess.com/propertyDetails?parcelid=073053%20%2000028&IR=true`
- **Appeals process:** `assessormelvinburgess.com/content?key=Appeals_Process` (different from Texas ARB — Shelby County Board of Equalization)
- Owner search works: `assessormelvinburgess.com/realPropertyDetails?FirstName=Mangat&LastName=Rai&active=owner&Page=property` — this is how to find your own parcel IDs

### Feature vision

A **Property Tax Protest Worksheet** per property, surfaced on the property detail view (Net Worth → Real Estate → [Property]):

**Section 1: Should I protest? (automated signal)**
- CAD assessed value (from `taxCurrent.assessedValue`) vs. Redfin AVM (`estimate`)
- If assessed > AVM by more than X% (configurable, default 5%): "Protest recommended" flag
- If assessed < AVM: "No protest benefit likely"
- Current year assessment trend: +X% vs. prior year (from `taxHistory`)
- Estimated tax savings if reduced to market value: `(assessedValue - AVM) × taxRate` (tax rate derivable from `taxCurrent.assessedValue` / `taxCurrent.taxesDue`)

**Section 2: Market value evidence**
- Subject property: address, sqft, beds, baths, year built, AVM
- Comp table: address, sqft, beds, baths, sold price, sold date, price/sqft
- "Adjusted market value" estimate: median of comp prices, weighted by similarity score (sqft delta, age delta)
- "My AVM vs. comp evidence range: $X–$Y vs. CAD assessed $Z"

**Section 3: Unequal appraisal evidence (requires CAD data integration)**
- For each Redfin comp address → look up that address's CAD assessed value + sqft
- Compute "effective assessment rate" per sqft for each comp (CAD assessed / sqft)
- Compare to subject property's effective rate
- Flag if subject rate > median comp rate by more than X%
- Output table: address, CAD assessed, sqft, $/sqft assessed, delta from subject

**Section 4: Protest tracker**
- Status: Not filed / Filed (date) / Informal hearing (date, outcome) / ARB hearing (date) / Resolved
- CAD notice value, informal offer (if any), final settled value, tax savings
- Annual history across prior years

**Section 5: Evidence packet export (future)**
- Generate a formatted PDF: property summary, comp table, unequal appraisal table, supporting notes
- Most Texas ARBs accept PDF evidence uploaded to their portal or presented at hearing

### Subject property data extraction gap (quick fix to do now)

The Redfin API response for `/detailsbyaddress` includes the subject property's own facts in `details.aboveTheFold` or the facts array. We need to extract and store:
- `subjectSqft`, `subjectBeds`, `subjectBaths`, `subjectYearBuilt`, `subjectLotSqft`

These should be added to `ValuationDetail` and extracted in `parseRedfinResponse`. **This is a small isolated change** that should be done before the full ARB feature so the data is being accumulated with each monthly refresh.

**File:** `backend/src/modules/household/realty-api.service.ts`

### CAD data integration options (decision needed before building)

| Option | Pros | Cons |
|--------|------|------|
| **A: Per-county scraper** | Free, direct from source | Fragile (HTML layout changes), legal gray area, must build per county |
| **B: Third-party API** (PropertyShark, iOwn, or similar) | Multi-county, API-stable, maintained | Cost, API key dependency, another external service |
| **C: Manual CAD notice import** | No integration needed; user enters CAD value from their notice | Requires manual data entry; no unequal appraisal capability |
| **D: Texas Comptroller bulk data** | Free, official, covers all counties | Annual cadence (not real-time), aggregate only (not parcel-level) |

Recommendation for first build: **Option C** (manual entry of CAD noticed value) to unlock the "should I protest" signal and market value argument, with **Option A or B** as a follow-on for unequal appraisal. DCAD specifically may be scriptable — worth a one-time investigation.

### Open questions — all answered (2026-05-15)

- ✓ **Timeline:** June 8 hearing; may do manually this year; build for next year (or rush for June 8 validation)
- ✓ **Rental locations:** Memphis TN (Shelby County) — confirmed different state/process
- ✓ **Protest strategy:** Hybrid — unequal appraisal primary + market value comps as backup; need both
- ✓ **CAD data:** Manual own property, automation needed for ~10 comp properties; DCAD has a real JSON API (see below)
- ✓ **AVM endpoint:** Checked — adds nothing new, continue using `/detailsbyaddress`
- ✓ **Evidence format:** Submit via online portal AND want PDF printout for in-person hearing. **PDF generation is required.**
- ✓ **DCAD propertyId:** API confirmed — `https://prod-container.trueprodigcyapi.com/public/property/search` (see DCAD API section below)
- ✓ **Shelby County parcel format:** Consistent across all properties (format: `073053  00028`)
- ✓ **RealtyAPI.io capacity:** 5 total properties (1 primary + 4 rental). 250 req/month is sufficient.
- ✓ **Subject property extraction:** Simple fix (no DB migration). Ship standalone in V3 so data accumulates with each monthly refresh.

### DCAD JSON API (discovery 2026-05-15)

The prodigycad.com portal is backed by a real JSON API:

```
POST https://prod-container.trueprodigcyapi.com/public/property/search
Content-Type: application/json

{"pYear":{"operator":"=","value":"2026"},"streetPrimary":{"operator":"mlike","value":"7070 Coulter Lake Rd"}}
```

**Response includes:**
```json
{
  "pid": 560912,
  "landValue": 284693,
  "improvementValue": 817120,
  "marketValue": 1101813,
  "appraisedValue": 1101813,
  "name": "GUPTA, NEHA & RAI, MANGAT TRS GOYAL FAMILY TRUST",
  "fullSitus": "7070 COULTER LAKE RD, FRISCO, TX, 75036",
  "arbHearing": "No"
}
```

The `pid` is the DCAD property ID used in the detail URL: `denton.prodigycad.com/property-detail/{pid}/{year}`.

**`arbHearing: "No"` field** — this tells us if a formal hearing has been scheduled. Directly usable in the protest tracker.

**Verification needed:** Unclear if this API is freely callable from any origin or only accessible from the prodigycad.com domain (CORS restriction). Worth a direct test before building.

**APN cross-reference:** The Redfin `publicRecordsInfo.basicInfo.apn` field returns `"R 000000560912"` for this property — the trailing digits `560912` exactly match the DCAD `pid`. This means once we extract APN from Redfin (part of the subject property fix), we can derive the DCAD property ID without an extra API call for owned properties. For comp addresses, we'd use the address-search endpoint above.

### Subject property data extraction (quick fix — ship in V3)

Discovered in `details.belowTheFold.publicRecordsInfo.basicInfo` from the live Redfin `/detailsbyaddress` response:

```json
{
  "beds": 4,
  "baths": 4.5,
  "propertyTypeName": "Single Family Residential",
  "numStories": 2.0,
  "yearBuilt": 2017,
  "sqFtFinished": 4009,
  "totalSqFt": 4009,
  "lotSqFt": 9817,
  "apn": "R 000000560912"
}
```

**Implementation:** Add `subject` field to `ValuationDetail` interface, extract in `parseRedfinResponse` from `details.belowTheFold?.publicRecordsInfo?.basicInfo`. Store `beds`, `baths`, `sqFt` (use `sqFtFinished`), `lotSqFt`, `yearBuilt`, `apn`. No DB migration — JSON column is flexible. Existing properties get populated on next monthly refresh or manual refresh.

**File:** `backend/src/modules/household/realty-api.service.ts`

### Versioning note

This feature is distinct from D-3 (rental income tracking — permanently dropped). D-3 was about tracking rent deposits, maintenance expenses, and ROI for investment properties as a financial management feature. PT-1 is about property tax protest workflow — a legal/compliance tool that applies to any owned property (primary, vacation, rental). No overlap.

---

## Dashboard + Net Worth Caching (F-6)

### Pattern: `useSessionCache` hook

```typescript
// frontend/src/hooks/useSessionCache.ts
export function useSessionCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 10 * 60 * 1000   // 10 min default; effectively infinite for offline use
): { data: T | null; loading: boolean; lastUpdatedAt: Date | null; refresh: () => void }
```

- On mount: check `sessionStorage.getItem(key)`. If present and within TTL, parse and return immediately (no fetch).
- If stale or absent: call `fetcher()`, store result + timestamp in `sessionStorage`.
- `refresh()`: force fetch regardless of TTL, update storage and state.
- Storage key format: `hfa:cache:{key}` to avoid namespace collision.

### Cache invalidation on import finalize

In `ImportWorkspacePage.tsx` (or wherever finalize is triggered), after a successful finalize response:

```typescript
// Clear dashboard and networth caches
sessionStorage.removeItem('hfa:cache:cash-summary');
sessionStorage.removeItem('hfa:cache:balance-sheet');
```

Or dispatch a `CustomEvent('hfa:import-finalized')` and listen for it in each cached page — cleaner if cache keys change.

### Refresh icon placement

- **Home page:** Top-right corner of the INFLOW / OUTFLOW KPI card row. `<ActionIcon variant="subtle">` with `<IconRefresh size={14}>`. Tooltip: "Last updated {timeAgo}".
- **Net Worth page:** Same placement, top-right of the accounts table card.
- During fetch: icon spins (`@keyframes spin`). On error: toast "Failed to refresh, using cached data."

### What NOT to cache

Do not cache the Transactions page or ledger — that list has user-driven filters and pagination; stale data there is confusing. Cache only the aggregate/summary endpoints that are expensive and rarely change.

---

## Net Worth Caching Follow-on (F-6b)

F-6 shipped caching for the trend chart history (`bs-history:*` keys, `"networth"` scope, 7-day TTL) and the Dashboard cash-summary. Two expensive queries on the Net Worth page remain uncached after F-6.

### What's still uncached

| Query | When it fires | Cost |
|---|---|---|
| `GET /reports/balance-sheet` (snapshot) | Every page load; every member/scope filter change | High — joins accounts, properties, snapshots |
| Per-account balance history (row expand) | Each time a user expands an account row | Medium × N (10–20 calls if all rows expanded) |

### Cache keys and TTLs

**Snapshot**
```
Key:   bs-snapshot:{ownerScope}:{ownerPersonProfileId|'household'}
Scope: "networth"
TTL:   1 hour
```
Rationale: snapshot reflects current account balances — it changes whenever a new import is finalized. 1 hour is short enough to feel fresh; the refresh icon handles the "I just imported" case explicitly.

**Per-account row-expansion history**
```
Key:   bs-acct-history:{accountId}:{fromDate}:{toDate}
Scope: "networth"
TTL:   7 days
```
Rationale: historical balance data for a given account and date window is immutable once written. Same TTL as the trend chart history (already 7 days in F-6).

### Invalidation

Both keys use the existing `"networth"` scope. The refresh icon shipped in F-6 calls `refreshHistoryCache()` which invalidates the full scope — it already busts `bs-history:*` and will bust these new keys without any UI change.

### Implementation notes

- Wrap `loadSheet()` callback with `useLocalStorageCache`, same pattern as the history fetch already in the file.
- For per-account expansion, locate the account-level history fetch in `NetWorthPage.tsx` and wrap it; the cache key must include accountId + the active from/to date window.
- No new hook, no new scope, no new UI. Pure extension of the existing F-6 pattern.

**Files:** `frontend/src/pages/NetWorthPage.tsx`

---

## Transfer Matching Improvements (TM-1 / TM-2 / TM-3)

### TM-2: API spec for manual pair/unpair

```
POST /transactions/pair
Body: { debitId: string; creditId: string }
Validates:
  - Both belong to same household
  - Different account_id
  - Opposite signs (one negative, one positive)
  - Neither already has a transfer_group_id (or require explicit override)
Response: 200 { transferGroupId: string }

DELETE /transactions/pair/:groupId
Validates:
  - At least one transaction with this transfer_group_id belongs to caller's household
Response: 204 (nulls transfer_group_id on all rows with that groupId)
```

### TM-3: ❌ NOT DOING — dropped 2026-05-19

Premise was wrong. OFX parser never produces a truly empty description (`"OFX Transaction"` fallback means identical-memo pairs score 100 and auto-pair). No evidence of this failure mode in 3,500 production transactions. Transfer resolution queue is healthy. Closed without implementation.

---

## AI Year-End Summary (F-7)

### Prompt design

Feed as a structured JSON block (same approach as `insight-prompt.service.ts`):

```
You are a friendly personal finance advisor reviewing a household's full-year financial data.
Write a 2-3 paragraph summary that feels personal and encouraging — not clinical.
Cover: what went well, what stands out or surprised you, one specific actionable suggestion for next year.
Avoid generic advice. Reference the actual numbers.

DATA:
{
  "year": 2025,
  "income": 280000,
  "spending": 195000,
  "netSavings": 85000,
  "savingsRate": "30.4%",
  "priorYearComparison": { "income": 265000, "spending": 188000, "savingsRate": "29.1%" },
  "topCategories": [
    { "name": "Housing", "amount": 42000, "pct": "21.5%" },
    ...
  ],
  "bestMonth": { "month": "2025-03", "netSavings": 12400 },
  "worstMonth": { "month": "2025-11", "netSavings": -2100 },
  "netWorthStart": 620000,
  "netWorthEnd": 710000,
  "netWorthChange": 90000,
  "largestTransaction": { "date": "2025-06-15", "amount": 28000, "description": "ESPP Purchase" },
  "topMerchant": { "name": "Amazon", "count": 87 }
}
```

### Backend endpoint

```
GET /reports/year-summary?year=2025
```

- Computes all data fields from `transaction_canonical`, `account_balance_snapshot`, `payslip_snapshot`.
- Calls LLM and caches narrative in `household` settings JSON or a new `year_summary_cache` table (avoid re-calling LLM on every page load; invalidate if user uploads more data for that year).
- Returns: `{ year, data: {...}, narrative: string, generatedAt: string }`.

---

---

## Recurring Payments Display Name (F-9)

### Problem

Confirmed recurring rules on the Dashboard Recurring Payments card show the raw `merchantKey` value (the substring match pattern used for detection) as the display label. For auto-detected or manually-entered rules, this is often an ugly truncated bank string: `"CITY OF FRISCO UTILITI FRIS"`, `"MUNICIPAL ONLINE PAYME LUBB"`, etc.

### What already exists

| Layer | Status |
|---|---|
| DB column `recurring_merchant_override.display_name` (TEXT, nullable) | ✅ Exists |
| Backend: `displayName?: z.string().optional()` in Zod schema | ✅ Already accepted |
| Backend: `upsertOverride()` writes `display_name` if provided | ✅ Already handled |
| Dashboard confirmed item rendering: `override.displayName ?? override.merchantKey` | ✅ Falls back correctly |
| Settings > Recurring table: `o.displayName ?? "—"` column | ✅ Shows it read-only |

The gap is entirely in the frontend collection layer.

### What's missing

`RecurringTagModal` (the modal launched from the Transactions page "Mark as recurring" button and from the Settings > Recurring edit button) collects only:
- Match string (`merchantKey`)
- Amount anchor (optional number)
- Tolerance %

There is no `displayName` input. Neither `TransactionsPage` nor `SettingsPage` passes `displayName` in the POST body, so it is always `null`.

### Suggested items

Suggested recurring items use the raw heuristic `item.merchant` (normalized transaction description, e.g. `"CLAUDE.AI SUBSCRIPTION SAN"`). This is intentional — they are unconfirmed candidates. When the user clicks to confirm a suggestion, the modal opens pre-filled with the merchant key; at that point they can set a display name. No change needed for the suggested rendering.

### Fix

**`frontend/src/components/RecurringTagModal.tsx`**
- Add an optional "Display name" `TextInput` below the merchant key field.
- Placeholder: the `merchantKey` value (so user sees what will be shown if left blank).
- Pass `displayName` (trimmed, or `undefined` if blank) in the `onConfirm` callback.
- When opened in edit mode (from Settings), pre-fill with existing `displayName` if set.

**`frontend/src/pages/TransactionsPage.tsx`**
- Include `displayName` in the POST body to `POST /recurring/overrides`.

**`frontend/src/pages/SettingsPage.tsx`**
- Include `displayName` in the POST body for both the "confirm new rule" and "edit existing rule" paths.

No backend or migration changes needed.

### Expected result

After the fix, a user confirming `"CITY OF FRISCO UTILITI FRIS"` can type `"Frisco Utilities"` in the display name field. The Dashboard card shows `"Frisco Utilities"`, the Settings table shows `"Frisco Utilities"`, and the match string (used for detection) stays as `"CITY OF FRISCO UTILITI FRIS"` under the hood.

---

---

## Near-Duplicate Detection — Remove Description Gate (TM-4)

### Problem in detail

The BoA CSV export masks sensitive digits in ACH/wire reference fields with `X` characters. The BoA PDF parser extracts the real digits. When both files are imported for the same account period, the canonicalization pipeline sees two transactions with the same account, date, and amount but descriptions that differ enough that neither passes the `descriptionsCompatibleForNearDuplicate()` substring check. Both land as live `posted` rows — a silent duplicate.

### Real-world example pairs (all same transaction, different source)

| CSV (masked) | PDF (real) |
|---|---|
| `CKPTUTOR DES:IAT PAYPAL ID:XXXXX50542835 INDN:MANGAT RAI CO ID:XXXXX0487C IAT PMT INFO: WEB XXXXXXXXXX00001199` | `CKPTUTOR DES:IAT PAYPAL ID:1049950542835 INDN:MANGAT RAI CO ID:XXXXXXXXXC IAT PMT INFO: WEB 00000` |
| `IBM 3141 DES:PAYROLL ID:XXXXX73099 INDN:Mangat Rai CO ID:XXXXX71985 PPD PMT INFO:TRN*1*XXXXX73099` | `IBM 3141 DES:PAYROLL ID:1000073099 INDN:Mangat Rai CO ID:2130871985 PPD PMT INFO:TRN*1*10000730` |
| `GOLDMAN SACHS BA DES:TRANSFER ID:000300008446968 INDN:Rai,Mangat CO ID:0124085260 WEB` | `GOLDMAN SACHS BA DES:TRANSFER ID:XXXXXXXXXX46968 INDN:Rai,Mangat CO ID:XXXXX85260 WEB` |
| `CHECKCARD 0430 TMOBILE AUTO P BELLEVUE WA 00000000000000000914798 RECURRING` | `TMOBILE AUTO P 04/30 PURCHASE BELLEVUE WA` |

### Why the current check fails

`normalizeDescriptionForFingerprint()` strips non-alphanumeric but preserves literal `X` as a letter. After normalization, `"idxxxxx50542835"` ≠ `"id1049950542835"`. Neither is a substring of the other, so `descriptionsCompatibleForNearDuplicate()` returns false and the near-duplicate path is never triggered.

### Why NOT to fix the normalization

Stripping X-runs and long digit sequences would fix these specific cases, but it hardcodes knowledge of BoA's masking format. Different banks, different parsers, or a future format change would silently re-break it. It's the wrong layer.

### Option 1 (selected): Remove the description gate

For same-account + same-date + same-amount pairs, drop `descriptionsCompatibleForNearDuplicate()` entirely. Any fingerprint mismatch routes the second transaction to `status = 'duplicate'` with a `duplicate_ambiguity` resolution item.

**Trade-off:** Two genuinely different same-price same-day transactions (two $5.25 coffees, two $20 ATM withdrawals) will occasionally land in the resolution queue as false positives. The false-positive rate is low in practice — ACH, payroll, and transfer amounts are typically unique per day within an account — and the resolution queue is the designed path for ambiguity. Acceptable for a single-household app where the user resolves ambiguity themselves.

**Why not fuzzy string matching (Levenshtein, Jaro-Winkler, Dice)?** These measure character-level distance. A 13-digit ID run or a long zero-padded reference adds significant character distance even when the merchant name is identical. The TMOBILE pair is worse: one description is ~2× the length. Character-level fuzzy matching doesn't handle token-level insertions cleanly, and a library won't help without additional preprocessing.

---

### Option 3 (upgrade path): Structural token Jaccard

If false-positive resolution noise ever becomes a problem, replace the removed gate with a smarter check: strip any token that consists entirely of digits, X-characters, or a mix (`/^[x\d]+$/i`), then compute Jaccard similarity on the remaining structural word tokens. Those are the merchant name and type keywords — the stable part of any bank description, regardless of bank or format.

```typescript
function structuralTokens(normalizedDescription: string): Set<string> {
  return new Set(
    normalizedDescription.split(/\s+/).filter(t => t.length > 1 && !/^[x\d]+$/i.test(t))
  );
}

function structuralJaccard(a: string, b: string): number {
  const ta = structuralTokens(a);
  const tb = structuralTokens(b);
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}
```

Replace `descriptionsCompatibleForNearDuplicate()` with `structuralJaccard(a, b) >= 0.4`. The 0.4 threshold is tunable; requires ~40% of structural tokens to overlap.

**Why generic:** Stripping pure-digit/X tokens is valid for any bank — reference IDs and trace numbers are always digits or masked digits, never merchant names. No knowledge of BoA's masking format is hardcoded.

**Validation against the four real-world pairs:**

| Pair | Jaccard after stripping |
|---|---|
| CKPTUTOR (masked vs real IDs) | ~0.90 ✓ |
| IBM PAYROLL (masked vs real IDs) | ~0.85 ✓ |
| GOLDMAN SACHS (real vs masked IDs) | ~0.80 ✓ |
| TMOBILE (CHECKCARD prefix + long zeros vs clean) | 5/8 = 0.625 ✓ |

No new npm dependency. ~15 lines of code when ready to upgrade.

### Scope

Same-account near-duplicate path only. Transfer pairing (`transferPairScore()`) is a separate scoring path — not touched.

---

## Cash Account Auto-Balance (F-10)

### The problem

A cash account is tracked exclusively by manual transaction entry. Currently, recording a cash expense in the Transactions page only creates a `transaction_canonical` row — it does not touch `account_balance_snapshot`. The user must navigate to Net Worth, find the account, and manually update the balance after every cash transaction. This defeats the purpose of tracking cash spending.

### Data model (existing)

`account_balance_snapshot` has `source = 'manual' | 'import'`. Manual-source rows are exactly what auto-balance should write. `upsertManualBalanceSnapshot()` in `balance-sheet.service.ts` already does the upsert correctly. No schema change needed.

### Design

**Trigger:** `POST /ledger` (create), `DELETE /ledger/:id` (delete), `PATCH /ledger/:id` (edit amount) — only when `financial_account.type = 'cash'`.

**Balance computation (delta model):**
- On create: `new_balance = latest_snapshot_amount + txn.amount`
- On delete: `new_balance = latest_snapshot_amount − txn.amount`
- On edit: `new_balance = latest_snapshot_amount − old_amount + new_amount`
- If no prior snapshot exists: treat `latest_snapshot_amount = 0` (assumes starting from zero; user can set opening balance via Net Worth manual entry UI)

**Why not recompute from SUM(transactions):** A user may set an opening balance manually (e.g. "I have $200 cash right now") and then track future spending. Summing all transactions from an arbitrary start would ignore the opening balance. The delta model anchors each increment to whatever the user last confirmed the balance to be.

**Only cash accounts.** Checking and savings have import-sourced snapshots from statement files; auto-updating those from manual transactions would introduce noise. The `type = 'cash'` guard is the fence.

### Edge cases

- **Out-of-order entries:** If user records transactions out of date order (e.g. enters last week's coffee today), the snapshot's `as_of_date` will be the transaction date but the snapshot amount will still be correctly incremented from today's latest value. The balance may not reflect chronological order. Acceptable for cash — the user can correct via manual Net Worth entry.
- **Currency:** Cash accounts are typically single-currency. Use the account's currency or default `USD`. If the account has mixed currencies (unusual), skip auto-balance (do not create a snapshot).
- **Transfer transactions:** Cash-to-cash transfers should not double-count. If the debit and credit sides are both cash accounts, each side independently updates its own snapshot. This is correct — moving $50 from one cash envelope to another reduces one account by $50 and increases the other by $50.

---

---

## PS-5: Tax Filing Profile + Stored Effective Federal Rate

**Status:** Deferred — needs user due diligence before design is locked. Captured 2026-05-21. Mostly backend + import pipeline; frontend impact is a small per-person Settings section.

### Problem

`PS-4 TaxSufficiencyAlert` computes federal rate at runtime by scanning `payslip_line_item` rows for a line whose name or authority indicates federal withholding. This works but is fragile:

- IBM: line name is `"TX Withholding Tax"`, authority `"Federal"` — name-only check misses it
- Deloitte: line name is `"Federal Income Tax"` — name check works
- A third employer could use a different format entirely

**Root cause:** The federal line detection heuristic is brittle across payslip formats. The fix is to store the computed rate at import time — when the parsed data is already normalised — rather than re-detecting it on every page load.

### The deeper signal gap

The current tiered commentary (`< 10%`, `10–16%`, `16–28%`, `> 28%`) uses generic IRS benchmarks. A more precise signal — "you appear under-withheld by ~$3,200 for your filing situation" — requires knowing:

1. **What was actually withheld** → already in `gross_pay_ytd` + `employee_taxes_ytd` + the federal line
2. **What should be withheld** → requires filing status, number of allowances/credits, and IRS Pub 15-T withholding tables (or an LLM estimate)

The W-4 context exists on some payslips (IBM shows marital status, filing status, credits) but not others (Deloitte does not). So storage must be hybrid: LLM-extracted where available, user-entered where not.

### Proposed design

#### Schema additions

```sql
-- Migration: 0049_ps5_tax_profile.sql

-- Stored effective rate on the snapshot (avoids runtime line-item detection)
ALTER TABLE payslip_snapshot
  ADD COLUMN effective_federal_rate_ytd  NUMERIC,  -- fedTaxYtd / grossPayYtd * 100
  ADD COLUMN effective_total_tax_rate_ytd NUMERIC; -- employeeTaxesYtd / grossPayYtd * 100

-- Per-person tax filing profile (user-entered or LLM-populated at import)
CREATE TABLE person_tax_profile (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_profile_id    TEXT NOT NULL REFERENCES person_profile(id) ON DELETE CASCADE,
  tax_year             INTEGER NOT NULL,
  filing_status        TEXT,  -- 'single' | 'married_jointly' | 'married_separately' | 'head_of_household'
  w4_allowances        INTEGER,
  w4_additional_amount NUMERIC,   -- additional withholding per period
  w4_credits           NUMERIC,   -- Step 3 credits total
  w4_extra_deductions  NUMERIC,   -- Step 4b deductions
  state_code           TEXT,      -- 'TX' | 'CA' | etc.
  notes                TEXT,
  source               TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'llm_extracted'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(person_profile_id, tax_year)
);
```

#### Import pipeline changes

In the payslip finalization step (wherever the snapshot row is written or updated), compute and store `effective_federal_rate_ytd` from the already-parsed line items. No LLM call needed — pure arithmetic from the normalised extract data.

If the LLM extract includes W-4 fields (IBM does, Deloitte doesn't), also upsert a `person_tax_profile` row with `source = 'llm_extracted'`. Don't overwrite a `source = 'user'` row.

**Files:** `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/imports/payslip-async-import-reconcile.service.ts`

#### Frontend changes (small)

A "Tax Filing" sub-section on the **Payslips → person detail** or **Settings → People** page:
- Per-person, per-year entry: filing status, credits, additional withholding
- Pre-filled from LLM extraction if available; user can correct
- If populated, `TaxSufficiencyAlert` can show a more precise "estimated annual liability vs withheld" comparison

**No changes to `PayslipDetailPage` itself** — the alert reads from `payslip_snapshot.effective_federal_rate_ytd` directly once it exists, bypassing the line-item scan.

### Open questions (user to resolve before building)

- [ ] **Where should the filing profile live in the UI?** Settings → People → [person] → Tax profile? Or payslip list sidebar?
- [ ] **Which years to scope?** Current tax year only, or rolling window (2 years: current + prior)?
- [ ] **LLM extraction quality:** Do IBM and other formats reliably put W-4 data into `tax_profile_json` already? Check `canonical_extract_json` on a few real payslips to see what's populated.
- [ ] **State tax handling:** CA, TX, NY, IL all have different withholding rules. For the first pass, should state-specific analysis be skipped (show federal only) and added later?
- [ ] **Precision of "estimated liability":** Use IRS Pub 15-T tables (static lookup, no LLM) or ask the LLM? Pub 15-T tables are public and updatable annually; an LLM approach is softer but more flexible for state + AMT edge cases.

### Build order dependency

This is blocked on user due diligence above. The `effective_federal_rate_ytd` column (migration + backend write at import time) is an independent first step that can ship without the `person_tax_profile` table or any frontend UI — it just makes the existing `TaxSufficiencyAlert` more robust.

Phase 1 (independent): migration + import pipeline write → `effective_federal_rate_ytd` on snapshot
Phase 2 (after due diligence): `person_tax_profile` table + Settings UI + richer alert commentary

---

*Last updated: 2026-05-21. Added PS-5: Tax Filing Profile + Stored Effective Federal Rate — backend/import pipeline feature to eliminate runtime line-item detection fragility and enable a richer per-person tax sufficiency signal. Blocked on user due diligence (filing profile placement, state handling, LLM vs Pub 15-T for liability estimate). Original F-6/TM/F-7/F-9/TM-4/F-10 entries above unchanged.*
