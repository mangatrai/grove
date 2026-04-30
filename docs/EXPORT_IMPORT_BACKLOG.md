# Export/Import backlog

**Status:** Backlogged. Do not build until groomed.
**Scope:** Follow-up hardening and non-blocking improvements for household export/restore flows.

---

## 2026-04-30 — Restore identifier hardening (CR-125 follow-up)

- **Area:** `backend/src/modules/export/import-household-bundle.service.ts`
- **Context:** `txInsertObject` builds insert column lists from JSON object keys inside uploaded backup data.
- **Current risk level:** Low (owner/admin-only operation on self-hosted infrastructure, keys originate from app-generated `SELECT *` exports).
- **Concern:** JSON still comes from user-uploaded files, so object keys are not compile-time constants.
- **Backlog action:** Validate incoming object keys as safe SQL identifiers before building column lists.
- **Suggested guard:** Accept only keys matching `^[a-z_][a-z0-9_]*$`; reject restore rows with invalid keys and fail import with a clear error.
- **Goal:** Defense-in-depth against crafted backup files.

