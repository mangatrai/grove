# PT-1: Property Tax Protest Assistant — Implementation Spec
**Status:** Design finalized · Ready to build
**Design file:** `pt1-protest/PT1 Protest Assistant.html` (View B is the target)
**Depends on:** Real Estate pages (RE-1) for navigation entry point

---

## 1. Navigation

Add a **"Property & Tax"** section to `AppSidebar.tsx`, between "Reports" and "Setup":

```tsx
{ label: 'Property & Tax', items: [
  { label: 'Real Estate', path: '/real-estate', icon: IconBuilding },
  { label: 'Tax Protest',  path: '/tax-protest',  icon: IconGavel },
]}
```

The Tax Protest page is also reachable via the "Prepare Tax Protest" CTA on the Property Detail page (`/real-estate/:id`), which pre-selects the property.

---

## 2. Route

```
/tax-protest                   → redirect to first property with protest data
/tax-protest?property=:id      → Tax Protest worksheet for that property
```

---

## 3. Backend — Data Model

### 3a. Extend `valuation_detail_json` (ValuationDetail)

Add to the existing JSON column in the `properties` table (no migration needed — column is flexible):

```ts
interface ValuationDetail {
  // existing fields ...

  // NEW — subject property physical facts (from Redfin /detailsbyaddress)
  subject?: {
    sqft: number;        // sqFtFinished from publicRecordsInfo.basicInfo
    beds: number;
    baths: number;
    yearBuilt: number;
    lotSqft: number;
    apn: string;         // e.g. "R 000000560912"
  };
}
```

**Extract in `realty-api.service.ts`:**
```ts
const basic = details.belowTheFold?.publicRecordsInfo?.basicInfo;
if (basic) {
  valuation.subject = {
    sqft:      basic.sqFtFinished ?? basic.totalSqFt,
    beds:      basic.beds,
    baths:     basic.baths,
    yearBuilt: basic.yearBuilt,
    lotSqft:   basic.lotSqFt,
    apn:       basic.apn,
  };
}
```

Derive DCAD PID from APN: `apn.replace(/[^0-9]/g, '').replace(/^0+/, '')` → `"560912"`.

---

### 3b. New Table: `protest_worksheets`

```sql
CREATE TABLE protest_worksheets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tax_year     SMALLINT NOT NULL,                  -- e.g. 2026
  
  -- Notice values
  cad_noticed_value    INTEGER,                    -- from CAD notice / API
  cad_land_value       INTEGER,
  cad_improvement_value INTEGER,
  
  -- AVM at time of protest
  avm_at_protest       INTEGER,
  
  -- Protest filing
  status               TEXT NOT NULL DEFAULT 'not-filed',
  -- 'not-filed' | 'filed' | 'informal' | 'arb' | 'resolved'
  filed_date           DATE,
  hearing_type         TEXT,                       -- 'informal' | 'arb'
  hearing_date         DATE,                       -- user-editable
  arb_hearing_scheduled BOOLEAN DEFAULT FALSE,     -- from DCAD arbHearing field
  
  -- Informal offer
  informal_offer_value INTEGER,
  informal_offer_date  DATE,
  
  -- Resolution
  settled_value        INTEGER,
  settled_date         DATE,
  tax_savings          INTEGER,                    -- calculated at resolution
  
  -- Strategy notes
  protest_grounds      TEXT[],                     -- ['unequal', 'market_value']
  requested_value      INTEGER,
  
  -- LLM strategy cache
  strategy_generated_at TIMESTAMPTZ,
  strategy_json        JSONB,                      -- cached LLM output
  
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (property_id, tax_year)
);
```

---

### 3c. New Table: `protest_comp_cad`

CAD-assessed values for each Redfin comp address (needed for unequal appraisal):

