# Requirements Traceability and Scope

**Implementation progress:** See **`docs/CHECKPOINT.md`** for what is ✅ shipped, 🟡 partial, or ⬜ not started in the repo. This file stays requirements-oriented; the checkpoint is the live status board.

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
- [x] Statement batch can be uploaded in one operation. (import session + multi-file)
- [ ] Parsed transactions enter inbox with confidence labels. (partial: **`classification_meta`** + resolution summary for some paths)
- [ ] User can bulk approve and bulk edit. (partial: resolution **status** bulk + **`unknown_category` bulk category** via **`/resolution/bulk-apply-category`**; not full “bulk edit all fields”)
- [x] Duplicate upload produces zero duplicate posted transactions. (fingerprint + idempotency)
- [x] Unknown category / transfer ambiguity routes to resolution queue. (`unknown_category`, `transfer_ambiguity`, `duplicate_ambiguity` — see **`docs/API_RESOLUTION.md`**)
- [ ] Final dashboard shows spending vs income and safe-to-spend. (partial: home **`/`** — cash KPIs, category charts, **period comparison deltas**; **no** safe-to-spend yet — **`docs/CHECKPOINT.md`**)
- [ ] Owner can view spouse + own data; spouse cannot view owner data.
- [x] Raw PDF files are deleted after successful extraction. (staging cleanup policy; see `IMPORT_STAGING_PURGE.md`)

## Open Product Questions (to finalize before implementation)
1. Exact default category taxonomy for MVP.
2. Safe-to-spend formula final version (simple vs forecast-adjusted).
3. Loan payment split policy when statement does not provide principal/interest split.
4. Minimum institution parser set for first production month.
5. Reconciliation tolerance thresholds (amount/date windows).

