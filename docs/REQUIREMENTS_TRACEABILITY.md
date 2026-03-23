# Requirements Traceability and Scope

## Priority Mapping

### P0 (Must Have for MVP)
- Household cashflow visibility (income, expense, net cashflow).
- Spending power metric with configurable monthly savings buffer.
- PDF + CSV/Excel ingestion path.
- Strict duplicate prevention.
- Bulk review/approval/correction screen.
- Correct transfer handling (credit card payment, loan payment, internal transfers).
- RBAC basics: owner full visibility, member own visibility.
- Manual single and batch edit.
- Undo import before finalize.
- Local/self-hosted with no external data egress.

### P1 (Phase 2)
- INR account support and FX conversion to USD reports.
- Tax withheld yearly summary.
- Exports (CSV/PDF/Excel).
- Notifications/scheduled reports.
- Audit trail of edits.

### P2 (Phase 3+)
- Advanced search/indexing.
- Receipt attachment workflows.
- Split transaction intelligence from receipts.
- Full configurable category/tag model and deeper rule customization.

## Explicitly Deferred to Reduce MVP Risk
- Direct bank account integrations.
- Tax prep automation (W2/1099 filing support).
- Mobile native app.
- Child/dependent functional workflows (data model only in MVP).

## Acceptance Checklist (MVP)
- [ ] Statement batch can be uploaded in one operation.
- [ ] Parsed transactions enter inbox with confidence labels.
- [ ] User can bulk approve and bulk edit.
- [ ] Duplicate upload produces zero duplicate posted transactions.
- [ ] Unknown category/transfer conflicts route to resolution queue.
- [ ] Final dashboard shows spending vs income and safe-to-spend.
- [ ] Owner can view spouse + own data; spouse cannot view owner data.
- [ ] Raw PDF files are deleted after successful extraction.

## Open Product Questions (to finalize before implementation)
1. Exact default category taxonomy for MVP.
2. Safe-to-spend formula final version (simple vs forecast-adjusted).
3. Loan payment split policy when statement does not provide principal/interest split.
4. Minimum institution parser set for first production month.
5. Reconciliation tolerance thresholds (amount/date windows).

