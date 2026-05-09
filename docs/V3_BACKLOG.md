# V3 Backlog — Design Notes & Feature Queue

This document tracks features, design decisions, and open questions for the v3 roadmap. Captures discussions during v2 live onboarding. No code changes yet — this is the planning record.

---

## Personal Loan Tracking — Informal Lending to Friends/Family

### The problem
A personal loan to a friend is an **asset** (receivable), not an expense. The current category system has no way to express this distinction:
- Outgoing: `Loans > Personal` — treated as spending, distorts monthly cash flow
- Return: `Income > Reimbursements` — treated as new income, distorts the return month
- Multiple sends + one repayment (or vice versa) have no linkage to each other

The AI insights sees a spending spike and an income spike with no understanding they're two sides of the same event.

### Current workaround (acceptable for now)
- Tag outgoing transactions: `Loans > Personal`
- Tag return payments: `Income > Reimbursements`
- Use memo field to note "Loan to [name]" for manual reference
- Net worth impact: zero in reality, but the app shows a temporary spending hit and later an income bump — not accurate but workable

### V3 proposal — lightweight loan event tracker

Not full double-entry accounting. A simple "loan event" entity that groups transactions:

```
loan_event
  id, household_id
  label          TEXT   -- "Loan to Alex", "Loan to Mom"
  started_date   DATE
  principal_usd  DECIMAL  -- expected total lent
  status         TEXT   -- open | settled | forgiven
  notes          TEXT

loan_event_transaction
  id, loan_event_id, transaction_canonical_id
  direction      TEXT   -- 'lent' | 'repaid'
```

**UI flow:**
1. User creates a loan event with a name and expected amount
2. Tags any outgoing transactions as "lent" against that event (multi-select from ledger)
3. Tags any incoming repayment transactions as "repaid" against the same event
4. Loan detail shows: total lent, total repaid, outstanding balance, timeline

**Net worth integration:**
Outstanding balance of open loan events optionally surfaced as an asset on the net worth page (informal receivables). User can choose to include/exclude per loan event — some loans to family you never expect back.

**AI insights integration:**
Transactions tagged to a loan event are excluded from both spending totals and income totals in the prompt. The prompt receives a separate `informalLoans` block:
```json
"informalLoans": {
  "totalOutstanding": 500,
  "count": 1
}
```
LLM can then comment on receivables as part of financial health without misreading them as spending or income.

**Multiple transaction directions (your use case):**
Sending $200 + $150 + $150 to a friend = three `direction: 'lent'` entries under one loan event. Their single $500 repayment = one `direction: 'repaid'` entry. Outstanding = $0, status = settled. Works regardless of how split the cash flows are.

### Category recommendation for now
- Outgoing: `Loans > Personal` ✓ (already doing this)
- Return: `Income > Reimbursements` (best existing fit)
- Consistent category pairing is what matters until loan tracker is built

---

## Reporting — Money Flow Classification Affects Every Report, Not Just AI

### The core problem
Every report in the app treats transactions as either income or expense. That is too coarse. A personal loan to a friend, an investment contribution, a tax payment, and a restaurant bill all look identical in the cash summary — they're all "outflow." This distorts every report.

### The right taxonomy for reporting

| Flow class | Examples | Cash summary | Budget | Trends | Net worth |
|---|---|---|---|---|---|
| **Lifestyle spending** | Food, shopping, utilities, healthcare | True outflow | Budgetable | Core trend | No impact |
| **Wealth building** | Investment contributions, retirement | Outflow (separate) | Non-budgetable | Separate | Asset ↑ |
| **Tax obligations** | Federal/state tax, property tax | Outflow (separate) | Plannable | Separate | No impact |
| **Money out (temporary)** | Personal loan to friend, advance | Outflow (separate) | Non-budgetable | Excluded | Receivable ↑ |
| **Money returns** | Loan repaid by friend, reimbursement | NOT income | Non-budgetable | Excluded | Receivable ↓ |
| **Credit card payments** | Checking → credit card payment | Transfer (net zero) | Non-budgetable | Excluded | No impact |
| **True income** | Salary, dividends, rental income | True inflow | N/A | Core trend | N/A |

### How each report is currently wrong

**Cash Summary / Cash Flow**
- Lending $1,000 to a friend in April → April outflow inflated, savings rate tanks
- Friend repays in June → June inflow inflated, savings rate spikes
- Neither month reflects actual lifestyle reality
- Investment contributions look like spending, not wealth building
- Tax payments are buried in the outflow total with groceries

**Budget page**
- `Loans > Personal`, `Investments > Stocks` etc. have no natural budget
- These appear as unbudgeted spending spikes in the overage report
- Parent category rollups are skewed by one-off money movements

**Spending trends / category breakdown**
- Month-over-month chart shows volatility that isn't real consumption change
- A $5k loan to a sibling is visually identical to a $5k spending month
- No way to see "what did we actually spend on lifestyle this month" without mentally filtering

