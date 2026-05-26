# RE-1: Real Estate Pages — Implementation Spec
**Status:** Design finalized · Ready to build
**Design file:** `real-estate/RE.html`
**Builds on:** Existing `properties` table + `valuation_detail_json` data
**Feeds into:** PT-1 (Tax Protest) via "Prepare Tax Protest" CTA

---

## 1. Navigation

### New sidebar section (same as PT-1 spec)

Add **"Property & Tax"** group in `AppSidebar.tsx` between Reports and Setup:

```tsx
{ label: 'Property & Tax', items: [
  { label: 'Real Estate', path: '/real-estate', icon: IconBuilding  },
  { label: 'Tax Protest',  path: '/tax-protest',  icon: IconGavel   },
]}
```

---

## 2. Routes

```
/real-estate           → RealEstatePage   (portfolio list)
/real-estate/:id       → PropertyDetailPage
```

Property `:id` is the existing UUID primary key in the `properties` table.

---

## 3. Backend — Schema additions

These fields are currently missing from the `properties` table. Add via migration:

```sql
ALTER TABLE properties
  ADD COLUMN purchase_price    INTEGER,          -- user-entered
  ADD COLUMN purchase_date     DATE,             -- user-entered (month precision is fine)
  ADD COLUMN monthly_rent      INTEGER,          -- null for primary home; user-entered
  ADD COLUMN property_notes    TEXT;             -- free-form notes
```

All four fields are **user-editable** — not derived from Redfin. Surface them as an editable form on the Property Detail page.

> The existing `valuation_detail_json` column already stores AVM, CAD assessed, tax history, and comps. No changes needed there.

---

## 4. Backend — API

### Existing endpoints (already exist — verify coverage)
```
GET  /api/properties              → list of all properties with valuation_detail_json
GET  /api/properties/:id          → single property detail
POST /api/properties              → add property
DELETE /api/properties/:id        → remove property (V4 feature in progress)
POST /api/properties/:id/refresh  → trigger Redfin AVM + comp refresh
```

### New endpoints needed
```
PATCH /api/properties/:id
      Body: { purchasePrice?, purchaseDate?, monthlyRent?, propertyNotes? }
      → Update user-entered metadata fields
      → Returns updated property
```

The `PATCH` endpoint should only accept the four new user-entered fields (not AVM data which comes from Redfin).

---

## 5. Frontend — RealEstatePage (`/real-estate`)

### File: `frontend/src/pages/RealEstatePage.tsx`

**Data:** Uses existing `useProperties()` hook (or equivalent). Extend to include new fields.

**Sections:**

#### 5a. Portfolio Summary Strip
5 KPI tiles in a horizontal row:
| KPI | Source |
|---|---|
| Portfolio AVM | `SUM(valuation_detail_json->>'estimate')` |
| Total CAD Assessed | `SUM(valuation_detail_json->>'taxCurrent'->>'assessedValue')` |
| Annual Property Tax | `SUM(valuation_detail_json->>'taxCurrent'->>'taxesDue')` |
| Annual Rental Income | `SUM(monthly_rent) * 12` (rentals only) |
| Protest Savings | `SUM(protest_worksheets.tax_savings)` for current year |

#### 5b. Property Cards Grid
Responsive grid: 3 columns on ≥1200px, 2 on ≥768px, 1 on mobile.

Each card shows:
- Striped image placeholder (until property photo feature ships)
- Property type badge + protest status badge
- Address, city/state, county
- Specs: `{beds}bd · {baths}ba · {sqft} sqft · Built {year}`
- Purchase price + date → Current AVM (with % gain)
- Monthly rent (if rental)
- Assessment signal badge (CAD vs AVM %)
- Hearing alert if `protest_worksheets.hearing_date` is within 45 days
- Footer CTAs: "View Details" + "Tax Protest"

#### 5c. Page header actions
- "↻ Refresh All Data" — triggers `/api/properties/refresh-all` (or loop individual refreshes)
- "+ Add Property" — opens existing add-property modal/flow

