# API: Import sessions and file intake (Epic 2.1–2.3)

> **Undo before finalize:** **`POST .../undo-import`** (**CR-021**). See **`docs/CHANGE_HISTORY.md`** for full pipeline history.

Base path: `/imports`  
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

Session rows are scoped by `household_id` from the JWT. Cross-household access returns **404** (not 403) to avoid leaking existence of IDs.

### Role / membership rules (CR-109 Slice 3)

| Role | Import session access |
|------|----------------------|
| `owner`, `admin` | Full access — create, read, and manage any session in the household. |
| `member` (with linked person profile) | Create sessions; read and manage **only sessions they created** (`created_by_user_id`). File binding restricted to accounts owned by their person profile. Returns 403 on other sessions, 404 for GET/summary. |
| `member` (no linked profile) | 403 on all session write ops. Contact admin to link profile. |

## Session lifecycle

Valid transitions (single source of truth: `import-session.state-machine.ts`):

| Current     | May transition to   |
|------------|---------------------|
| `created`  | `processing`, `failed` |
| `processing` | `review`, `failed` |
| `review`   | `finalized`, `failed` |
| `finalized` | _(terminal)_ |
| `failed`   | _(terminal)_ |

- File uploads are allowed only when status is `created` or `processing`.
- After successful file persistence, the session is set to `processing`.

## Endpoints

### `POST /imports/sessions`

Creates a new import session.

**Body (JSON):**

```json
{ "sourceType": "upload" }
```

`sourceType`: `"upload"` | `"watch_folder"` (default: `"upload"`).

**201:** `{ "session": { "id", "householdId", "sourceType", "status" } }`

---

### `POST /imports/sessions/:sessionId/files`

Multipart form field: `files` (one or more files).

**201:** `{ "files": [ { "id", "fileName", "checksum", "status": "queued" } ], "skipped": [ ... ] }`

- `files`: newly persisted rows for this request.
- `skipped`: entries for inputs that were **not** stored because the same SHA-256 was already present in this session (`code: "DUPLICATE_CHECKSUM_IN_SESSION"`). Other files in the same multipart request are still processed.

**400:** No files.  
**404:** Session not found or not in caller’s household.  
**409:**

- `SESSION_CLOSED_FOR_UPLOAD` — session not in an upload-allowed state.

---

### `PATCH /imports/sessions/:sessionId/status`

**Body (JSON):**

```json
{ "status": "processing" }
```

**200:** `{ "sessionId", "status" }`  
**404:** Not found / wrong household.  
**409:** `INVALID_TRANSITION` with `from` / `to` in body.  
**UI:** Import workspace (**CR-022**) exposes **Finalize session** when the session is in **`review`**, sending **`{ "status": "finalized" }`**.

---

### `GET /imports/sessions/:sessionId`

**200:** `{ "session": { ... }, "files": [ ... ] }`  
Files include: `id`, `file_name`, `checksum`, `status`, `file_size`, `mime_type`, `uploaded_at`, `financial_account_id`, `parser_profile_id`.

**404:** Not found / wrong household.

---

### `GET /imports/sessions/:sessionId/summary`

Session processing summary (Epic 6): per uploaded file, parsed vs posted counts, duplicate flags, open review
items, and a derived “skipped” bucket. All per-file numbers come from one response
(no per-file follow-up calls).

- **`rawRowCount`** — rows in **`transaction_raw`** for that file.
- **`canonicalRowCount`** — canonical rows of any status linked from that file’s raw rows (`source_ref = ‘raw:’ || transaction_raw.id`). Includes **`status = ‘duplicate’`** rows created by CR-080 exact-duplicate detection (they appear in Needs Review and may be promoted to `’posted’` on resolve).
- **`nearDuplicatesFlagged`** — count of **`resolution_item`** rows with `type: duplicate_ambiguity` whose **`target_id`** is a **`transaction_raw.id`** belonging to that file. Covers both **exact duplicates** (CR-080: canonical row inserted with `status = ‘duplicate’`) and **near-duplicates** (no canonical row inserted, raw row skipped).
- **`openItemsNeedingReview`** — open or in-review items for that file: the above duplicate items, plus **`unknown_category`**, **`transfer_ambiguity`**, or **`reconciliation_mismatch`** on **`transaction_canonical`** rows sourced from that file’s raw rows.
- **`notPostedExactDuplicateOrSkipped`** — `max(0, rawRowCount - canonicalRowCount - nearDuplicatesFlagged)` — lines that are accounted for by neither a canonical row nor a duplicate flag. After CR-080, exact fingerprint duplicates are counted in both `canonicalRowCount` and `nearDuplicatesFlagged` so they cancel out here. This bucket now captures only truly skipped/invalid rows (e.g. in-session checksum duplicates that were never persisted as raw rows, rows that failed parse, etc.).

