# Import classification, dedupe, and rules

This document explains **all automated behaviors** when statements are imported (parse → canonicalize). The **Categories → Rules** UI (`/categories/rules`) manages **household** rules and **global built-in** rules (stored in Postgres).

## 1. Category assignment (`transaction_canonical.category_id`)

**Order of evaluation** (see `classifyWithRules` in `backend/src/modules/category/category-rules.ts` and `listEnabledDbRulesForClassification` in `category-rules.service.ts`):

1. **`category_rule` table** (per-household rows from `/categories/rules`) — ordered first; first match wins on **fingerprint-normalized** description (lowercase, alphanumeric + spaces). Each row has **`amount_scope`** (`any`, `credit_only`, `debit_only`), same semantics as built-ins.
2. **`category_rule_global` table** — installation-wide defaults (former keyword heuristics), merged **after** all enabled household rules for that household. Each row has **`amount_scope`** (`any`, `credit_only`, `debit_only`).

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

## 2. Exact duplicate → Needs Review (CR-080)

Same **fingerprint** (account + date + rounded amount + normalized description) **or** same **FITID/reference_id** as an existing posted row from a previous import → the row is inserted as **`status = 'duplicate'`** and a **`resolution_item(type: duplicate_ambiguity, kind: 'exact_duplicate')`** is created. It surfaces in **Transactions → Needs review** with the label **"Exact duplicate"**.

User actions:
- **Resolve (keep):** closes the flag and promotes the canonical to `status = 'posted'` with a fresh fingerprint (the original row retains the dedup fingerprint so future re-imports still detect it).
- **Trash (discard):** sets `status = 'trashed'` via the standard trash action.

**Idempotency guard:** before the fingerprint/FITID check, canonicalize checks whether the raw row already has any canonical row (`source_ref = 'raw:' || raw_id`). If it does, the row is skipped — repeated `canonicalize` calls on the same session remain a no-op.

**In-session dedup** (same file uploaded twice within one session): still silently skipped. Only cross-session duplicates (matching an existing DB row) are surfaced as exact duplicates.

**Schema:** migration `0012_exact_duplicate_review.sql` narrows `uq_transaction_canonical_fingerprint` to a **partial unique index** (`WHERE status NOT IN ('duplicate', 'trashed')`) so a `duplicate`-status row can share a fingerprint with the original `posted` row.

See `canonicalizeImportSession` in `backend/src/modules/canonical/canonical-ingest.service.ts`.

## 3. Near-duplicate queue

Same account, date, and amount as an existing row, with a **similar but not identical** normalized description → **`resolution_item(type: duplicate_ambiguity, kind: 'near_duplicate')`** created on the **raw** row; the new row is **not** inserted into `transaction_canonical` (unlike exact duplicates). Near-duplicate rows do **not** appear in the ledger view — they are visible only via `GET /resolution`.

## 4. Transfer detection

After inserts, the service scans for cross-account debit/credit pairs (amount match, date window). **Ambiguous** pairings create **`transfer_ambiguity`** resolution items. Confirmed pairs get **`transfer_group_id`**.

## 5. Reconciliation

Statement-level reconciliation (when implemented in your file flow) can surface **`reconciliation_mismatch`** items — see ledger/resolution modules.

## Related docs

- `docs/ARCHITECTURE.md` — high-level strategy sections
- `docs/API_CATEGORIES.md` — `/categories` and `/categories/rules` APIs
- `docs/CATEGORIZATION_ROADMAP.md` — limits of keyword rules, “needs review” vs classification, air-gap–friendly improvement tiers (memory → fuzzy → optional local ML)