**Net worth**
- Lending $1,000 reduces net worth by $1,000 even though wealth didn't change — you hold a receivable
- Investment contributions to accounts not in the household look like wealth destruction
- Outstanding personal loans are invisible assets

### The fix — category-driven flow classification

The category tree already encodes the right semantics. Map top-level parent categories to flow classes:

```typescript
const FLOW_CLASS: Record<string, FlowClass> = {
  'Income':       'true_income',
  'Transfers':    'movement',
  'Loans':        'movement',
  'Borrowing':    'movement',
  'Investments':  'wealth_building',
  'Taxes':        'tax',
  // everything else → 'lifestyle'
};
```

This map lives in one place and drives all reports. No schema change needed for the basic version — category names are the signal.

### What changes per report

**Cash Summary**: split outflow into `lifestyleSpend`, `wealthBuilding`, `taxObligations`, `moneyMovements`. Split inflow into `trueIncome` and `moneyReturns`. Show savings rate calculated on lifestyle only.

**Budget**: suppress budget progress bars for non-lifestyle categories. Show them in a separate "Movements" section or hide from budget view entirely. Budget overage report only fires on lifestyle categories.

**Spending trends**: default chart shows lifestyle spending only. Toggle to include other flow classes. Labels explain what's excluded.

**Net worth**: surfacing of outstanding personal loans as informal receivables (see loan tracker proposal). Investment contributions to external accounts don't affect net worth display.

### Longer term — loan tracker closes the loop
The loan tracker proposal (see above) makes "temporary money out / money return" explicit and trackable. The flow classification handles the reporting side; the loan tracker handles the grouping and outstanding balance side. They're complementary.

### ⚠ Complexity warning — groom before implementing
This app runs on 0.25 vCPU on Koyeb. Any solution here must be simple: a lookup map on category names, applied at query time. No new tables, no materialised views, no background aggregation jobs. If the fix requires significant compute or schema complexity it is the wrong fix. Revisit and groom properly before touching any code — do not implement speculatively.

---

## Transaction Taxonomy — Money Flows Are Wider Than Spending vs Transfer

### The gap
Transfer detection handles intra-household account movements well. But there is a large class of transactions that are neither "real spending" nor "internal transfers" — and the app has no way to distinguish them:

| Flow type | Example | Currently treated as |
|---|---|---|
| Personal loan out | Zelle $500 to friend | Spending |
| Loan repayment received | Friend pays back $500 | Income |
| Shared expense reimbursement | Friend pays their half of dinner | Income |
| Investment contribution (external) | 401k deduction via payroll | Spending |
| Rent received from tenant | Monthly rental income | Income (correct, but mixed with salary) |
| Employer expense reimbursement | Company repays travel | Income |
| Credit card payment | Checking → credit card | Transfer (if detected) or spending (if not) |

### Spouse / cross-person transfers — confirmed working
Transfer detection queries by `household_id` only, no `user_id` or `person_profile_id` filter. Transactions between any two different accounts in the same household are eligible for transfer pairing. Spouse A → Spouse B within the same household works automatically.

### What the AI gets wrong as a result
- Personal loan months show inflated spending
- Reimbursement months show inflated income and savings rate
- Investment contributions look like spending rather than wealth building
- The LLM benchmarks lifestyle spending against an inflated number

### V3 fix — category-driven flow classification in insight queries

The category tree already encodes the right semantics. The insight queries should use it:

**Exclude from lifestyle spending totals** (these are not consumption):
- `Transfers > *` — internal movement (transfer_group_id handles confirmed pairs; category filter catches the rest)
- `Loans > *` — asset movement (lending out or repaying a loan)
- `Borrowing > *` — liability movement
- `Investments > *` — wealth building, not spending
- `Income > Reimbursements` — return of prior outflow, not new income

**Keep but separate in prompt** (real but non-lifestyle):
- `Taxes > *` — real cash out but not lifestyle; send as separate `taxBurden` field
- `Income > Salary` vs all other income — separate earned vs passive income

**Annotate the LLM prompt explicitly:**
```json
{
  "lifestyleSpendingMonthlyAvg": 4200,
  "taxBurdenMonthlyAvg": 1800,
  "investmentContributionsMonthlyAvg": 900,
  "transfersAndLoansExcluded": true,
  "dataNote": "Figures exclude intra-household transfers, loan movements, investment contributions, and reimbursements. Tax payments shown separately."
}
```

This gives the LLM accurate lifestyle spending to benchmark, separate tax context, and explicit confirmation of what was excluded.

### Implementation approach
- Add a `spending_class` map in `insight-prompt.service.ts` keyed on top-level category name
- Extend the spending query with a `WHERE COALESCE(p.name, c.name) NOT IN ('Transfers', 'Loans', 'Borrowing', 'Investments')` filter
- Split the flow totals into lifestyle vs non-lifestyle
- No schema changes needed — category names are the signal

