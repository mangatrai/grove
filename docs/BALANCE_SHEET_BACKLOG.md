# Balance sheet and net worth

Household **assets vs liabilities** view, separate from the transaction ledger. **Shipped v1** (**CR-057**): **`GET /reports/balance-sheet`**, **`POST/PATCH /reports/balance-sheet/manual`**, table **`account_balance_snapshot`**, UI **`/net-worth`**.

## Shipped (minimal v1)

- **API:** [`docs/API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md) — **`asOf`** query; manual snapshots win; then **`source = import`** snapshots from `account_balance_snapshot`; then **`confidence_summary.statementBalances`** on the latest parsed `import_file` (fallback).
- **Data:** `account_balance_snapshot` (PG migrations **`0005`**, **`0006`** import uniqueness; SQLite mirrors in `backend/db/migrations/`). Successful bank parses with `statementBalances.ending` + `asOfEnd` upsert **`source = import`** rows.
- **UI:** Sidebar **Net worth** — totals + asset/liability tables + manual entry form.
- **Import snapshots (CR-061):** Bank parse persists **`source = import`** `account_balance_snapshot` rows when statement period end is known; balance sheet API prefers them over **`confidence_summary`** alone.
- **History (CR-062):** **`GET /reports/balance-sheet/history`** + **Net worth → Trend** chart (assets, liabilities, net over sampled dates).

## Deferred

1. **Per-account trend lines** on the net worth chart (history API currently returns **totals** only; extend with optional `includeAccounts` if needed).
2. **Full “balances over time”** — multi–time-slice comparison, statement-period alignment beyond sampled `asOf` lists.
3. **Household vs member subtotals** on this page (accounts already have owner scope; filtering not in v1 UI).

### Original story list (for reference)

1. **Assets vs liabilities layout** — **partially shipped** (type-based classification: checking/savings/investment vs credit_card/loan/mortgage).
2. **Balances over time** — **partially shipped** via **`/balance-sheet/history`** + trend chart; deeper comparison UX still deferred.
3. **Charts** — **shipped** (totals trend); per-account chart lines deferred.
4. **Editable balances** — **shipped** via manual POST/PATCH; import remains read-only hints.
5. **Household vs member** — **deferred** for this page.

**BoA statement balances** are stored in `import_file.confidence_summary.statementBalances` on parse and are **also** persisted to `account_balance_snapshot` when `asOfEnd` is a usable date, so net worth does not depend only on JSON in the long run.

## Related

- [`USER_GUIDE.md`](USER_GUIDE.md) — import lifecycle; ledger vs payslip.  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — ingestion layering.  
- [`PAYSLIP_V1.md`](PAYSLIP_V1.md) — payslip is not bank balance (different domain).
