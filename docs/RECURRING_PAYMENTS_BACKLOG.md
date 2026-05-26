# Recurring Payments — Hybrid Tagging System (Backlog)

**Status:** **Phases 1–3 shipped** (**CR-121**, **CR-122**, **CR-123** — see **`docs/CHANGE_HISTORY.md`**). Override store, transaction tagging, dashboard dismiss/confirm, and Settings recurring management are implemented.

**This file** documents the original design and **remaining / future** enhancements (below), not open MVP work.

**Related:** `frontend/src/pages/DashboardPageV2.tsx` → `detectRecurring`, `recurring_merchant_override`

---

## Problem

The current recurring detection is a pure heuristic: same merchant string appearing in 2+ months with stable amounts. It has two failure modes:

1. **False positives** — variable discretionary spend (dining, groceries) appears as "recurring" when the merchant happens to repeat across months with similar amounts. Hardcoded category exclude lists partially mitigate this but require code changes when categories change.

2. **False negatives** — legitimate recurring payments with messy ACH merchant strings (e.g. `GOLDMAN SACHS BA DES:TRANSFER ID:XXXXXXXXXX46968`) don't normalize to a clean merchant key, or have amounts that vary (price increases, add-ons) and fail the CV gate.

Neither failure mode can be fully solved by a smarter algorithm. The algorithm can surface good candidates; only the user can confirm what is actually a recurring obligation in their household.

---

## Proposed Solution: Hybrid Transaction Tagging + Override Store

### Core idea

Users mark recurring payments **from within the transaction view** — where they are already looking at their data. One action retroactively tags all matching historical transactions and pins the merchant as recurring on the dashboard. A dismiss action permanently suppresses false positives.

The heuristic becomes a **suggestion engine**, not an authority. User overrides always win.

---

## User Flow

### Marking a recurring payment (transaction view)

1. User is in `/transactions`, sees a charge (e.g. `AT&T INTERNET` or `NETFLIX.COM`).
2. Each transaction row has a subtle recurring indicator icon (empty = untagged, filled = confirmed recurring).
3. User clicks the icon or a context menu "Mark as recurring".
4. A confirmation popup appears:
   - **Merchant match string** — pre-filled with the normalized merchant name, **editable**. For clean merchants: `Netflix.com`. For messy ACH strings: user can trim `GOLDMAN SACHS BA DES:TRANSFER ID:XXXXXXXXXX46968 INDN:Account Holder` down to `GOLDMAN SACHS BA`.
   - **Match preview** — "This will apply to **N transactions** matching this string" — live count updates as user edits the match string.
   - **Amount anchor** — pre-filled with median of matched transactions. User can adjust or clear.
   - **Amount tolerance** — default ±15%. Handles price increases (Netflix $16.99 → $18.99 = 12% delta, within tolerance).
   - Confirm / Cancel.
5. On confirm: `recurring_merchant_override` row is written with `verdict = confirmed`. All matching historical transactions get a `recurring_tag = true` flag (or derived from the override at query time — see data model below).
6. Dashboard recurring module immediately shows the confirmed merchant, bypassing the heuristic.

### Dismissing a false positive (dashboard)

1. On the dashboard recurring module, each item has a dismiss (×) button.
2. On dismiss: `recurring_merchant_override` row written with `verdict = dismissed`.
3. Item disappears from the module immediately and never resurfaces regardless of heuristic.

### Editing or removing an override (settings or transaction view)

- Confirmed recurring transactions show a filled recurring icon in the transaction list.
- Clicking the icon on a confirmed transaction opens the same popup, pre-filled, with an option to remove the override.
- Alternatively, a `/settings/recurring` page lists all overrides (confirmed + dismissed) with edit/remove.

---

## Matching Logic

Matching runs in two stages:

### Stage 1 — Merchant string match

- Normalize both stored `merchant_key` and transaction merchant: lowercase, trim whitespace.
- Match if transaction merchant **contains** the stored key as a substring.
  - Stored key `goldman sachs ba` matches `goldman sachs ba des:transfer id:xxx...`
  - Stored key `netflix.com` matches `netflix.com` exactly.
- This allows users to trim ACH strings to just the meaningful prefix.

### Stage 2 — Amount proximity (when amount_anchor is set)

- `|transaction_amount - amount_anchor| / amount_anchor <= amount_tolerance_pct`
- Default tolerance: 15%. Handles minor price increases and temporary add-ons.
- If `amount_anchor` is null (user cleared it): amount check is skipped — all merchant matches qualify.

A transaction matches an override if it passes Stage 1 **and** Stage 2 (when anchor is set).

---

## Data Model

### New table: `recurring_merchant_override`

```sql
CREATE TABLE recurring_merchant_override (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  merchant_key         TEXT NOT NULL,          -- normalized, editable by user
  display_name         TEXT,                   -- user-friendly label (optional)
  verdict              TEXT NOT NULL CHECK (verdict IN ('confirmed', 'dismissed')),
  amount_anchor        NUMERIC(12,2),          -- nullable; median amount at time of tagging
  amount_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  tagged_by_user_id    UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant_key)
);
```

### No changes to `transaction_canonical`

Recurring status is **derived at query time** from `recurring_merchant_override` — no denormalized flag on the transaction row. This keeps the canonical table clean and means override edits immediately reflect everywhere without a backfill.

---

## Dashboard Integration

The dashboard recurring module queries in two passes:

1. **Confirmed overrides** — fetch all `confirmed` overrides for the household. For each, compute `medianAmount` from matching transactions in the active month window. Always show, sorted by amount desc.

2. **Heuristic candidates** — run existing `detectRecurring` logic on recent transactions, filtered to exclude any merchant already covered by an override (confirmed or dismissed). Show with a "confirm / dismiss" affordance.

Final list = confirmed overrides (top) + heuristic candidates (below, labeled "Suggested").

---

## Transaction View Integration

- Add a `recurring` indicator column/icon to the transaction row (small, unobtrusive).
- Derived: transaction is "recurring" if its merchant + amount matches any `confirmed` override for the household.
- Clicking the icon opens the tagging popup described above.
- Filter bar in transaction view: add "Recurring only" toggle — useful for auditing confirmed recurring charges.

---

## What This Does Not Solve (Deferred)

- **One-time vs subscription same merchant** (e.g. Anthropic API one-time charge vs Claude subscription): amount anchor + tolerance partially handles this — a $200 one-time charge won't match an anchor of $20 ±15%. But if amounts overlap, it's ambiguous. Future: per-transaction manual override to exclude a specific transaction from a recurring pattern.
- **Shared/split recurring** (e.g. shared Netflix account): out of scope for now.
- **Upcoming bill detection / prediction**: using recurring patterns to predict next charge date and amount. Future feature — requires cadence detection (monthly, weekly, annual).
- **Annual subscriptions**: current CV + 2-months gate misses annual charges. Future: detect single annual charge pattern separately.

---

## Implementation Phases

### Phase 1 — Override store + dashboard dismiss
- Migration: `recurring_merchant_override` table
- API: `POST /recurring-overrides` (confirm/dismiss), `GET /recurring-overrides`, `DELETE /recurring-overrides/:id`
- Dashboard: dismiss button on heuristic candidates → writes dismissed override
- Dashboard: confirmed overrides always shown above heuristic candidates

### Phase 2 — Transaction view tagging
- Recurring icon on transaction rows (derived from overrides)
- Tagging popup with editable merchant string + live match count + amount anchor
- "Recurring only" filter in transaction view

### Phase 3 — Settings page
- `/settings/recurring` — list all overrides, edit merchant key / amount anchor / tolerance, remove
