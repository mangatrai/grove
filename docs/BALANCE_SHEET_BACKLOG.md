# Balance sheet and net worth (backlog)

Planned product work for a household **cash / net-worth summary** distinct from the transaction ledger. **Not implemented** as of this document; **BoA statement balances** are now captured on import in `import_file.confidence_summary.statementBalances` (see parse paths) as a feeder for future snapshots.

## Epic: Summary page (working name)

**Goal:** A dedicated page (name TBD: **Summary**, **Net worth**, or **Balances**) that answers: “What do we have vs what we owe?” at a glance, with optional history.

### Stories

1. **Assets vs liabilities layout**  
   Two-column (or grouped) view of **financial accounts** from Settings → Connected accounts. Classify by account type / user tags: **assets** — liquid cash (checking, savings), investments; **liabilities** — credit cards, loans, mortgages, HELOCs. Align labels with `financial_account` / institution metadata.

2. **Balances over time**  
   **Time-slice** selection: e.g. end of last calendar year, end of last month, custom `as_of` date. Data sources: (a) **import-derived** ending balances from statement parsers (e.g. BoA `statementBalances.asOfEnd` / `ending`), (b) **manual** balance entry with audit (`updated_at`, optional note).

3. **Charts**  
   Line or area chart: total assets, total liabilities, net (assets − liabilities) over time. Optional per-account drill-down.

4. **Editable balances**  
   User can correct or enter a balance for an account at a date; store **source** (`import` | `manual`) and timestamp. Display should show the balance as-of date clearly (e.g. label: “Balance on 2026-01-31”).

5. **Household vs member**  
   Respect **belongs-to** / owner scope on accounts (same model as Settings → Accounts) for filtering or subtotals.

## Data model (future)

Likely a dedicated table, e.g. `account_balance_snapshot` (`financial_account_id`, `as_of_date`, `amount`, `currency`, `source`, `import_file_id` nullable, `created_at`). `import_file.confidence_summary.statementBalances` remains useful for **debugging and single-file context** until snapshots are normalized.

## Related

- [`USER_GUIDE.md`](USER_GUIDE.md) — import lifecycle; ledger vs payslip.  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — ingestion layering.  
- [`PAYSLIP_V1.md`](PAYSLIP_V1.md) — payslip is not bank balance (different domain).