**200:**

```json
{
  "sessionId": "uuid",
  "totals": {
    "rawRows": 10,
    "canonicalRows": 8,
    "nearDuplicatesFlagged": 1,
    "openItemsNeedingReview": 2,
    "notPostedExactDuplicateOrSkipped": 1
  },
  "files": [
    {
      "fileId": "uuid",
      "fileName": "statement.csv",
      "status": "parsed",
      "rawRowCount": 10,
      "canonicalRowCount": 8,
      "nearDuplicatesFlagged": 1,
      "openItemsNeedingReview": 2,
      "notPostedExactDuplicateOrSkipped": 1
    }
  ]
}
```

**404:** Session not found / wrong household.

---

### `GET /imports/accounts`

Lists **financial accounts** for the caller’s household (for binding uploads before parse).

**200:** `{ "accounts": [ { "id", "name", "institution", "accountType", "currency" } ] }`

---

### `GET /imports/parser-profiles`

Lists supported **parser profile IDs** (bank/format adapters). The client picks one per uploaded file.

**200:** `{ "profiles": [ { "id", "label" } ] }`

Known IDs include: `generic_tabular`, `chase_card_csv`, `citi_card_csv`, `boa_checking_csv`, `boa_savings_csv`, `boa_credit_card_csv`, `boa_estatement_pdf` (Bank of America eStatement PDF), `marcus_online_savings_pdf` (Marcus / Goldman Sachs online savings PDF), **`ibm_pay_contributions_pdf`** (IBM / SuccessFactors-style **employer payslip** PDF — text-based; stores a **`payslip_snapshot`**, not ledger lines), **`deloitte_payslip_pdf`** (Deloitte Pay Statement — **async OpenAI LLM** extraction via Import).

---

### `PATCH /imports/sessions/:sessionId/files/:fileId`

Binds an uploaded file to a **financial account** and **parser profile** before parse (required for `POST .../parse`).

**Body (JSON):**

```json
{
  "financialAccountId": "uuid",
  "parserProfileId": "chase_card_csv"
}
```

Both fields are required. The account must belong to the caller’s household.

**200:** `{ "file": { ... same shape as in session list ... } }`  
**400:** validation / unknown profile  
**404:** session or file not found / wrong household

---

### `POST /imports/sessions/:sessionId/parse`

Parses supported files in a session into `transaction_raw` records.

**Prerequisite:** each file to parse must have **`financial_account_id`** and **`parser_profile_id`** set (`PATCH .../files/:fileId`). Otherwise **400** with `code: "MISSING_FILE_BINDING"`.

Supported adapters in MVP:
- CSV (`.csv`)
- Excel (`.xlsx`, `.xls`)
- PDF (`.pdf`) — profile-specific behavior:
  - `boa_estatement_pdf`, `marcus_online_savings_pdf`, `ibm_pay_contributions_pdf`: local parse path
  - `deloitte_payslip_pdf`: async OpenAI LLM payslip path (queued on `import_file`, background reconcile)

**Employer payslip (`ibm_pay_contributions_pdf`):** extraction runs the IBM payslip parser. On success, a row is written to **`payslip_snapshot`** with **`import_file_id`** set to this session file. **No** **`transaction_raw`** rows are created. **`200`** still returns **`parsedFiles`** ≥ 1 and typically **`parsedRows`: 0** (ledger line count). Duplicate payslip checksum for the household may mark the file **`failed`** / skip with a payslip-specific reason.

**Employer payslip (`deloitte_payslip_pdf`):** parse queues each Deloitte PDF for async LLM extraction (`payslip_async_provider = openai_llm_payslip` on `import_file`). `POST .../parse` returns `200` with `asyncPayslipPending` while session remains `processing`. Requires `OPENAI_API_KEY`. Poll **`POST .../reconcile-payslip-async`** until files are `parsed` and `payslip_snapshot` rows are inserted.

**Profile `generic_tabular`:** user supplies column mapping (and optional `sheetName` for Excel).

**Body (JSON) for `generic_tabular`:**

```json
{
  "mapping": {
    "date": "Date",
    "description": "Description",
    "amount": "Amount",
    "postingDate": "Posting Date",
    "referenceId": "Reference"
  },
  "sheetName": "Sheet1"
}
```

