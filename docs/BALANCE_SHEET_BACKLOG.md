# Balance sheet and net worth

Household **assets vs liabilities** view, separate from the transaction ledger. **Shipped v1** (**CR-057**): **`GET /reports/balance-sheet`**, **`POST/PATCH /reports/balance-sheet/manual`**, table **`account_balance_snapshot`**, UI **`/net-worth`**.

## Shipped (minimal v1)

- **API:** [`docs/API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md) — **`asOf`** query; manual snapshots win; then **`source = import`** snapshots from `account_balance_snapshot`; then **`confidence_summary.statementBalances`** on the latest parsed `import_file` (fallback).
- **Data:** `account_balance_snapshot` (migrations **`0005`**, **`0006`** import uniqueness under `backend/db/migrations/`). Successful bank parses with `statementBalances.ending` + `asOfEnd` upsert **`source = import`** rows.
- **UI:** Sidebar **Net worth** — totals + asset/liability tables + manual entry form.
- **Import snapshots (CR-061):** Bank parse persists **`source = import`** `account_balance_snapshot` rows when statement period end is known; balance sheet API prefers them over **`confidence_summary`** alone.
- **History (CR-062):** **`GET /reports/balance-sheet/history`** + **Net worth → Trend** chart (assets, liabilities, net over sampled dates).
- **Filters + overlays (CR-064):** **`GET /reports/balance-sheet`** and **`/history`** accept optional **`ownerScope`** / **`ownerPersonProfileId`** (belongs-to). **`/history`** accepts **`accountIds`** (comma-separated, max 8) and returns optional **`accounts`** slices per point for **per-account overlay lines** on the trend chart. Net worth UI: period presets, belongs-to filter, chart account overlays, period summary table, transaction drill-downs.
- **UX polish (UX-065):** Trend control grouping; period summary as **`ledger-table`**; **Retry load** on fetch failure; layout/copy updates — see [`docs/CHANGE_HISTORY.md`](CHANGE_HISTORY.md) **CR-064** / **UX-065**.

## Deferred

1. **Richer “balances over time” UX** — multi–time-slice comparison views, statement-period alignment beyond sampled **`asOf`** lists (the chart already samples up to **120** points from existing resolution logic).
2. **Denser or persisted history** — optional product work if the team wants smoother series independent of import/parse events (no separate time-series store today; history is computed on read).
3. **Household vs member subtotals** on the net worth page (totals row is household-scoped; belongs-to **filters** which accounts appear, but subtotal breakdown rows are not shipped).

### Original story list (for reference)

1. **Assets vs liabilities layout** — **partially shipped** (type-based classification: checking/savings/investment vs credit_card/loan/mortgage).
2. **Balances over time** — **partially shipped** via **`/balance-sheet/history`** + trend chart; deeper comparison UX still deferred.
3. **Charts** — **shipped** (totals trend + optional per-account overlays via **`accountIds`**).
4. **Editable balances** — **shipped** via manual POST/PATCH; import remains read-only hints.
5. **Household vs member** — **filtering shipped** (**CR-064**); **subtotals** still deferred.

**BoA statement balances** are stored in `import_file.confidence_summary.statementBalances` on parse and are **also** persisted to `account_balance_snapshot` when `asOfEnd` is a usable date, so net worth does not depend only on JSON in the long run.

## Related

- [`USER_GUIDE.md`](USER_GUIDE.md) — import lifecycle; ledger vs payslip.  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — ingestion layering.  
- [`PAYSLIP_V1.md`](PAYSLIP_V1.md) — payslip is not bank balance (different domain).
