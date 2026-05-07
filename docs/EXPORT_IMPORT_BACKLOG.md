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

- **Restore: staging file not deleted after completion** — `runImportJob` in `import-household-bundle.service.ts` reads the `.hfb` from `storage_path` but has no `unlink` in success or failure paths (unlike `runBackupJob` which cleans up in `finally`). Disk accumulates uploaded `.hfb` files for completed restores. Low urgency for self-hosted single-user, but worth fixing before high-frequency use. Add `fs.unlink(storagePath)` in a `finally` block after the job run.

- **Restore UI: warn that GDrive connection is lost** — `household_gdrive_config` is intentionally excluded from `.hfb` backups (security). After a restore the Drive connection silently disappears. The restore completion UI / success message should mention this so the user knows to reconnect in Settings → Data.

