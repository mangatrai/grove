# Development checkpoint

**Last updated:** 2025-03-24 (session handoff — pick up from here anytime)

This file is the **single place** to see what the repo actually does today vs the backlog, and what to do next.

---

## How to run

| Action | Command |
|--------|---------|
| Install + DB + seed | `npm run setup` (repo root) |
| Backend tests | `cd backend && npm test` (runs prep DB + migrations + Vitest) |
| Frontend typecheck | `cd frontend && npm run lint` |
| Dev: API + UI | `npm run services:start` or two terminals: `npm run dev` (backend), `npm run dev:frontend` |

Default **UI:** `http://127.0.0.1:3000` · **API:** `http://127.0.0.1:4000` · See root `.env` for `PORT` / `FRONTEND_PORT`.

---

## Implemented (high level)

| Area | What exists |
|------|-------------|
| **Auth** | Login, JWT, household-scoped routes |
| **Import** | Session → upload → bind account/profile → parse → canonicalize; staging **deleted after successful canonicalize** |
| **Dedupe (Epic 4.2)** | `transaction-fingerprint.ts` — stable date/amount/description; exact fingerprint dedupe; **near-duplicate** path (same account/date/amount, compatible description) → **`resolution_item`** (`duplicate_ambiguity`), not posted; **`nearDuplicates`** in canonicalize response |
| **UI** | Import workspace, ledger (`/transactions`), **Review queue** (`/resolution`), home; **Vite proxy** includes `/resolution` (see `frontend/vite.config.ts`) |
| **Import UX** | When session is **`review`** / **`finalized`** / **`failed`**, uploads **hidden**; **“Start another import session”** + copy (dedicated in-session transaction review is future / Epic 6) |
| **Operator purge** | `npm run import:purge` — see `docs/IMPORT_STAGING_PURGE.md` |
| **Tests** | `prep-test-db.sh` + `clean-import-session-dirs.mjs` + Vitest global teardown; integration tests include canonicalize idempotency + near-duplicate |

---

## Key docs (by topic)

| Topic | File |
|----------|------|
| Backlog & epics | `docs/MVP_BACKLOG.md` |
| Import API | `docs/API_IMPORT_SESSIONS.md` |
| Canonicalize | `docs/API_IMPORT_SESSIONS.md` (canonicalize section includes `nearDuplicates`) |
| Ledger API | `docs/API_LEDGER.md` |
| Resolution queue API | `docs/API_RESOLUTION.md` |
| Staging purge | `docs/IMPORT_STAGING_PURGE.md` |
| Payslip (planned v1) | `docs/PAYSLIP_V1.md` |

---

## Sensible next steps (not started)

1. **Epic 6 continuation:** `PATCH` resolution items (resolve/dismiss), link **Review queue** rows to ledger / raw context in UI.
2. **Payslip v1 (3.3a):** IBM summary strip + storage — **after** you schedule it (`docs/PAYSLIP_V1.md`).
3. **Epic 3.2:** More bank PDF adapters — deprioritized until polish; see backlog planning note.
4. **Backlog hygiene:** Keep Story **4.2** / **6** entries in `MVP_BACKLOG.md` in sync with this file when you ship more.

---

## Quick file map (dedupe + resolution)

- `backend/src/modules/canonical/transaction-fingerprint.ts` — fingerprint contract
- `backend/src/modules/canonical/canonical-ingest.service.ts` — ingest + near-duplicate + `deleteStagingFilesForSession`
- `backend/src/modules/resolution/resolution.service.ts` + `resolution.routes.ts` — `GET /resolution`
- `frontend/src/pages/ResolutionQueuePage.tsx` — read-only queue UI
- `frontend/src/pages/ImportWorkspacePage.tsx` — import flow + closed-session upload UX
