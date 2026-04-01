# Import classification, dedupe, and rules

This document explains **all automated behaviors** when statements are imported (parse → canonicalize). The **Categories → Rules** UI (`/categories/rules`) is only **household-specific DB rules**; it is not the full picture.

## 1. Category assignment (`transaction_canonical.category_id`)

**Order of evaluation** (see `backend/src/modules/category/category-rules.ts`):

1. **`category_rule` table** (rows from `/categories/rules`) — ordered by priority; first match wins on **fingerprint-normalized** description (lowercase, alphanumeric + spaces).
2. **Default keyword rules** in `classifyDefaultCategory()` — conservative substring heuristics if no DB rule matched.

Default rules use stable **`ruleId`** strings for debugging (examples):

| Direction | ruleId (examples) | Intent |
|-----------|-------------------|--------|
| Inflow | `income_refunds_keywords`, `income_rental_income_keywords`, `income_interest`, `income_dividends`, `income_salary_inflow_keywords` | Refunds, rent, interest, dividends, payroll |
| Outflow | `housing_keywords`, `utilities_keywords`, `dining_out_keywords`, `coffee_snacks_keywords`, `groceries_merchant`, `transport_keywords`, `debt_keywords`, `medical_keywords`, `pharmacy_keywords` | Bills, food, fuel, debt, health |

If nothing matches, **`category_id` is null** and an **`unknown_category`** resolution item may be created (see canonical ingest).

## 2. Exact duplicate skip

Same **fingerprint** as an existing posted row (`household_id` + account + date + rounded amount + normalized description) → row is **skipped** (counted as duplicate). See `canonicalizeImportSession` in `backend/src/modules/canonical/canonical-ingest.service.ts`.

## 3. Near-duplicate queue

Same account, date, and amount as an existing row, with a **similar but not identical** normalized description → **`resolution_item`** type **`duplicate_ambiguity`** on the **raw** row (not posted as canonical).

## 4. Transfer detection

After inserts, the service scans for cross-account debit/credit pairs (amount match, date window). **Ambiguous** pairings create **`transfer_ambiguity`** resolution items. Confirmed pairs get **`transfer_group_id`**.

## 5. Reconciliation

Statement-level reconciliation (when implemented in your file flow) can surface **`reconciliation_mismatch`** items — see ledger/resolution modules.

## Related docs

- `docs/ARCHITECTURE.md` — high-level strategy sections
- `docs/API_CATEGORIES.md` — `/categories` and `/categories/rules` APIs
- `docs/CATEGORIZATION_ROADMAP.md` — limits of keyword rules, “needs review” vs classification, air-gap–friendly improvement tiers (memory → fuzzy → optional local ML)
