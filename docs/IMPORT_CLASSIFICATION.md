# Import classification, dedupe, and rules

This document explains **all automated behaviors** when statements are imported (parse → canonicalize). The **Categories → Rules** UI (`/categories/rules`) manages **household** rules and **global built-in** rules (stored in SQLite).

## 1. Category assignment (`transaction_canonical.category_id`)

**Order of evaluation** (see `classifyWithRules` in `backend/src/modules/category/category-rules.ts` and `listEnabledDbRulesForClassification` in `category-rules.service.ts`):

1. **`category_rule` table** (per-household rows from `/categories/rules`) — ordered first; first match wins on **fingerprint-normalized** description (lowercase, alphanumeric + spaces). Household rules use **any** amount scope unless you model otherwise.
2. **`category_rule_global` table** — installation-wide defaults (former keyword heuristics), merged **after** all enabled household rules for that household. Each row has an **`amount_scope`** (`any`, `credit_only`, `debit_only`) so inflow vs outflow behavior matches the old engine.

Built-in rows use stable **`rule_key`** values (examples):

| Direction | rule_key (examples) | Intent |
|-----------|----------------------|--------|
| Inflow | `income_refunds_refund`, `income_rental_rental_income`, `income_interest_*`, `income_salary_*` | Refunds, rent, interest, dividends, payroll |
| Outflow | `housing_*`, `utilities_*`, `dining_*`, `coffee_*`, `groceries_*`, `transport_*`, `debt_*`, `medical_*`, `pharmacy_*` | Bills, food, fuel, debt, health |

If nothing matches, **`category_id` is null** and an **`unknown_category`** resolution item may be created (see canonical ingest).

### Global built-in vs household categories

**Household rules** (`category_rule`) may assign any **leaf** category visible to the household, including categories the household created (`household_id` set on `category`).

**Global built-in rules** (`category_rule_global`) apply to **every** household on the server. Their **`category_id` must reference a global default leaf**: `category.household_id IS NULL` and the category has **no children**. You cannot point a built-in rule at a household-scoped category; use a **household** rule for custom taxonomy (e.g. a custom “Loans” leaf). The API returns **`BUILTIN_REQUIRES_GLOBAL_LEAF`** when a built-in create/update would violate this.

### Classification matcher preview (import session)

**`POST /categories/rules/rule-learning-preview`** with an `import_session` id runs the same **`classifyWithRules`** matcher over **`transaction_raw`** rows for that session. It performs **no writes**: no ledger updates, no rule creation, no category persistence. The UI surfaces this on **`/imports/:sessionId`** as **Classification matcher preview (read-only)** so it sits next to parse/import workflow; use it to tune rules before or after canonicalize.

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
