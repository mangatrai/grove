# API: Import sessions and file intake (Epic 2.1–2.3)

Base path: `/imports`  
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

Session rows are scoped by `household_id` from the JWT. Cross-household access returns **404** (not 403) to avoid leaking existence of IDs.

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

---

### `GET /imports/sessions/:sessionId`

**200:** `{ "session": { ... }, "files": [ ... ] }`  
Files include: `id`, `file_name`, `checksum`, `status`, `file_size`, `mime_type`, `uploaded_at`, `financial_account_id`, `parser_profile_id`.

**404:** Not found / wrong household.

---

### `GET /imports/sessions/:sessionId/summary`

Session processing summary (Epic 6.1-style): per uploaded file, counts of **`transaction_raw`** rows vs
**`transaction_canonical`** rows linked to raw rows from that file (`source_ref = 'raw:' || transaction_raw.id`).

**200:**

```json
{
  "sessionId": "uuid",
  "totals": { "rawRows": 10, "canonicalRows": 8 },
  "files": [
    {
      "fileId": "uuid",
      "fileName": "statement.csv",
      "status": "parsed",
      "rawRowCount": 10,
      "canonicalRowCount": 8
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

Known IDs include: `generic_tabular`, `chase_card_csv`, `citi_card_csv`, `boa_checking_csv`, `boa_savings_csv`, `boa_credit_card_csv`, `boa_estatement_pdf` (Bank of America eStatement PDF), `marcus_online_savings_pdf` (Marcus / Goldman Sachs online savings PDF).

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
- PDF (`.pdf`) — **text-based** statements only; use a named PDF profile (`boa_estatement_pdf`, `marcus_online_savings_pdf`). Scanned/image PDFs need OCR (not in MVP).

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

**Named bank profiles** (`chase_card_csv`, `citi_card_csv`, `boa_checking_csv`, `boa_savings_csv`, `boa_credit_card_csv`, `boa_estatement_pdf`, `marcus_online_savings_pdf`): mapping is **not** used; send `{}` or omit `mapping` as allowed by the route.

**200:** `{ "parsedFiles", "parsedRows", "skippedFiles" }`  
**400:** invalid payload/mapping (`code: "INVALID_MAPPING"` for generic_tabular when columns are wrong)  
**404:** session not found / wrong household  
**409:** no supported files for parsing

---

### `POST /imports/sessions/:sessionId/canonicalize`

Maps all **`transaction_raw`** rows for this session into **`transaction_canonical`** (Epic 4.1 — single ingest path with strict dedupe).

**Prerequisite:** run **`POST .../parse`** first so `transaction_raw` exists. Otherwise **409** with `code: "NO_RAW_ROWS"`.

**Body:** none (empty JSON `{}` is fine).

**200:** `{ "inserted": number, "duplicates": number, "skipped": number }`  
- **inserted** — new canonical rows (`status: posted`).  
- **duplicates** — rows whose **fingerprint** already exists for this household (re-import / re-run canonicalize).  
- **skipped** — malformed JSON or rows missing required fields / account not in household.

**404:** session not found / wrong household.

Fingerprint = `SHA-256` over `(household_id, account_id, normalized date, rounded amount, normalized description)`.