---

## 6. Frontend — PropertyDetailPage (`/real-estate/:id`)

### File: `frontend/src/pages/PropertyDetailPage.tsx`

**Layout:** Two columns (left 60% · right 40%) on ≥900px; single column on mobile.

#### Left column
1. **Property image** — placeholder striped div until photo feature ships
2. **Property Facts card** — all physical attributes, editable inline
   - Address, property type, beds/baths, sqft, lot size, year built, stories, APN, county, portal, appeal process
   - "Edit" button → Mantine Modal or inline edit for `purchasePrice`, `purchaseDate`, `monthlyRent`, `propertyNotes`
3. **Assessment History chart** — bar chart (Recharts `BarChart`) of `taxHistory[]` from `valuation_detail_json`
   - 4 years, current year bar highlighted in terracotta
   - YoY % change labels

#### Right column
1. **Valuation Summary card**
   - Purchased: `purchasePrice` + `purchaseDate`
   - Current AVM: `estimate` (from valuation_detail_json)
   - CAD Assessed 2026: `taxCurrent.assessedValue`
   - Gain since purchase: computed
2. **Protest Readiness card**
   - Assessment signal: CAD vs AVM comparison
   - If overassessed (CAD > AVM by >3%): show "Consider Protesting" with estimated savings
   - Hearing date (if filed): editable inline, pulls from `protest_worksheets`
   - CTA button:
     - No protest yet: "→ Prepare Tax Protest" (terracotta) — navigates to `/tax-protest?property=:id`
     - Protest filed: "→ View Protest Worksheet" (forest green)
3. **Data Source card** — last refreshed, source note, "↻ Refresh" button

---

## 7. Protest Readiness Logic (frontend utility)

```ts
function getProtestSignal(property: PropertyWithValuation): ProtestSignal {
  const cadAssessed = property.valuationDetail?.taxCurrent?.assessedValue;
  const avm         = property.valuationDetail?.estimate;
  if (!cadAssessed || !avm) return { recommend: false, reason: 'insufficient-data' };
  
  const overPct = ((cadAssessed / avm) - 1) * 100;
  if (overPct > 3) {
    return {
      recommend: true,
      overAmount: cadAssessed - avm,
      overPct,
      estSavings: Math.round((cadAssessed - avm) * (property.taxRate ?? 0.02)),
    };
  }
  return { recommend: false, overPct };
}
```

This logic powers both the property card badge and the detail page protest card.

---

## 8. Mobile considerations

- Portfolio strip: horizontal scroll on mobile (wrap to 2×2+1 grid on ≥480px)
- Property cards: single column on mobile, full width
- Detail page: single column stack on mobile — right column moves below left
- "Prepare Tax Protest" button: full-width on mobile

---

## 9. Integration with V4 property deletion

The property deletion feature (in-progress V4) will need to cascade to:
- `protest_worksheets` (via `ON DELETE CASCADE` — already in PT-1 spec)
- `protest_comp_cad` (via `ON DELETE CASCADE` — already in PT-1 spec)

No additional work needed in RE-1 — just ensure the deletion flow in V4 is aware of these new tables.

---

## 10. Phase Plan

| Phase | Scope |
|---|---|
| RE-1a | Schema migration (purchase_price, purchase_date, monthly_rent, property_notes) |
| RE-1b | `PATCH /api/properties/:id` endpoint |
| RE-1c | `RealEstatePage.tsx` — portfolio list with cards + portfolio strip |
| RE-1d | `PropertyDetailPage.tsx` — full detail layout + editable fields |
| RE-1e | Protest readiness card + hearing date edit + "Prepare Tax Protest" CTA → `/tax-protest` |
| RE-1f | Sidebar navigation update (Property & Tax group) |

RE-1 and PT-1a can be built in parallel. RE-1e depends on PT-1a being merged (protest_worksheets table).