Required mapping keys: `date`, `description`, `amount`.

**Named bank/proprietary profiles** (`chase_card_csv`, `citi_card_csv`, `boa_checking_csv`, `boa_savings_csv`, `boa_credit_card_csv`, `boa_estatement_pdf`, `marcus_online_savings_pdf`, **`ibm_pay_contributions_pdf`**, **`deloitte_payslip_pdf`**): mapping is **not** used; send `{}` or omit `mapping` as allowed by the route.

**200:** `{ "parsedFiles", "parsedRows", "skippedFiles", "asyncPayslipPending?" }`  
**400:** invalid payload/mapping (`code: "INVALID_MAPPING"` for generic_tabular when columns are wrong)  
**404:** session not found / wrong household  
**409:** no supported files for parsing

---

### `POST /imports/sessions/:sessionId/reconcile-payslip-async`

Runs background OpenAI payslip extraction for Deloitte files queued in this session and inserts `payslip_snapshot` rows (canonical JSON + hybrid columns).

Query:
- `force=true|1` (optional) — bypass per-file throttle window.

Behavior:
- Reads Deloitte files with `payslip_async_provider = openai_llm_payslip` in `status = processing`.
- Throttle: `PAYSLIP_ASYNC_POLL_INTERVAL_MS` (default 120s) unless `force=true`.
- On success: vision + JSON-schema extract, Zod validation, map to snapshot, mark file `parsed`.

**200:** `{ "polledFiles", "completedFiles", "stillPending", "errors": [ { "fileId", "message" } ] }`  
**404:** session not found / wrong household  

---

### `POST /imports/sessions/:sessionId/canonicalize`

Maps all **`transaction_raw`** rows for this session into **`transaction_canonical`** (Epic 4.1 — single ingest path with strict dedupe).

**Prerequisite:** run **`POST .../parse`** first.

- If the session has **no** **`transaction_raw`** rows **and** is **not** a completed **IBM payslip-only** import, **409** with `code: "NO_RAW_ROWS"` (“run parse first”).
- **Payslip-only session:** when parse created a **`payslip_snapshot`** linked to an **`import_file`** in this session with **`parser_profile_id = ibm_pay_contributions_pdf`**, canonicalize **succeeds** with **`inserted: 0`** (and zeros for duplicates / skipped / nearDuplicates), **deletes staging** for the session, and does **not** require ledger rows.

**Body:** none (empty JSON `{}` is fine).

**200:** `{ "inserted": number, "duplicates": number, "skipped": number, "nearDuplicates": number }`  
- **inserted** — new canonical rows (`status: posted`).  
- **duplicates** — rows whose **fingerprint** already exists for this household (re-import / re-run canonicalize).  
- **skipped** — malformed JSON or rows missing required fields / account not in household.  
- **nearDuplicates** — rows that match an existing ledger row on **same account, date, and amount** with a **similar but non-identical** normalized description; **not** posted; recorded in **`resolution_item`** (`type: duplicate_ambiguity`) for future review (Epic 4.2).

After a successful response, staged import files for this session are **removed from disk** and `import_file.stored_path` is cleared.

**404:** session not found / wrong household.

Fingerprint = `SHA-256` over `(household_id, account_id, normalized date, rounded amount to cents, normalized description)`.

---

### `POST /imports/sessions/:sessionId/undo-import`

**Epic 6.3 — undo before finalize.** Removes **ledger impact** of this import while the session is still in **`review`**: deletes **`transaction_canonical`** rows whose **`source_ref`** points at **`transaction_raw`** rows in this session; deletes related **`resolution_item`** rows (including near-duplicate flags on raw ids, unknown category / transfer items on those canonical ids, and items on **partner** rows sharing a **`transfer_group_id`** with session-posted rows); clears **`transfer_group_id`** on any row in those groups before deleting session canonicals. **`transaction_raw`** rows are **not** deleted — you can run **`POST .../canonicalize`** again.

**Allowed only** when session **`status`** is **`review`**. After **`finalized`**, returns **409** with `code: "SESSION_NOT_REVIEW"` and `currentStatus`.

**Body:** none (`{}` is fine).

**200:** `{ "deletedCanonicalRows": number, "deletedResolutionItems": number }`  
**404:** session not found / wrong household.  
**409:** `SESSION_NOT_REVIEW` — session is `finalized`, `failed`, or not yet in `review`.
