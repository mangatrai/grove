# Export/Import backlog

**Scope:** Optional follow-ups for household export/restore flows.

---

## ~~2026-04-30 — Restore identifier hardening~~ — **Done (FIX-138, 2026-05-05)**

- **Shipped:** `assertRestoreInsertColumnNames` in `backend/src/modules/export/restore-insert-validation.ts`, called from `txInsertObject` in `import-household-bundle.service.ts`. Keys must match `^[a-z_][a-z0-9_]*$` or restore fails with a clear error.

---

## ~~2026-04-30 — Cleanup rejected restore upload temp files~~ — **Done (FIX-138, 2026-05-05)**

- **Shipped:** `POST /exports/household/import` deletes `req.file.path` when the uploaded filename is not `.hfb` before returning `400`.

---

## Optional later

- Lightweight periodic cleanup for stale files in `data/imports-restore-upload/` (interrupted requests), if disk hygiene becomes a concern.

