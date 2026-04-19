# Import pipeline simplification — backlog

**Status:** Backlogged. Do not build until groomed.
**Origin:** Pre-production review, 2026-04-19. Current pipeline is functionally correct but exposes too many internal ETL steps as user-facing actions.

---

## Problem statement

The current import flow leaks internal pipeline stages into the UI. A user importing a single bank statement must navigate six discrete steps:

1. Create session
2. Upload file
3. Bind file → account + parser profile (separate PATCH)
4. Click Parse
5. Click Canonicalize
6. Click Finalize

Steps 3–6 are implementation details of the ETL pipeline, not meaningful decisions for the user. The result is high click-through friction for the most common operation in the app.

---

## Target experience

**Three steps, visible to the user:**

```
Upload → Review → Confirm
```

1. **Upload** — user drops a file, picks an account. Parser is auto-detected; user can override.
2. **Review** — preview table renders immediately (same response as upload). User sees row count, date range, duplicate count before committing.
3. **Confirm** — one button. Canonicalize + finalize happen atomically.

Undo is available from import history after confirmation, not as a session state.

---

## Proposed API

```
POST /imports/upload
  multipart: file, account_id, parser_profile_id (optional — auto-detect)
  → 200 { importId, preview: { rows[], count, dateRange, duplicateCount } }
  → 202 { importId, pollUrl } if parsing is async (large file)

POST /imports/{importId}/confirm
  → 200 { imported: N, duplicates: N, transfersPaired: N }

DELETE /imports/{importId}
  → 200 rollback (available before confirmation; replaces undo-import)

GET /imports/{importId}/status          (for async parse poll only)
  → 200 { status: 'parsing' | 'ready' | 'confirmed', preview? }
```

Old session endpoints (`POST /imports/sessions`, `PATCH .../files/{id}`, `POST .../parse`, `POST .../canonicalize`, `PATCH .../status`) are deprecated but can be left in place behind a flag or removed in the same release.

---

## What stays the same internally

- `import_session` table — keep as internal tracking. `importId` in the new API is the session ID.
- `transaction_raw` — unchanged. Parse output still lands here.
- Canonical ingest — zero changes. Same dedup, classification, transfer detection logic.
- Multi-file imports — still possible: call `POST /imports/upload` twice, then `POST /imports/{id}/confirm` for each. Batch confirm can be a follow-on story.

---

## Parser auto-detection

Auto-detection should cover the common cases so the user rarely has to pick manually:

| Signal | Parser |
|---|---|
| CSV with header `Date,Description,Amount,Running Bal.` | BoA checking/savings |
| CSV with header `Transaction Date,Post Date,Description,Category,Type,Amount,Memo` | Chase card |
| CSV with header `Date,Description,Credit,Debit` | Citi card |
| PDF with "Bank of America" in first-page text | BoA e-statement |
| PDF with "Marcus by Goldman Sachs" | Marcus savings |

Detection logic belongs in a new `detect-parser-profile.ts` utility, callable from the upload handler. Fall back to requiring user selection when ambiguous.

The last-used parser for an account should be remembered (`financial_account.last_parser_profile_id` or similar) and pre-selected on the next import for that account.

---

## UI changes (notes for grooming)

- Replace the multi-page import wizard with a two-panel layout: left = upload + account picker, right = preview table.
- Preview table should render as soon as the upload response arrives (no separate "parse" action).
- "Import N transactions" button is the only CTA after preview. Disabled until preview is loaded.
- Import history page: add an "Undo" button per past import (available while within the rollback window and no manual edits touch the rows since).
- Parser override dropdown: show on upload form, pre-selected by auto-detect, collapsible/"Advanced" if you want to reduce noise.

---

## Migration / compatibility notes

- The old session-based API endpoints can be deprecated in the same release or left in place as an alias. Since the only consumer is the first-party frontend, removal is safe as long as both are updated atomically.
- No schema migration required for the core simplification. `import_session` continues to be the backing record; the new API just collapses how it's created and advanced.
- `financial_account.last_parser_profile_id` would require a new migration if you build the "remember last parser" feature.

---

## Out of scope for this backlog item

- Batch multi-file confirm UI (fine as a follow-on)
- Drag-and-drop from email attachments
- Automatic scheduled imports / bank sync (separate feature, separate backlog)
- Changing the canonical ingest logic

---

## Grooming checklist (do before building)

- [ ] Decide on sync vs. async parse: is 200ms parse latency acceptable for the upload response, or do we need the poll flow? (Likely sync is fine for all current adapters.)
- [ ] Decide rollback window: time-based (e.g. 30 days) or condition-based (no manual edits to those rows)?
- [ ] Confirm parser auto-detection coverage for all active bank adapters at build time.
- [ ] Decide whether old session endpoints are deprecated-but-kept or removed in the same release.
- [ ] UX: single-page layout vs. stepper — decide before frontend work starts.
