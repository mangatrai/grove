# Balance sheet and net worth

Household **assets vs liabilities** view, separate from the transaction ledger. **Shipped v1** (**CR-057**): **`GET /reports/balance-sheet`**, **`POST/PATCH /reports/balance-sheet/manual`**, table **`account_balance_snapshot`**, UI **`/net-worth`**.

## Shipped (minimal v1)

- **API:** [`docs/API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md) — **`asOf`** query; manual snapshots override import hints per account; optional read-only **import** balances from `import_file.confidence_summary.statementBalances` when no manual row applies.
- **Data:** `account_balance_snapshot` (PG migration **`0005`**; SQLite mirror **`0004`** in `backend/db/migrations/`).
- **UI:** Sidebar **Net worth** — totals + asset/liability tables + manual entry form.

## Deferred

1. **Charts / history UX** — line or area series of assets, liabilities, and net over time; per-account trends (see original Epic 7 intent).
2. **Full “balances over time”** — multi–time-slice comparison, statement-period alignment beyond a single `asOf`.
3. **Household vs member subtotals** on this page (accounts already have owner scope; filtering not in v1 UI).
4. **Normalized import snapshots** — writing `source = import` rows from ingestion (v1 uses `confidence_summary` read path only).

### Original story list (for reference)

1. **Assets vs liabilities layout** — **partially shipped** (type-based classification: checking/savings/investment vs credit_card/loan/mortgage).
2. **Balances over time** — **deferred** (manual date per snapshot only; no history chart).
3. **Charts** — **deferred**.
4. **Editable balances** — **shipped** via manual POST/PATCH; import remains read-only hints.
5. **Household vs member** — **deferred** for this page.

**BoA statement balances** continue to land in `import_file.confidence_summary.statementBalances` on parse; v1 reads them when no manual snapshot applies.

## Related

- [`USER_GUIDE.md`](USER_GUIDE.md) — import lifecycle; ledger vs payslip.  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — ingestion layering.  
- [`PAYSLIP_V1.md`](PAYSLIP_V1.md) — payslip is not bank balance (different domain).