```sql
CREATE TABLE protest_comp_cad (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id    UUID NOT NULL REFERENCES protest_worksheets(id) ON DELETE CASCADE,
  
  address         TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  
  -- CAD lookup result
  cad_pid         TEXT,                            -- county property ID
  cad_assessed    INTEGER,
  cad_sqft        INTEGER,
  cad_ppsqft      NUMERIC(8,2),                   -- computed: cad_assessed / cad_sqft
  
  -- Lookup metadata
  fetched_at      TIMESTAMPTZ,
  fetch_status    TEXT DEFAULT 'pending',          -- 'pending' | 'found' | 'not-found' | 'error'
  error_msg       TEXT,
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Backend — Services

### 4a. `DCADService` (`dcad.service.ts`)

Wraps the DCAD JSON API:

```ts
// Search by address → get pid + assessed values
async searchByAddress(streetAddress: string, year = 2026): Promise<DCADProperty | null>

// POST https://prod-container.trueprodigcyapi.com/public/property/search
// Body: { pYear: { operator: '=', value: year }, streetPrimary: { operator: 'mlike', value: address } }

interface DCADProperty {
  pid: number;
  landValue: number;
  improvementValue: number;
  marketValue: number;
  appraisedValue: number;
  fullSitus: string;
  arbHearing: 'Yes' | 'No';
}
```

**CORS note:** Verify if this API is callable from server-side. If CORS-restricted to browser origin, proxy via a backend route. Test: `curl -X POST https://prod-container.trueprodigcyapi.com/public/property/search -H 'Content-Type: application/json' -d '{"pYear":{"operator":"=","value":"2026"},"streetPrimary":{"operator":"mlike","value":"7070 Coulter Lake Rd"}}'`

For Shelby County TN, initial implementation is manual entry only. Add a note in the UI.

---

### 4b. `ProtestWorksheetService` (`protest-worksheet.service.ts`)

```ts
// Get or create worksheet for current tax year
getWorksheet(propertyId: string, year?: number): Promise<ProtestWorksheet>

// Update worksheet fields (filing status, hearing date, etc.)
updateWorksheet(id: string, dto: UpdateWorksheetDto): Promise<ProtestWorksheet>

// Kick off async CAD data fetch for all comp addresses
// Returns immediately; updates protest_comp_cad rows in background
triggerCADFetch(worksheetId: string): Promise<{ jobId: string }>

// Generate LLM protest strategy (or return cached)
generateStrategy(worksheetId: string, forceRefresh?: boolean): Promise<StrategyResult>
```

---

### 4c. Async Job: `FetchCADDataJob`

Uses BullMQ (or existing job infrastructure):

```ts
// Queue: 'cad-fetch'
// Payload: { worksheetId: string }
// Steps:
//   1. Load worksheet → get comp addresses from valuation_detail_json.comps
//   2. For each comp (up to 10): call DCADService.searchByAddress()
//   3. Upsert result into protest_comp_cad
//   4. When all done: emit notification to user (in-app or push)
//   5. Update worksheet.updated_at

// Estimated time: 2–5 min for 6 comps (rate-limit friendly)
// On completion: POST /api/notifications { type: 'cad_fetch_complete', propertyId }
```

---

### 4d. `ProtestStrategyService` (LLM)

```ts
// Builds the prompt from:
//   - subject property (sqft, beds, baths, yearBuilt, cadAssessed, avm)
//   - comp CAD data (from protest_comp_cad)
//   - comp sold data (from valuation_detail_json.comps)
//   - state/county context
//   - tax year + protest grounds

// Model: claude-haiku or claude-sonnet depending on latency preference
// Caches result in protest_worksheets.strategy_json
// Invalidate cache when new CAD data arrives

// Output schema (stored as JSONB):
interface StrategyResult {
  generatedAt: string;
  caseStrength: number;          // 0–10
  primaryStrategy: 'unequal' | 'market_value';
  targetValue: number;
  targetLow: number;
  targetHigh: number;
  estSavingsMid: number;
  strategies: Array<{
    label: string;
    strength: number;
    tag: string;
    text: string;
    comps: string[];
    draft: string;
  }>;
  flags: string[];
}
```

---

## 5. Backend — API Endpoints

```
GET  /api/properties/:id/protest-worksheet
     → Returns worksheet + comp CAD data + strategy (if cached)

PATCH /api/properties/:id/protest-worksheet
      Body: { status?, hearingDate?, filedDate?, settledValue?, ... }
      → Updates filing status, dates, resolution

POST /api/properties/:id/protest-worksheet/fetch-cad
     → Triggers async CAD fetch job
     Response: { jobId, message: 'Fetching CAD data for 6 comp addresses...' }

GET  /api/properties/:id/protest-worksheet/fetch-status
     → { status: 'idle' | 'running' | 'done', lastFetched?, compsReady }

POST /api/properties/:id/protest-worksheet/strategy
     → Generates (or returns cached) LLM strategy
     Response: StrategyResult

GET  /api/properties/:id/protest-worksheet/export-pdf
     → Streams a PDF evidence packet
```