### Grooming note — "Income > Reimbursements" category and the shared-expense netting pattern

**Context from v2 live onboarding (2026-05-08):**

User pays the full family cell phone bill, then family members Zelle their share back. The natural categorization question: where do those Zelle credits go?

**Two valid approaches:**

| Approach | Debit | Credits | Net in report |
|---|---|---|---|
| **Netting** (user's current approach) | `Utilities > Mobile Phone` | `Utilities > Mobile Phone` | Net = user's true cost ✓ |
| **Split** | `Utilities > Mobile Phone` | `Income > Reimbursements` | Full cost in Utilities + recovery in Reimbursements |

Netting is pragmatically correct for shared recurring bills. The app should not break it.

**The "Income > Reimbursements" naming problem:**
The category name implies these are income, but they are not — they are `money_return` in the flow taxonomy (recovery of a prior outflow, not new money). A blanket rule "Zelle incoming = Reimbursements" was created in the default rules and has been disabled by the user because it is too broad. Zelle credits can be:
- Shared expense recovery (cell plan, dinner, trip)
- Personal loan repayment (friend paying back $500)
- Rent from a tenant (actual income)
- Selling something

These are different flow classes and should not all land in the same bucket.

**What to groom when working on categories:**
1. Rename or clarify `Income > Reimbursements` — the word "Income" is misleading. Consider `Reimbursements & Recoveries` as a top-level category, or make "Reimbursements" a sibling of Income, not a child.
2. Audit the default global rules — any rule that maps a payment method (Zelle, Venmo, PayPal, CashApp) to Reimbursements is too broad. Remove or narrow them.
3. In the flow classification work: treat `Reimbursements` as `money_return`, not `true_income`. Same for personal loan repayments.
4. The netting pattern (crediting a category to net out a shared expense) is valid and should be preserved — do not introduce changes that break it.

---

## AI Insights — Transfer Transactions Pollute Spending Data Sent to LLM

### What's happening
The insight prompt sends `topCategories` (top 10 spending categories, 12-month average) and `avgMonthlyOutflow` to the LLM. These are computed in `insight-prompt.service.ts`. Both queries filter `transfer_group_id IS NULL` — which correctly excludes confirmed transfer pairs. But two gaps remain:

**Gap 1 — Unlinked transfers still counted as spending**
Transfers that were never confirmed as a pair (never got a `transfer_group_id`) are treated as real transactions. This happens because:
- Transfer resolution has gaps (see transfer_ambiguity bug above)
- User dismissed transfers as "Not a transfer" to clear the queue
- Auto-pairing score was below threshold and user never manually confirmed
These transactions have `transfer_group_id IS NULL` so they pass the filter and appear in spending totals and top categories.

**Gap 2 — Transfer-categorized transactions appear in top spend list**
If a transaction lands in a "Transfer Out" or "Transfer In" category (by classification rule or manual assignment) but has no `transfer_group_id`, it appears in `topCategories` with a name like "Transfers Out" — the LLM sees this as a spending category and comments on it as if money is leaving the household. It's just internal movement.

**Same gaps affect `avgMonthlyOutflow` and `avgMonthlyInflow`**: credit card payments from checking (not transfer-grouped) inflate both inflow on the credit card side and outflow on the checking side. The LLM then sees inflated cash flow numbers and inflated savings rate.

### Current state of the queries

`topSpendCategories12m`:
```sql
WHERE tc.status = 'posted'
  AND tc.transfer_group_id IS NULL   -- ✅ excludes confirmed pairs
  -- ❌ no filter on transfer-type categories
  -- ❌ no filter on unlinked-but-genuine transfers
```

`flowTotals12m`:
```sql
WHERE tc.status = 'posted'
  AND tc.transfer_group_id IS NULL   -- ✅ excludes confirmed pairs
  -- ❌ same gaps as above
```

### Fixes needed

**Fix 1 — Exclude transfer-category transactions from spending queries**
Add a category-level exclusion. The builtin category tree has transfer-type categories. Filter them out by name pattern or by a `is_transfer` flag on the `category` table:
```sql
AND NOT (COALESCE(p.name, c.name) ILIKE '%transfer%')
```
Or cleaner: add `is_transfer_category BOOLEAN DEFAULT false` to the `category` table, set it on builtin transfer categories, and filter `AND c.is_transfer_category = false`.

**Fix 2 — Exclude credit card payment transactions**
Credit card payments (checking → credit card) are a common source of double-counting. Even when not transfer-grouped, these are not real spending. A category-based or merchant-pattern exclusion covers most of these.

**Fix 3 — Annotate the prompt context**
Tell the LLM explicitly what has and hasn't been excluded:
```json
{
  "dataNote": "Transfer-grouped transactions and transfer-category transactions are excluded from spending totals. Some unconfirmed transfers may remain in figures.",
  ...
}
```
This lets the LLM contextualise any anomalies rather than misinterpreting them as real spending.

**Fix 4 — Cap/filter Uncategorized from top spend list**
"Uncategorized" appearing as a top spending category is also noise for the LLM. Either exclude it from `topCategories` or move it to a separate field (e.g. `uncategorizedMonthlyAvg`) so the LLM can address it specifically rather than treating it as a named category.

### Files to touch (when fixing)
- `backend/src/modules/insights/insight-prompt.service.ts` — `topSpendCategories12m`, `flowTotals12m`, `buildUserPrompt` annotation
- `backend/db/migrations/` — optionally add `is_transfer_category` to `category` table
- `backend/src/modules/insights/llm-provider.service.ts` — `buildUserPrompt` to add data notes

---

## Payslip — Bank Deposit Matching Is Flaky; Needs Stored Pairing

### Current behaviour (CR-068, shipped 2026-04-10)
`GET /payslips/:id` calls `findMatchedDeposits()` which queries `transaction_canonical` fresh on every request. No link is stored. The match is ephemeral and recomputed each time.

### Why the card disappears entirely (no box at all)
`findMatchedDeposits` returns `[]` immediately if `pay_date IS NULL` or `net_pay_current IS NULL` on the payslip row. When the frontend receives an empty array or no `matchedDeposits` field, it renders no card. Payslips where LLM extraction missed pay date or net pay will silently show nothing.

### Why the box shows but is empty (no match found)
`pay_date` and `net_pay_current` are set but the query returns no rows. Known causes:
- **Date window too tight**: ±3 days of `pay_date`. Some payroll processors deposit 1–2 business days after the stated pay date, or the pay date on the stub is the period end date not the actual deposit date.
- **Amount mismatch**: 1% or $0.50 tolerance. Split direct deposit (salary split across multiple accounts) means no single transaction matches the full net pay amount.
- **Account scoping**: if `person_profile.salary_deposit_financial_account_id` is set, the query is restricted to that one account. If the deposit landed elsewhere (different account, split deposit), it won't match.
- **`direction = 'credit'` filter**: depends on transactions being classified correctly on import. If a deposit was parsed as debit or direction is null, it's invisible to the matcher.

### The pairing question — dynamic vs stored

**Current model (dynamic)**: computed fresh on every GET. Zero stored state.
- Pro: always reflects latest imported transactions, no stale links
- Con: flaky, no way to confirm or lock a match, can't handle edge cases, re-broken any time tolerance logic changes

**Better model (hybrid)**: dynamic suggestion + stored confirmed match.

Proposed schema addition:
```sql
ALTER TABLE payslip_snapshot
  ADD COLUMN matched_deposit_canonical_id TEXT REFERENCES transaction_canonical(id) ON DELETE SET NULL;
```

Flow:
1. Detail page shows dynamic candidates as before (suggestions)
2. User clicks "Confirm" on a candidate → writes `matched_deposit_canonical_id` on the payslip row
3. On subsequent loads, if `matched_deposit_canonical_id` is set → show that transaction as confirmed match (no re-query needed)
4. User can "Unlink" to clear the stored ID and fall back to dynamic search
5. Manual pick: search/select any transaction from household ledger to link (handles split deposits, unusual dates)

### Re-pairing existing payslips after a fix
With the stored model: fixing the dynamic search logic (wider date window, looser tolerance, split deposit support) improves suggestions for unconfirmed payslips automatically. Confirmed (stored) links are untouched. No re-import needed. User can re-run suggestion on any payslip and reconfirm.

### Things to improve in the matching logic itself
- **Wider date window**: ±5 business days instead of ±3 calendar days — covers processing delays
- **Split deposit support**: if no single transaction matches net pay, look for a combination of same-day credits that sum to net pay (within tolerance) from the salary deposit account
- **Null pay date fallback**: if `pay_date` is null but `pay_period_end` is set, attempt match using `pay_period_end` ± a wider window
- **Surface match confidence**: show to user why a candidate was suggested (date distance, amount delta) so they can judge edge cases

### Files to touch (when fixing)
- `backend/src/modules/payslip/payslip.service.ts` — `findMatchedDeposits`, add `getConfirmedDeposit`
- `backend/db/migrations/` — add `matched_deposit_canonical_id` column
- `backend/src/modules/payslip/payslip.routes.ts` — PATCH endpoint to confirm/unlink a match
- `frontend/src/pages/PayslipDetailPage.tsx` — confirm/unlink UX on the bank deposit card

---

## Payslip Page — Summary Cards and Pending Backlog

### What "latest" means on the 4 KPI cards
The cards read `data.items[0]` — the first item from the sorted payslip list. Since FIX-157 (sort by pay period), `items[0]` is now the payslip with the most recent `pay_period_end`. So "Latest gross" and "Latest net" correctly reflect the most recent pay period.

**YTD values**: `grossPayYtd` and `netPayYtd` are taken directly from what the payslip document reported as YTD on that stub — they are not recalculated by the app. This means:
- They're only as accurate as the most recently uploaded payslip
- If the latest payslip is from Feb 2026, YTD shown is Feb 2026 YTD as printed on that stub
- The app does not sum up individual payslips to produce its own YTD — it trusts the source document

This is correct behaviour. No change needed here.

### Payslip backlog from prior sessions — to be dug through in v3
There is existing backlog around payslip features (estimated tax calculations, enhanced payslip views, etc.) captured in prior planning docs and sessions. When v3 payslip work begins, pull from:
- `docs/PAYSLIP_V1.md` — original feature spec, may have deferred items
- Prior change history entries (search `docs/CHANGE_HISTORY.md` for payslip-related CRs)
- Any other payslip-specific backlog docs

Do a full review of what was deferred before starting new payslip work in v3.

---

## 504 Timeouts on Long-Running Operations — Async Job Pattern

### Observed
Koyeb proxy (and any reverse proxy) has an HTTP timeout — typically 30–60s. Operations that call OpenAI or process large files can exceed this, resulting in a 504 even though the server is still working.

### Current state — what's already async vs what's still blocking

| Operation | Current behaviour | 504 risk |
|---|---|---|
| `POST /payslips/upload` (IBM payslip) | Synchronous — awaits OpenAI vision API inline | **High** — LLM calls regularly take 15–40s |
| `POST /imports/sessions/:id/parse` | Synchronous — awaits full file parse before responding | Medium — large CSVs or PDFs |
| `POST /imports/sessions/:id/canonicalize` | Synchronous — awaits full canonical ingest | Medium — large sessions |
| `POST /imports/sessions/:id/reconcile-payslip-async` | Synchronous despite the name — awaits reconcile before 200 | Low — usually fast |
| Export (`POST /exports/household`) | **Already async** — returns 202 + jobId, poll `GET /exports/status/:jobId` | None |
| Restore (`POST /exports/household/import`) | **Already async** — returns 202 + jobId, poll `GET /exports/import/:jobId` | None |
| Deloitte payslip (via Import) | **Already async** — queued via OpenAI async pipeline, reconciled separately | None |

The export/restore jobs already use the right pattern (`export_job` / `import_job` tables, 202 response, polling). The payslip upload and import parse/canonicalize steps do not.

### The pattern to apply (already proven in this codebase)
```
POST /payslips/upload          → 202 Accepted + { jobId }
GET  /payslips/jobs/:jobId     → { status: pending|processing|done|failed, data? }

POST /imports/sessions/:id/parse        → 202 + { jobId }
GET  /imports/sessions/:id/parse/status → { status, data? }
```

1. Route handler starts background work (detached promise, does NOT await it in the request)
2. Returns `202 Accepted` with a job ID immediately — proxy timeout is irrelevant
3. Background worker writes progress + result to a job row in DB
4. Client polls the status endpoint until `done` or `failed`
5. Frontend already navigates away / user walks away — poll resumes when they return

### Priority order for v3
1. **`POST /payslips/upload`** — most acute. Direct synchronous OpenAI call, highest 504 probability.
2. **`POST /imports/sessions/:id/parse`** — second most likely to timeout on large or multi-file sessions.
3. **`POST /imports/sessions/:id/canonicalize`** — lower risk but same fix pattern.

### Note on import session UX
The import session state machine already supports walking away — session state is persisted in DB (`import_session.status`). Making parse/canonicalize async fits naturally: the frontend can poll session status and resume from wherever the user left off. No structural rethink needed, just plumbing the 202 pattern through.

---

## BUG: Transfer Ambiguity — Confirm Button Missing After Partial Candidate Dismissal

### Scenario that triggers it
1. Transfer detection flags a debit with multiple credit candidates (e.g. two $16.23 transactions on the credit card — a genuine purchase and a payment)
2. Resolution item stored with `creditCandidates: [id1, id2]` (plural array)
3. User dismisses one candidate as "Not a transfer" — the genuine purchase clears correctly
4. Remaining two transactions (debit leg + real credit leg) are a genuine pair
5. **Green "Confirm transfer" button does not appear** — the resolution item still has `creditCandidates` in its reason JSON, not `creditId` (singular). The confirm function requires `creditId` to be present or it returns `MISSING_PAIR_IDS`

### Root cause — confirmed in live use (2026-05-07)
The reason JSON for `transfer_ambiguity` items uses `creditCandidateIds` (plural array) when the ingest found multiple possible credit legs. Both `confirmTransferPairForHousehold` and `bulkConfirmTransferPairsForHousehold` require a singular `creditId` field to be present — they return `MISSING_PAIR_IDS` and fail silently when they find an array instead.

Verified: both resolution items in the queue had this structure:
```json
{ "kind": "transfer_ambiguity", "debitId": "c6e15b23...", "creditCandidateIds": ["ae6eca88...", "b52bbaf2..."], "dateWindow": {...} }
```

No UI action can confirm these as a transfer pair. Bulk confirm also silently fails (no error surfaced to user, rows stay in queue).

### Two gaps to fix
**Gap 1 — After partial dismissal, promote surviving candidate:**
When user dismisses one candidate as "Not a transfer", check if the dismissed transaction ID appears in any other open item's `creditCandidateIds`. If only one candidate remains after removal, rewrite that item's reason JSON with `creditId` (singular) so the Confirm button becomes available.

**Gap 2 — Bulk confirm must handle the array case:**
When `creditCandidateIds` has exactly one entry, treat it as an unambiguous pair and confirm it. When it has multiple entries, surface an error ("multiple candidates — resolve individually") rather than silently doing nothing.

**Gap 3 — Silent failure in bulk confirm:**
The bulk confirm action gives zero feedback when it fails. At minimum it should toast "Could not confirm X transfers — resolve manually" rather than appearing to succeed while doing nothing.

### Workaround (current)
Dismiss both items as "Not a transfer". Transactions land in regular ledger, categorize manually as credit card payment. Net worth unaffected.

### Gap 4 — Dismissed "Not a transfer" items re-surface on every new import

**Observed in live use (2026-05-08):**
User dismisses a set of resolution items as "Not a transfer." On the next import (new statement with overlapping date range), the exact same canonical transactions are re-detected as transfer candidates and new resolution items are created. User has to dismiss them again. This repeats every import cycle.

**Why it happens:**
Transfer detection in `canonical-ingest.service.ts` runs on ALL `transaction_canonical` rows where `transfer_group_id IS NULL` within the household. Dismissing a resolution item does not mark the canonical row itself — it only closes the resolution item. On the next canonicalize run, those rows are again eligible candidates and new `transfer_ambiguity` items are generated.

**The fix — persist the dismissal decision on the canonical row:**
Add `transfer_excluded BOOLEAN NOT NULL DEFAULT FALSE` to `transaction_canonical`. When a user dismisses "Not a transfer":
- Set `transfer_excluded = TRUE` on the debit-side canonical row (and optionally the credit-side too)
- Transfer detection skips rows where `transfer_excluded = TRUE`
- The judgment sticks permanently — no re-surfacing on future imports

**Edge cases to groom:**
- What if the user made a mistake and wants to re-include a transaction? Need a "Mark as transfer candidate" action (probably a hidden/advanced action in the ledger row or resolution history).
- The flag applies to that specific row forever. Since fingerprint deduplication means the same real-world transaction maps to exactly one canonical row, this is safe — the row won't be re-created by a future import.

**DB change needed:** Migration to add `transfer_excluded` column to `transaction_canonical`.

---

### Gap 5 — Multi-day same-amount transfers create cross-match ambiguity

**Observed in live use (2026-05-08):**
User transfers $10,000 from Wealthfront → BoA on Sep 30, and again on Oct 1 (banks have daily transfer limits, so the full amount moves over two days). Transfer detection sees:
- Debit Sep 30 ($10k) → credit candidates: [Sep 30 credit, Oct 1 credit] — ambiguous
- Debit Oct 1 ($10k) → credit candidates: [Sep 30 credit, Oct 1 credit] — ambiguous

Two `transfer_ambiguity` items are created, both pointing to the same two credits. Even if the confirm button worked (Gap 1/2), the UI doesn't make clear which debit pairs with which credit.

**Root cause:**
The candidate-finding query finds all credits within ±N days of the debit with a matching amount. When two debits of the same amount fall within each other's date windows, they both claim the same candidates.

**The fix — greedy closest-date pre-assignment during ingest:**
Before writing `transfer_ambiguity` items, run a greedy matching pass across all debit-candidate pairs in the current ingest batch:
1. Score all (debit, credit) pairs by date proximity (closer = higher score)
2. Greedily assign: take the highest-scoring pair, confirm it, remove both from the pool
3. If a debit gets a unique unambiguous assignment → write `transfer_group_id` directly, no resolution item needed
4. Only write `transfer_ambiguity` for debits that remain genuinely ambiguous after greedy pass

For the Sep 30 / Oct 1 case: Sep 30 debit → Sep 30 credit (score 1.0), Oct 1 debit → Oct 1 credit (score 1.0). Both pairs confirmed automatically. No resolution items needed.

**Note:** This is a change to `canonical-ingest.service.ts` transfer detection logic. Needs careful testing.

**On window sizing (gromed 2026-05-08):** Do NOT tighten the detection window to ±1 day. Real ACH transfers between banks (e.g. BoA → Wealthfront) have 1–2 day settlement float — a transfer sent Sep 30 legitimately arrives Oct 1 or Oct 2. Tightening would cause valid pairs to miss. Keep the detection window at ±3 days. The greedy pass is for breaking ties (two same-amount debits competing for the same credit candidates), not for auto-confirming. Greedy output should be a single-candidate item (`creditId` singular) that the user confirms with one click — not a silent auto-pair.

**Preferred fix over aggressive auto-confirm: add "Undo transfer pairing".** If a greedy assignment is wrong, the user should be able to dissolve a confirmed pair and return both transactions to unlinked status. This is safer than trying to make the algorithm perfect. Design: a "dissolve pair" action on confirmed transfer transactions in the ledger (visible when `transfer_group_id IS NOT NULL`). Sets `transfer_group_id = NULL` on both legs, deletes the resolution item if any, re-opens them as candidates.

---

### Files to touch (when fixing all gaps)
- `backend/db/migrations/` — new migration: add `transfer_excluded` to `transaction_canonical`
- `backend/src/modules/canonical/canonical-ingest.service.ts` — greedy pre-assignment (Gap 5); skip `transfer_excluded` rows (Gap 4); emit `creditId` singular when single candidate (Gap 1 input)
- `backend/src/modules/resolution/resolution.service.ts` — set `transfer_excluded = TRUE` on dismissal (Gap 4); `updateResolutionStatus` dismissal cascade (Gap 1); `confirmTransferPairForHousehold` and `bulkConfirmTransferPairsForHousehold` array handling (Gap 2/3)
- `frontend/src/pages/` — resolution/needs-review page: surface bulk confirm errors to user (Gap 3)

---

## UX: Import — Auto-set "Belongs To" When Account Is Selected

### Observed
When a financial account is selected (manually or via OFX auto-detect) in the import binding table, the "Belongs To" column (person picker) does not update. It stays at whatever the draft previously held, defaulting to "Household". The user has to manually set the person even when the account is already scoped to a specific person.

### Root cause (already diagnosed)
`onAccountChange` in `ImportWorkspacePage.tsx` (~line 771) reads `owner_scope` and `owner_person_profile_id` from the current draft state instead of from the selected account object:

```typescript
// Current — ignores the account's own owner fields:
const nextOwnerScope = drafts[fileId]?.ownerScope ?? "household";
const nextOwnerPersonProfileId = drafts[fileId]?.ownerPersonProfileId ?? "";
```

The `account` object returned by `GET /imports/accounts` already carries `owner_scope` and `owner_person_profile_id` — the data is there, it's just not being used. The fix is to read from the account first and fall back to the draft:

```typescript
// Fix — account owner drives the default:
const nextOwnerScope = account?.owner_scope ?? drafts[fileId]?.ownerScope ?? "household";
const nextOwnerPersonProfileId = account?.owner_person_profile_id ?? drafts[fileId]?.ownerPersonProfileId ?? "";
```

This pattern needs to be applied in all three branches inside `onAccountChange` (inferred profile path ~line 771, payslip multi-employer path ~line 803, and the fallthrough path ~line 826).

### OFX auto-detect — also broken
Confirmed: OFX auto-detect does NOT correctly set "Belongs To" from the matched account. The OFX binding code (~line 495) uses role-based logic instead of the account's own owner fields:

```typescript
// Current — ignores the matched account's owner_scope entirely:
const ofxOwnerScope = currentRole === "member" && currentPersonProfileId ? "person" : "household";
const ofxOwnerPersonProfileId = currentRole === "member" && currentPersonProfileId ? currentPersonProfileId : null;
```

For an owner/admin user this always produces `ownerScope: "household"` regardless of which account was matched. Both the OFX path and the manual selection path need the same fix: read `owner_scope` and `owner_person_profile_id` from the matched account object.

### Behaviour after fix
- Account selected (manually or OFX) with `owner_scope: "person"` → "Belongs To" auto-sets to that person
- Account selected with `owner_scope: "household"` → "Belongs To" stays "Household"
- User can still override the auto-set value manually

### Files
`frontend/src/pages/ImportWorkspacePage.tsx` — `onAccountChange` callback (~line 771) and OFX auto-bind block (~line 495). No backend changes needed.

---

## BUG: Marcus PDF Parser — ACH Deposits Not Parsed; Opening/Closing Balance Wasted

### Observed (2026-05-08, live onboarding)
Marcus by Goldman Sachs savings statement uploaded as PDF. Only the **Interest Paid** transaction was parsed. The two ACH deposit transactions ($3,000 and $5,000) were silently dropped.

### Root cause (confirmed from PDF inspection — 2026-05-08)
The Marcus PDF is a **properly structured columnar table**: Date | Description | Credits | Debits | Balance — five clean columns. The ACH deposit description text wraps within the description cell (two lines within the cell), while the Credit and Balance amounts are in the correct columns on the same row. This is a well-formatted PDF, not a broken layout.

The problem is **`pdf-parse`**, the library the parser uses. `pdf-parse` does not understand table column structure — it extracts text in reading order and interleaves the wrapped description lines with the adjacent amount columns. The extracted text comes out as something like:

```
03/23/2026 ACH Deposit Internet transfer from BANK OF AMERICA, N.A. DDA
$3,000.00 $3,476.38
account ****************3560
```

"Interest Paid" parses correctly because its description is short enough to fit in one line within the description cell — `pdf-parse` outputs it as a single clean line: `03/31/2026 Interest Paid $4.60 $8,480.98`. The ACH description wraps, breaking the column alignment in the extracted text output.

**The fix options:**
1. **Heuristic reassembly** — the existing parser approach: detect when a line has a date + partial description but no amount, then accumulate the next line(s) until an amount is found. Update the regex/state machine to handle this interleaving pattern.
2. **Position-aware extraction** — switch from `pdf-parse` to a library that exposes x/y character coordinates (e.g. `pdf2json` or `pdfjs-dist`). Group characters by y-position (row) and x-range (column) to reconstruct the table properly. More robust but heavier lift.

Option 1 is the pragmatic fix for this statement format. Option 2 is the right long-term approach if more PDFs have this problem (Marcus, Wealthfront, future institutions).

### Additional data being wasted — opening/closing balance
The statement SUMMARY block contains:
```
Beginning Balance $476.38
Ending Balance $8,480.98
Statement Period 03/01/2026 to 03/31/2026
```

This is a direct feed for `account_balance_snapshot` (net worth history). Currently discarded. The parser should extract these and write a balance snapshot row keyed to the statement end date. This is higher-value than the transactions themselves for accounts like Marcus that are mostly savings/interest.

### Files to touch
- `backend/src/modules/imports/profiles/` — Marcus PDF adapter (find the file, likely `marcus*.ts`)
- Parser should emit: transactions (multi-line ACH fix) + one `account_balance_snapshot` entry per statement (end date, ending balance, `balance_source: 'import'`)
- `backend/tests/fixtures/` — add a redacted Marcus PDF fixture for regression test
- `backend/tests/pdf-parsers.test.ts` — add Marcus ACH deposit test cases

---

## BUG: Transactions Page — Incomplete Mantine Migration

### Observed (2026-05-07)
The Transactions page was partially migrated to Mantine 7 but has remaining custom-class elements:

1. **Category picker** — still using a custom CSS class, not a Mantine component.
2. **Group/sub-group alert** — still using a custom class, not a Mantine `Alert` component.
3. **Needs Review tab — "Add subcategory" in category picker is not clickable.** This is a functional bug, not just a style issue — likely a z-index, pointer-events, or focus-trap conflict introduced during partial migration.

### Priority
Medium. Not a blocker for v2 live use, but the non-clickable subcategory picker in Needs Review is a UX gap that will surface during active categorisation work.

### Fix scope (when addressed)
- Migrate category picker to Mantine `Select` or `Combobox` component throughout the Transactions page
- Replace group/sub-group alert with Mantine `Alert`
- Diagnose and fix the non-clickable "Add subcategory" interaction in the Needs Review tab
- Remove all custom CSS classes that Mantine already covers on this page
- Standing rule: full Mantine migration on any page touched — do not leave partial state

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

---

## Data Archival — Pre-computed Monthly Reports + Raw Data Pruning (Post-V3)

### The idea
Keeping years of raw transactions, payslips, and import files has diminishing returns and growing storage/compute cost. At some point the question "what did we spend in October 2023" does not need the full row-level transaction data — it needs a solid summary of that month.

### Proposed model
**Pre-compute and store monthly summaries** at month close (or on demand). Each summary captures:
- Total income, lifestyle spending, tax, investment contributions, money movements
- Spending by category (top-level and sub-category breakdown)
- Net worth snapshot (assets, liabilities, net worth)
- Savings rate, key KPIs
- Any notable events (large transactions above a threshold, flagged items)

Store as a `monthly_report` table row — essentially a JSON blob of the month's financial picture, generated once and kept forever.

**Raw data retention policy** (user-configurable):
- Keep full transaction-level data for X months (e.g. 24 months rolling)
- After X months: transactions archived or pruned, monthly report remains as the permanent record
- Payslip PDFs and import files similarly pruned; payslip snapshot data (numbers) kept longer or forever
- User sets their own retention window — some want 5 years of raw data, others are happy with 18 months

### What this enables
- Long-term trend analysis without the raw data cost ("how has our spending changed over 5 years")
- AI insights can reference historical monthly summaries without scanning thousands of transaction rows
- Smaller DB footprint over time — keeps the app viable on free/cheap Postgres tiers
- Export of monthly reports as PDF or JSON for personal records

### What to be careful about
- Monthly report must be generated AFTER the month is fully imported and reconciled — premature generation misses late-arriving transactions
- Pruning raw data is irreversible — must be explicit user action with strong confirmation, not automatic
- Must still be able to re-generate the report from raw data while it exists (report is a cache, not the source of truth, until raw data is pruned)
- Pruning and archival is a separate concept from the `.hfb` export — the full export already handles backup

### Priority
**Post-V3.** Foundational reporting and flow classification must come first. This is long-term infrastructure that only matters at scale (2+ years of data). Note it now so the schema and report generation are designed with archival in mind from the start.

---

*Last updated: 2026-05-08. Discussion: v2 live onboarding session.*