---

## 6. Frontend

### 6a. New page: `TaxProtestPage.tsx`

Route: `/tax-protest?property=:id`

**Component structure:**
```
TaxProtestPage
├── PropertySwitcher           (all properties, protest status badges)
├── HeroHeader                 (dark forest-night, property + KPIs + hearing badge)
├── SignalCard                 (4-KPI grid: CAD / AVM / Overassessment / Est Savings)
│
├── [Left column]
│   ├── EvidenceTabs           ('Unequal Appraisal' | 'Market Value')
│   │   ├── UnequaTable        (CAD comp data + fetch button + rate bars + legend)
│   │   └── MarketValueTable   (Redfin sold comps)
│   └── DeadlineBanner         (if hearingDate is set)
│
└── [Right column]
    ├── LLMStrategyPanel       (case strength + target + expandable drafts)
    ├── ProtestTracker         (timeline stepper + prior year table)
    └── ExportBtn              (PDF evidence packet)
```

### 6b. Key UI states

**UnequaTable fetch states:**
- `idle`: "↻ Fetch DCAD Data" button
- `fetching`: "⟳ Fetching 6 addresses… (background job)" — poll `/fetch-status`
- `done`: "✓ DCAD current · {date} — Refresh" button

**Hearing date:** Inline editable field in the tracker / deadline banner. Edits via `PATCH /protest-worksheet { hearingDate }`.

**LLM panel:** Always visible. If no strategy cached, show "Generate Protest Strategy" button. Once generated, shows full output. Regenerate button available.

### 6c. Sidebar update (`AppSidebar.tsx`)

Add nav group between "Reports" and "Setup":
```tsx
{
  label: 'Property & Tax',
  items: [
    { label: 'Real Estate', path: '/real-estate',  icon: IconBuilding },
    { label: 'Tax Protest',  path: '/tax-protest',  icon: IconGavel   },
  ]
}
```

---

## 7. Multi-state Handling

The LLM strategy prompt should include state/county context to adapt the argument:

```
Property: {address}, {county}, {state}
Appeal process: {appealProcess}   // 'ARB (Appraisal Review Board)' or 'Board of Equalization'
Tax year: {taxYear}
```

This allows the LLM to apply correct statutory references (e.g., Tex. Tax Code §41.43 for TX, Tennessee Code Annotated §67-5-1412 for TN) without hardcoding per-state logic.

---

## 8. PDF Export

**Library:** `@react-pdf/renderer` or `puppeteer` (server-side render of the evidence HTML page).

**Pages (8 total):**
1. Cover sheet — property, owner, case summary, TOC
2. Subject property details
3. Unequal appraisal table (§41.43) — comp CAD $/sqft vs subject
4. Unequal appraisal narrative + draft argument
5. Market value comps table (§41.41)
6. Market value narrative + draft argument
7. Assessment history (2023–2026 chart)
8. Strategy notes + hearing prep checklist

---

## 9. Annual Cycle

The protest workflow resets each tax year. The `tax_year` field on `protest_worksheets` handles this. On April 1 each year, trigger a background job to:
1. Fetch new CAD assessed values for owned properties (DCAD API for TX, manual for TN)
2. Create new `protest_worksheets` rows for the new year (status: `not-filed`)
3. Trigger Redfin AVM + comp refresh

---

## 10. Phase Plan

| Phase | Scope |
|---|---|
| V3 (now) | Extract subject property facts from Redfin response (`realty-api.service.ts`) |
| PT-1a | Backend schema + DCAD service + protest_worksheets table |
| PT-1b | Frontend Tax Protest page (View B layout) + property switcher |
| PT-1c | Async DCAD fetch job + UnequaTable with fetch states |
| PT-1d | LLM strategy generation + caching |
| PT-1e | PDF export endpoint + download |
