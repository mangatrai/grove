# Grove — API Reference

**Machine-readable spec:** [`openapi/openapi.yaml`](../openapi/openapi.yaml) (OpenAPI 3.1).

All routes require `Authorization: Bearer <token>` (JWT) unless noted otherwise. Base URL: `http://localhost:4000` (dev) or your deployed domain (prod).

---

## Table of Contents

- [Authentication](#authentication)
- [Household & Users](#household--users)
- [Transactions (Ledger)](#transactions-ledger)
- [Categories & Rules](#categories--rules)
- [Import Sessions](#import-sessions)
- [Reports](#reports)
  - [Cash Summary](#cash-summary)
  - [Balance Sheet](#balance-sheet)
  - [Budget](#budget)
- [Recurring Payments](#recurring-payments)
- [Resolution Queue](#resolution-queue)
- [Export, Backup & Restore](#export-backup--restore)
- [Google Drive Integration](#google-drive-integration)
- [Notifications](#notifications)
- [AI Insights](#ai-insights)
- [Property Tax Protest](#property-tax-protest)

---

## Authentication

### `POST /auth/login`

**Public.** Authenticates a user and returns a JWT token.

**Response 200:**
```json
{
  "token": "eyJ...",
  "forcePasswordChange": false
}
```

- **`forcePasswordChange`** — when `true`, the client must redirect to reset-password before rendering the main app shell.

---

### `POST /auth/setup-forced-change-token`

**Auth:** Bearer JWT. **When:** `force_password_change` is `true` on the current user.

Returns a raw one-time reset token with the same TTL as email-initiated reset tokens. Used by the shell to redirect into the reset-password flow after clearing the JWT.

**Response 200:** `{ "token": "…" }`

**Response 403:** `{ "code": "NOT_FORCED" }` — flag is not set.

---

## Household & Users

### Household Settings

#### `GET /household/settings`

Returns household-level savings target plus the signed-in user's person-level income fields.

**Response 200:**
```json
{
  "monthlySavingsTargetUsd": 500,
  "salaryDepositFinancialAccountId": "uuid-or-null",
  "employers": [
    {
      "id": "uuid",
      "displayName": "Acme Corp",
      "parserProfileId": "ibm_pay_contributions_pdf",
      "parserMapping": {}
    }
  ],
  "largeTxnThresholdUsd": 5000
}
```

- **`monthlySavingsTargetUsd`** — `null` when unset. Used by cash summary for safe-to-spend calculation.
- **`salaryDepositFinancialAccountId`** — optional FK to a household `financial_account` on the signed-in user's `person_profile`.
- **`employers`** — JSON array on the signed-in user's `person_profile`. Empty when none.
- **`largeTxnThresholdUsd`** — `null` when unset. Any imported transaction exceeding this amount triggers a `large_transaction` notification.

---

## Property Tax Protest

All protest routes are mounted under `/api/protest` and require owner/admin role.

### `GET /api/protest/:propertyId/worksheet?year=YYYY`

Gets or creates a worksheet for the property and tax year. Also fires a background check for upcoming protest deadlines (filing deadline and hearing date); in-app and email notifications are emitted at 30/7/1 days before each deadline.

- **`year`** optional; defaults to current year.

**Response 200:**
```json
{
  "worksheet": {
    "id": "uuid",
    "householdId": "uuid",
    "propertyId": "uuid",
    "taxYear": 2026,
    "status": "not_filed",
    "hearingDate": null,
    "filingDeadline": null,
    "cadPortalUrl": null,
    "conversationJson": [],
    "strategyJson": null,
    "createdAt": "2026-05-28T01:00:00.000Z",
    "updatedAt": "2026-05-28T01:00:00.000Z"
  }
}
```

---

### `POST /api/protest/:propertyId/chat`

Assistant chat endpoint for protest planning and comp analysis.

**Request body:**
```json
{
  "message": "Draft my informal hearing argument.",
  "attachmentText": "Optional extracted notes",
  "attachmentType": "text",
  "year": 2026
}
```

- **`attachmentType`**: `pdf | url | text` (optional).
- Uses `OPENAI_MODEL` (default `gpt-4o-mini`) with tool calls. Available AI tools: `fetch_dcad_comps`, `refresh_redfin_comps`, `search_web` (Tavily — requires `TAVILY_API_KEY`), `update_strategy`.
- **RAG:** Each message is embedded (`text-embedding-3-small`); top-5 similar chunks from `protest_document_chunks` (cosine similarity ≥ 0.65) are appended to the system prompt.
- **Summarization:** When live (unsummarized) turns exceed 30, the server asynchronously compresses the oldest 10 turns into `conversation_summary` via gpt-4o-mini and advances `summarization_cursor`. Prior-year `cycle_summary` (if any) is injected into the system prompt.

**Response 200:**
```json
{
  "assistantMessage": "Start with unequal-appraisal comp framing...",
  "strategyUpdated": true,
  "compsAdded": 4,
  "soldCompsRefreshed": false,
  "valuationAgeHours": 30
}
```

- **`valuationAgeHours`**: Hours since `valuation_fetched_at` was last updated for this property. `null` if the property has never been valued via Redfin. Use to surface a stale-data prompt in the UI.
- **`refresh_redfin_comps` tool cooldown:** The underlying `refreshPropertyValuation()` enforces a 24-hour cooldown. If the valuation is <24 h old the tool returns a "still fresh" message to the LLM without hitting the Redfin API.

---

### `POST /api/protest/:propertyId/documents`

Upload an arbitrary supporting document (PDF or image) for RAG indexing.

**Query:** `taxYear` (optional; defaults to current calendar year).

**Request:** `multipart/form-data` with field `file` (max 20 MB).

- **PDF** (`application/pdf`): text extracted via `extractPdfText`, split into overlapping word chunks, embedded with `text-embedding-3-small`.
- **Image** (`image/jpeg`, `image/png`, `image/webp`): described via GPT-4o vision; description stored as a single chunk.

**Response 200:**
```json
{ "ok": true, "documentKey": "file:roof-report.pdf", "chunkCount": 4 }
```

**Errors:** `400` (no file / unsupported type), `404`, `422` (no extractable text), `503` (`OPENAI_API_KEY` missing).

---

### `GET /api/protest/:propertyId/documents`

List indexed documents for a property and tax year.

**Query:** `taxYear` (optional).

**Response 200:**
```json
{
  "ok": true,
  "documents": [
    { "documentKey": "cad_evidence", "chunkCount": 12 },
    { "documentKey": "image:front.jpg", "chunkCount": 1 }
  ]
}
```

---

### `DELETE /api/protest/:propertyId/documents/:documentKey`

Remove all chunks for a document. **`documentKey`** must be URL-encoded (e.g. `file%3Areport.pdf`).

**Query:** `taxYear` (optional).

**Response:** `204`

---

### `POST /api/protest/:propertyId/generate-arb-script?year=YYYY`

Generate an AI oral ARB hearing script for the protest. Requires `protest_worksheet.status === 'arb'`.

**Query:** `year` (optional; defaults to current calendar year).

**Response 200:**
```json
{
  "script": {
    "generatedAt": "2026-06-02T18:00:00.000Z",
    "targetValueUsd": 480000,
    "negotiationThresholds": {
      "openAskUsd": 460000,
      "idealSettleUsd": 475000,
      "walkAwayMinUsd": 490000,
      "rationale": "Equity median supports opening below assessed; panel typically splits the difference."
    },
    "sections": [
      {
        "step": 1,
        "title": "Opening Statement",
        "speech": "...",
        "appraiserMayRespond": null,
        "yourRebuttal": null
      },
      {
        "step": 2,
        "title": "§41.41 Market Value Argument",
        "speech": "...",
        "appraiserMayRespond": "Your property is in better condition than the comps.",
        "yourRebuttal": "..."
      }
    ]
  }
}
```

**Script persisted:** `arb_script_json` written to `protest_worksheet` and returned on subsequent `GET /worksheet` calls.

**Errors:** `400` (`STATUS_NOT_ARB` — worksheet is not in arb status), `404`, `503` (`OPENAI_API_KEY` missing).

---

### `GET /api/protest/:propertyId/comps?year=YYYY`

Returns all non-excluded comps from `protest_comp` for a property and tax year. Includes all sources: `dcad_search`, `redfin`, `manual`, `cad_evidence`.

- **`year`** optional; defaults to current year.

**Response 200:**
```json
{
  "comps": [
    {
      "id": "d0000000-0000-0000-0000-000000000001",
      "source": "dcad_search",
      "addressLine1": "456 Elm St",
      "city": "Flower Mound",
      "sqft": 1950,
      "beds": 3,
      "baths": 2,
      "yearBuilt": 2005,
      "hasPool": false,
      "cadPropertyId": "12345-000000",
      "cadAccountId": 99001,
      "cadLandValueUsd": 48000,
      "cadImprovementValueUsd": 272000,
      "cadMarketValueUsd": 320000,
      "cadAssessedValueUsd": 320000,
      "cadPerSqftAssessed": 164.1,
      "cadDeedDate": "2018-05-14",
      "soldPriceUsd": null,
      "soldDate": null,
      "pricePerSqft": null,
      "notes": null,
      "excluded": false,
      "fetchedAt": "2026-06-09T10:00:00Z"
    }
  ]
}
```

Use `source` to determine which strategy view a comp belongs to: `dcad_search` and `cad_evidence` comps appear in the Unequal Appraisal (§41.43) view; `redfin` and `manual` comps appear in the Market Evidence (§41.41) view. All non-excluded comps are returned — filter by source in the UI.

---

### `DELETE /api/protest/:propertyId/comps/:compId`

Deletes a comp by UUID from `protest_comp`. Works for any source.

**Response 200:** `{ "ok": true }`
**404:** Property or comp not found.

---

### `PATCH /api/protest/:propertyId/comps/:compId/exclude`

Sets or clears the excluded flag on a comp.

**Request body:**
```json
{ "excluded": true }
```

**Response 200:** `{ "ok": true }`
**404:** Property or comp not found.

---

### `GET /api/protest/:propertyId/cad-search`

Searches the registered CAD adapter (e.g. DCAD) for comparable properties by address. Used by the Add Comp modal before adding a real CAD record. Returns `hasAdapter: false` when the property's county has no registered adapter.

**Query params:** `address` (required), `year` (optional, defaults to current year).

**Response 200:**
```json
{
  "hasAdapter": true,
  "results": [
    {
      "cadPropertyId": "12345-abcde",
      "address": "789 Pine Rd",
      "city": "Flower Mound",
      "sqft": 2100,
      "beds": 4,
      "baths": 2.0,
      "yearBuilt": 2003,
      "assessedValue": 480000,
      "marketValue": 510000
    }
  ]
}
```

When `hasAdapter` is `false`, `results` is always `[]`. The `raw` field from the adapter is stripped before returning.

**404:** Property not found.

---

### `POST /api/protest/:propertyId/comps`

Adds a manually-entered comparable property to `protest_comp` with `source = 'manual'`. Appears in both strategy views. DCAD enrichment for this comp runs automatically as part of the next `runDcadBackfill` call.

**Request body:**
```json
{
  "year": 2026,
  "addressLine1": "789 Pine Rd",
  "city": "Flower Mound",
  "state": "TX",
  "zip": "75028",
  "sqft": 2100,
  "beds": 4,
  "baths": 2,
  "yearBuilt": 2003,
  "cadAssessedValueUsd": 480000,
  "cadMarketValueUsd": 510000,
  "soldPriceUsd": 520000,
  "soldDate": "2025-11-10",
  "notes": "Has pool — DCAD made no adjustment"
}
```

All fields except `year` are optional. `cadPerSqftAssessed` is computed from `cadAssessedValueUsd / sqft` and `pricePerSqft` from `soldPriceUsd / sqft` if both are provided.

**Response 201:**
```json
{
  "ok": true,
  "comp": { /* newly inserted UnifiedComp row */ }
}
```

---

### `POST /api/protest/:propertyId/refresh-comps`

Triggers an on-demand property valuation refresh followed by a full DCAD backfill pipeline. Both `refreshPropertyValuation` and `runDcadBackfill` complete before the response is returned.

**Request body:**
```json
{ "year": 2026 }
```

`year` is optional — defaults to the current UTC year.

**Behavior:**
1. Calls `refreshPropertyValuation` (Realty/Redfin API). The 24-hour cooldown applies — if fresh, `redfin.ok` is `false` with `code: "RATE_LIMITED"` (surface as a warning, not a failure). New Redfin comps are saved to `protest_comp` with `source = 'redfin'` as a side effect.
2. Runs `runDcadBackfill` (5 steps): enriches subject property with full DCAD value history, inserts/updates DCAD search comps, enriches improvement details for comps, merges Redfin/CAD-evidence comps with DCAD data, syncs appeal status.

**Response 200:**
```json
{
  "redfin": { "ok": true, "estimate": 480000 },
  "dcad": { "ok": true },
  "comps": [ /* full updated UnifiedComp list for the property/year */ ]
}
```

On rate-limit: `"redfin": { "ok": false, "code": "RATE_LIMITED", "message": "Valuation refreshed within the last 24 hours — try again later." }`. DCAD backfill still runs in this case.

---

### `POST /api/protest/:propertyId/cad-evidence?taxYear=YYYY`

Upload the official DCAD evidence packet PDF (multipart/form-data, field name `file`, max 20 MB). Parses the PDF and stores the result in `protest_worksheet.cad_evidence_json`. The parser extracts both the CAD Sales Analysis (§41.41) and Subject Equity Analysis (§41.43) comp tables, their medians, and subject property details from the public card page.

**Request:** `multipart/form-data` with field `file` (PDF only).

**Response 200:**
```json
{
  "filename": "cad-evidence-2026.pdf",
  "data": {
    "uploadedAt": "2026-06-02T10:00:00Z",
    "subjectCadPropertyId": "560912",
    "subjectAddress": "7070 COULTER LAKE RD",
    "assessedValueUsd": 1101813,
    "improvementsUsd": 817120,
    "landValueUsd": 284693,
    "percentGood": 92.0,
    "livingAreaSqft": 4008.8,
    "lotSqft": 9817,
    "yearBuilt": 2017,
    "salesAnalysis": {
      "comps": [
        { "compNum": 1, "propId": "680344", "address": "2362 CHAFFEE RD FRISCO TX 75036", "distanceMi": 0.4, "saleDate": "2025-05-20", "salePriceUsd": 1275000, "cadMarketValueUsd": 1136736, "cadIndValueUsd": 1228707 }
      ],
      "medianIndValueUsd": 1196015,
      "medianValuePerSqft": 298.35
    },
    "equityAnalysis": {
      "comps": [
        { "compNum": 1, "propId": "660008", "address": "7495 COULTER LAKE RD FRISCO TX 75036", "distanceMi": 0.24, "cadMarketValueUsd": 1014668, "cadIndValueUsd": 1075760 }
      ],
      "medianIndValueUsd": 1077571,
      "medianValuePerSqft": 268.80
    }
  }
}
```

**Response 422:** `{ "message": "Failed to parse PDF. Ensure this is a DCAD evidence packet." }`

---

### `DELETE /api/protest/:propertyId/cad-evidence?taxYear=YYYY`

Clears the stored CAD evidence data (`cad_evidence_json` reset to `{}`, `cad_evidence_filename` set to NULL).

**Response 204:** No content.

---

### `PATCH /api/protest/:propertyId/comps/:compId/notes`

Updates the `notes` field on a single comp row (any source).

**Request body:**
```json
{ "notes": "Has pool and outdoor kitchen — DCAD made no adjustment" }
```

**Response 200:** `{ "ok": true }`
**404:** Comp not found or does not belong to this property.

---

### `GET /api/protest/:propertyId/dcad/value-history`

Returns year-by-year CAD tax assessed value history for the subject property from TrueProdigy. Requires `dcad_p_account_id` to be stored on the property (set automatically after the first DCAD comps search).

**Response 200:**
```json
{
  "history": [
    { "year": 2026, "marketValue": 1101813, "assessedValue": 1101813, "landValue": 188000, "improvementValue": 913813 },
    { "year": 2025, "marketValue": 1025000, "assessedValue": 1025000, "landValue": 188000, "improvementValue": 837000 }
  ]
}
```

**404:** Property not found, or DCAD account ID not on file (trigger a DCAD comps search first via the protest chat).

---

### `GET /api/protest/:propertyId/dcad/taxable`

Returns the current taxable value breakdown after exemptions (homestead, over-65, etc.) for the subject property. Raw rows from TrueProdigy — shape varies by county/exemption type.

**Response 200:** `{ "taxable": [ { ... } ] }`

**404:** Property not found, or DCAD account ID not on file.

---

### `GET /api/protest/:propertyId/dcad/appeal`

Returns live protest/appeal status from DCAD for the subject property.

**Response 200:**
```json
{
  "appeals": [
    { "year": "2026", "status": "Pending", "hearingDate": null, "filedDate": "2026-05-01" }
  ]
}
```

**404:** Property not found, or DCAD account ID not on file.

---

### `GET /api/protest/:propertyId/appraisal-notice-link`

Returns the S3 key for the current year's appraisal notice PDF from DCAD. The result is cached on `property.cad_appraisal_notice_s3id` so repeated calls are cheap.

**Response 200:**
```json
{ "available": true, "s3Id": "denton/d335f122-39c5-11f1-9a34-0242ac110006.pdf", "fetchedAt": "2026-06-01T00:00:00Z" }
```

`available: false` means DCAD has not published a notice for this property yet. `s3Id` and `fetchedAt` are `null` when `available` is `false`.

**404:** Property not found, or DCAD account ID not on file.

---

### `GET /api/protest/:propertyId/appraisal-notice-pdf`

Streams the current year's DCAD appraisal notice PDF as `Content-Type: application/pdf`. Fetches the PDF bytes via the DCAD document endpoint using the cached `s3Id`. Open in a new browser tab — native PDF rendering, no iframe needed.

**Response 200:** PDF byte stream.

**Response 501:** `{ "message": "Appraisal notice PDF proxy not yet implemented." }` — returned until the DCAD PDF download URL is confirmed. Use `appraisal-notice-link` to retrieve the `s3Id` and open the DCAD portal directly in the meantime.

**404:** Property not found, or notice not available.

---

### `GET /api/protest/:propertyId/evidence-packet?year=YYYY&format=pdf|docx`

Generates an ARB evidence packet for the given property and tax year. Returns PDF (default) or Word DOCX.

**Auth:** Owner/admin. `year` defaults to current year if omitted.

**Query params:**
- `year` — optional integer, defaults to current year
- `format` — `pdf` (default) or `docx`

**Response 200 — PDF (`format=pdf` or omitted):**
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="<address>_ARB_<year>.pdf"`

**PDF sections:**
1. **Cover** — valuation summary boxes (CAD assessed, AVM, overassessment %, target value), property facts, strategy panel (case strength bar, primary approach, key arguments, red flags)
2. **DCAD Comparable Properties** — table with market value, $/sqft, vs-subject %; subject row highlighted; green/red colour coding
3. **Recent Comparable Sales** — Redfin sold comps table (if available)
4. **Market Value Comparison** — horizontal bar chart of AVM vs DCAD comp market values; green bars = comp below subject (supports protest)

**Response 200 — DOCX (`format=docx`):**
- `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition: attachment; filename="<address>_ARB_<year>.docx"`

**DOCX sections:**
1. **ARB Board Packet** — valuation summary table, property facts, DCAD comps table, recent sales table, key arguments (submit to the panel)
2. **Protestor Reference Sheet** — oral script (numbered talking points), negotiation table (blank), quick-reference card (keep for yourself)

**Errors:** `400` invalid params · `404` property not found · `401/403` auth

---

### `GET /api/protest/:propertyId/protest-brief?year=YYYY`

Generates a structured plain-text protest brief for use with any AI assistant (Claude, ChatGPT, Gemini, etc.). All numbers are sourced directly from the database — no LLM generation.

**Auth:** Bearer token required. `year` defaults to current year if omitted.

**Response 200:**
- `Content-Type: text/plain; charset=utf-8`
- `Content-Disposition: attachment; filename="<address>_protest_brief_<year>.txt"`

**Sections in the brief:**
1. Subject property — address, CAD ID/account, sqft, beds/baths, lot, AVM
2. DCAD assessed values — land/improvement split, appraised vs net appraised (homestead cap), YoY tax history
3. Equity analysis (§41.43) — DCAD comp table with $/sqft, median $/sqft, implied value at median, delta vs subject
4. Market value analysis (§41.41) — sold comps table with sold price, $/sqft, sold date, CAD assessed value
5. Notes — worksheet strategy notes and prior-year cycle summary
6. AI analysis prompt — LLM-agnostic instructions for an AI to generate protest arguments

**Errors:** `400` invalid params · `404` property not found

---

### `PATCH /api/protest/:propertyId/worksheet`

Updates worksheet status, outcome, informal offer amount, hearing date, filing deadline, and CAD portal URL.

**Request body:**
```json
{
  "year": 2026,
  "status": "resolved",
  "outcome": "settled_informal",
  "informalOfferUsd": 485000,
  "hearingDate": "2026-07-15",
  "filingDeadline": "2026-05-15",
  "cadPortalUrl": "https://www.dallascad.org/protest"
}
```

All fields except `year` are optional.
- `status` — one of `not_filed` | `filed` | `informal` | `arb` | `resolved`.
- `outcome` — one of `settled_informal` | `won_arb` | `lost_arb` | `withdrawn` or `null` to clear. Meaningful only when `status = "resolved"` (or when resetting).
- `informalOfferUsd` — integer USD value of the appraiser's informal offer; `null` to clear.
- `hearingDate` and `filingDeadline` — `YYYY-MM-DD` or `null` to clear.
- `cadPortalUrl` — valid URL or `null` to clear.

**Response 200:** `{ "worksheet": { ...updated worksheet including outcome, informalOfferUsd... } }`

---

#### `PATCH /household/settings`

**Auth:** Owner/admin only (members receive **403**).

Updates household-level settings only. Salary deposit and employers are managed via **`PATCH /household/profile`**.

**Request body (send at least one field):**
```json
{
  "monthlySavingsTargetUsd": 500,
  "largeTxnThresholdUsd": 5000
}
```

- **`monthlySavingsTargetUsd`** — set to `null` to clear.
- **`largeTxnThresholdUsd`** — set to `null` to disable. Must be positive when provided.

**Response 200:** Same shape as `GET /household/settings`.

**Errors:**
- **400** — invalid amount (`INVALID_AMOUNT`).
- **401** — missing or invalid token.
- **403** — insufficient role.
- **503** — migration not applied (`MIGRATION_REQUIRED`).

---

### Member Management

#### `GET /household/members`

Returns all household members with their person profiles and membership metadata.

**Response 200:**
```json
{
  "members": [
    {
      "id": "uuid",
      "fullName": "Alex Doe",
      "firstName": "Alex",
      "lastName": "Doe",
      "email": "alex@example.com",
      "role": "head",
      "relationship": "self"
    }
  ]
}
```

---

#### `POST /household/members`

Creates a new household member (`person_profile` + `household_membership`). Does **not** create a login account.

**Request body:**
```json
{
  "firstName": "string",
  "lastName": "string (optional)",
  "email": "string (optional)",
  "role": "head | member",
  "relationship": "self | spouse | child | dependent | other"
}
```

**Response 201:** `{ "member": { ... } }`

**Errors:**
- **400** — validation failure (`{ "errors": z.issues }`).
- **409** — email already in use (`EMAIL_CONFLICT`).

---

#### `PATCH /household/members/:memberId`

Updates a member's name, email, role, or relationship. At least one field required.

**Request body:** any subset of create fields.

**Response 200:** `{ "member": { ... } }`

**Errors:**
- **404** — member not found.
- **409** — email already in use.

---

#### `DELETE /household/members/:memberId`

**Auth:** Owner/admin only.

Removes a household member. Deletes both `household_membership` and `person_profile` rows.

**Constraint:** Cannot remove a member with a linked login account (`linked_user_id` set). Returns **409** with code `HAS_LOGIN_ACCOUNT`.

**Response 204** — deleted.

**Errors:**
- **404** — member not found.
- **409** — member has a login account.

---

#### `POST /household/members/:memberId/reset-password`

**Auth:** Bearer JWT. **Role:** owner or admin.

Generates a new random temporary password, sets `force_password_change = true`, and invalidates existing JWTs (bumps `token_version`). Returns the plaintext temporary password **once**.

**Response 200:**
```json
{ "tempPassword": "aB3x-Kp7z-M2wQ" }
```

**Errors:**
- **404** — member not found.
- **409** — `NO_LOGIN` — member does not have a login account.

---

#### `POST /household/members/:memberId/create-login`

Creates login credentials for an existing member profile.

**Response 201** — login created.

**Errors:**
- **400** — invalid `memberId` or member missing email (`EMAIL_REQUIRED`).
- **404** — member not found.
- **409** — `ALREADY_HAS_LOGIN` or `EMAIL_CONFLICT`.

---

#### `GET /household/members/:memberId/data-count`

Returns transaction and payslip counts for a member (used in delete confirmation).

**Response 200:**
```json
{ "transactions": number, "payslips": number }
```

**Errors:**
- **400** — invalid `memberId`.

---

### Household Profile

#### `GET /household/profile`

Returns the signed-in user's `person_profile`.

**Response 200:**
```json
{
  "profile": {
    "id": "uuid",
    "householdId": "uuid",
    "linkedUserId": "uuid",
    "firstName": "Jane",
    "lastName": "Doe",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phoneNumber": "+1 …",
    "avatarKey": "person",
    "role": "head",
    "relationship": "self",
    "age": 37,
    "dateOfBirth": "1988-04-12",
    "hasDob": true,
    "sex": "female",
    "individualGrossIncomeUsd": 145000,
    "riskTolerance": "moderate",
    "financialGoals": ["Build emergency fund", "Invest for retirement"]
  }
}
```

- **`dateOfBirth`** — decrypted DOB returned **only** for the authenticated user's own profile. Member-list responses always return `dateOfBirth: null`.
- **`age`** — computed from `dateOfBirth` when set, otherwise from the manual age column.
- **`hasDob`** — `true` when a DOB has been set (safe to return for any profile).

---

#### `PATCH /household/profile`

Updates the signed-in user's `person_profile`. Send at least one field.

**Request body (any subset):**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phoneNumber": "+1 …",
  "avatarKey": "person",
  "age": 37,
  "dateOfBirth": "1988-04-12",
  "sex": "female",
  "individualGrossIncomeUsd": 145000,
  "riskTolerance": "moderate",
  "financialGoals": ["Build emergency fund"],
  "salaryDepositFinancialAccountId": "uuid-or-null",
  "employers": [
    {
      "id": "uuid",
      "displayName": "Acme Corp",
      "parserProfileId": "ibm_pay_contributions_pdf",
      "parserMapping": {}
    }
  ]
}
```

- **`dateOfBirth`** — `YYYY-MM-DD` or `null`. Encrypted at rest (AES-256-GCM). Excluded from exports — re-enter after restore.
- **`salaryDepositFinancialAccountId`** — must be a `financial_account` in the same household, or `null`.

**Response 200:** `{ "profile": { … } }`

**Errors:**
- **400** — invalid payload (`{ "errors": z.issues }`).
- **401** — missing or invalid token.
- **404** — profile could not be resolved.
- **409** — email conflict (`EMAIL_CONFLICT`).

---

### Properties

#### `GET /household/properties`

Returns all `property` rows for the household with latest value snapshots.

**Response 200:**
```json
{
  "properties": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "addressLine1": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "country": "US",
      "propertyUse": "primary",
      "apiProvider": null,
      "apiPropertyId": null,
      "latestValueUsd": 450000,
      "latestValueAsOf": "2026-01-01",
      "createdAt": "2026-05-10T12:00:00.000Z",
      "updatedAt": "2026-05-10T12:00:00.000Z"
    }
  ]
}
```

---

#### `POST /household/properties`

**Auth:** Owner/admin only.

Creates a property and optionally links it to a mortgage account.

**Request body (all fields optional):**
```json
{
  "addressLine1": "123 Main St",
  "city": "Austin",
  "state": "TX",
  "zip": "78701",
  "propertyUse": "primary | rental | vacation",
  "accountId": "uuid (mortgage account)",
  "initialValueUsd": 450000,
  "initialValueAsOf": "2026-01-01"
}
```

**Response 201:** `{ "id": "uuid" }`

**Errors:**
- **400** — Zod validation (`{ errors: [...] }`).
- **404** — `accountId` not found (`ACCOUNT_NOT_FOUND`).

---

#### `GET /household/properties/:propertyId`

**Response 200:** `{ "property": { ... } }`

**Errors:**
- **404** — property not in household.

---

#### `PATCH /household/properties/:propertyId`

**Auth:** Owner/admin only.

Updates address, use, and user-editable metadata fields. Send at least one field. Omitted keys are left unchanged; `null` clears a nullable field.

**Request body (all fields optional; at least one required):**

| Field | Type | Notes |
|-------|------|--------|
| `addressLine1` | string \| null | max 200 |
| `city` | string \| null | max 100 |
| `state` | string \| null | max 100 |
| `zip` | string \| null | max 20 |
| `propertyUse` | `"primary"` \| `"rental"` \| `"vacation"` \| null | |
| `purchasePrice` | integer \| null | positive, nullable to clear |
| `purchaseDate` | string \| null | ISO `YYYY-MM-DD`, nullable to clear |
| `monthlyRent` | integer \| null | ≥ 0, nullable to clear |
| `propertyNotes` | string \| null | max 2000 chars, nullable to clear |

**Response 200:** `{ "updated": true }`

---

#### `DELETE /household/properties/:propertyId`

**Auth:** Owner/admin only.

Permanently removes a property and all its value snapshots. Clears `property_id` FK on any mortgage accounts.

**Response 200:**
```json
{ "unlinkedAccounts": 0 }
```

---

#### `GET /household/properties/:propertyId/values`

Lists all `property_value_snapshot` rows for the property (ascending by `asOfDate`).

**Response 200:**
```json
{
  "snapshots": [
    {
      "id": "uuid",
      "propertyId": "uuid",
      "asOfDate": "2026-01-01",
      "marketValueUsd": 450000,
      "source": "manual",
      "apiProvider": null,
      "createdAt": "2026-05-10T12:00:00.000Z"
    }
  ]
}
```

---

#### `GET /household/properties/:propertyId/equity-history`

Returns AVM, linked mortgage balance, and computed equity per snapshot date. The mortgage balance at each point is resolved from `account_balance_snapshot` for the linked loan account (using the closest balance on or before that date). If no mortgage is linked, `mortgageBalance` is `0` and `equity` equals `avm`.

**Response 200:**
```json
{
  "history": [
    {
      "date": "2025-10-01",
      "avm": 480000,
      "mortgageBalance": 320000,
      "equity": 160000
    }
  ]
}
```

---

#### `POST /household/properties/:propertyId/values`

**Auth:** Owner/admin only.

Creates or upserts (same calendar `asOfDate`) a market value snapshot.

**Request body:**
```json
{
  "marketValueUsd": 450000,
  "asOfDate": "2026-01-01",
  "source": "manual | api"
}
```

**Response 201:** `{ "id": "uuid" }`

---

### Account Enrichment

Account enrichment fields (`sub_type`, `memo`, `liquidity`, `linked_account_id`, `property_id`) live on `financial_account` and appear on **`GET /imports/accounts`** responses and balance-sheet DTOs.

| Field | Meaning |
|-------|---------|
| **`sub_type`** | Subtype key from the account type hierarchy (e.g. `mortgage_primary` under `loan`). |
| **`memo`** | Free-text note; surfaced to AI insights context. |
| **`liquidity`** | `liquid` \| `semi_liquid` \| `restricted` — auto-set by account type unless overridden. |
| **`linked_account_id`** | Self-referential UUID FK to another `financial_account` (future HELOC ↔ mortgage pairing). Read-only. |
| **`property_id`** | UUID FK to `property` on mortgage/loan accounts. Set via **`POST /household/properties`** with `accountId`. Read-only from account endpoints. |

**`POST/PATCH /imports/accounts`** accepts camelCase `subType`, `memo`, `liquidity` in request bodies.

---

## Transactions (Ledger)

Base path: `/transactions`

**Role / membership rules:**

| Role | Ledger write access |
|------|---------------------|
| `owner`, `admin` | Full access — create, update, delete any transaction. |
| `member` (with profile) | Write/modify/delete only where `owner_person_profile_id` matches. Manual entry restricted to owned accounts. Bulk ops skip non-owned rows; report `skippedNotOwned`. |
| `member` (no profile) | **403** on all write ops. |

---

### `GET /transactions`

**Query parameters (optional):**

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | default `50`, max `200` |
| `offset` | number | default `0` |
| `sessionId` | UUID | Filter to transactions sourced from this import session |
| `categoryId` | UUID | Filter to category + children (legacy single-value) |
| `categoryIds` | UUID (repeatable) | Multi-select filter; OR when multiple |
| `uncategorizedOnly` | boolean | `true` only for `category_id IS NULL` |
| `needsReview` | boolean | `true` for rows needing attention (uncategorized, non-posted, or open resolution items) |
| `resolutionType` | string (repeatable) | `unknown_category`, `duplicate_ambiguity`, `transfer_ambiguity`, `reconciliation_mismatch` (only with `needsReview=true`) |
| `search` | string | Substring + FTS5 match on `merchant || memo` |
| `amountMin` | number | Filter on signed amount (inclusive) |
| `amountMax` | number | Filter on signed amount (inclusive) |
| `dateFrom` | YYYY-MM-DD | Inclusive start date |
| `dateTo` | YYYY-MM-DD | Inclusive end date |
| `accountId` | UUID | Filter to single account (legacy) |
| `accountIds` | UUID (repeatable) | Multi-select account filter |
| `ownerScope` | `household` \| `person` | Scope for owner filtering |
| `ownerPersonProfileId` | UUID | Person scope filter (legacy single-value) |
| `ownerPersonProfileIds` | UUID (repeatable) | Multi-select person filter |
| `belongsTo` | UUID (repeatable) | Household or person profile UUIDs; takes precedence over `ownerScope` params |
| `transferPaired` | boolean | `true` only rows with non-null `transfer_group_id` |
| `returnTo` | string | Optional context return URL (frontend hint; ignored by backend) |
| `fromDashboard` | boolean | Frontend context hint (ignored by backend) |

**Response 200:**
```json
{
  "total": 42,
  "limit": 50,
  "offset": 0,
  "sessionId": "uuid-or-null",
  "transactions": [
    {
      "id": "uuid",
      "txnDate": "2026-03-01",
      "amount": -4.5,
      "direction": "debit",
      "merchant": "Coffee",
      "memo": null,
      "status": "posted",
      "accountId": "uuid",
      "institution": "Bank of America",
      "accountType": "checking",
      "accountMask": "1001",
      "categoryId": "uuid-or-null",
      "categoryName": "Groceries",
      "transferGroupId": "uuid-or-null",
      "classificationMeta": {
        "source": "household | builtin | none | manual",
        "ruleId": "uuid-or-null",
        "confidence": 0.85,
        "reason": "Matched contains household rule pattern \"…\"."
      },
      "sourceRef": "raw:…",
      "createdAt": "…",
      "reviewReasons": ["Uncategorized", "Open review: category"],
      "openReviewItems": [{ "id": "resolution-item-uuid", "type": "unknown_category", "status": "open" }],
      "importSessionId": "import-session-uuid-or-null"
    }
  ]
}
```

- **`classificationMeta`** — parsed from `transaction_canonical.classification_meta` JSON: `source`, `ruleId`, `confidence`, `reason`.
- **`reviewReasons`** — present only when `needsReview=true`.
- **`openReviewItems`** — present only when `needsReview=true`.
- **`importSessionId`** — present only when `needsReview=true`.

**Errors:**
- **400** — invalid query (e.g. `categoryId` and `uncategorizedOnly` both set).
- **404** — `sessionId` not found.

---

### `GET /transactions/aggregate`

Returns headline totals and capped breakdown arrays for the entire filtered set (no pagination).

**Query:** Same optional filters as **`GET /transactions`** except `limit` and `offset`.

**Response 200:**
```json
{
  "count": 124,
  "net": -4821.33,
  "inflows": 8200,
  "outflows": 13021.33,
  "avgAbsolute": 105.05,
  "dateFirst": "2025-01-03",
  "dateLast": "2025-12-31",
  "byCategory": [{ "label": "Groceries", "value": 420.5, "categoryId": "uuid" }],
  "byMerchant": [{ "label": "costco", "value": 310 }],
  "byAccount": [{ "label": "Bank of America checking •1001", "value": -120.5, "accountId": "uuid" }],
  "byMonth": [{ "label": "2025-01", "value": 900, "net": -40 }]
}
```

- Arrays capped at 50 rows (120 months max for `byMonth`).
- Merchant keys normalized (trim, lowercase, collapsed whitespace).

---

### `POST /transactions`

Insert one **posted** canonical row (manual entry). `source_ref` is `manual:<uuid>`; `classification_meta` records `{"source":"manual"}`. If **`categoryId`** is omitted or **`null`**, an **`unknown_category`** resolution item is created.

**Request body:**
```json
{
  "accountId": "uuid",
  "txnDate": "YYYY-MM-DD",
  "amount": -42.5,
  "merchant": "Optional; default Manual entry",
  "memo": null,
  "categoryId": "uuid-or-null-or-omit"
}
```

- **`amount`** — must be non-zero; sign matches import convention (negative outflow, positive inflow).

**Response 201:**
```json
{ "id": "uuid" }
```

**Errors:**
- **400** — invalid body; account not in household; category unavailable.
- **401** — missing or invalid token.
- **409** — `DUPLICATE_FINGERPRINT` — same fingerprint as existing row.

---

### `PATCH /transactions/:id`

Update one or more fields on a posted ledger row.

#### Category update

**Request body:**
```json
{ "categoryId": "uuid" }
```

or clear it:

```json
{ "categoryId": null }
```

- `categoryId` must be visible to the household.

**Response 200:**
```json
{
  "id": "uuid",
  "categoryId": "uuid",
  "categoryName": "Groceries"
}
```

When `categoryId` is set, any **`unknown_category`** resolution item for this transaction is marked **`resolved`**.

#### Amount update (manual transactions only)

**Request body:**
```json
{ "amount": 150.00 }
```

- Only allowed on manual transactions (`source_ref` starts with `manual:`). Returns **400** `NOT_MANUAL` for imported rows.
- For `type='cash'` accounts, `account_balance_snapshot` is automatically updated (delta = `newAmount − oldAmount`).

**Response 200:**
```json
{ "amount": 150.00 }
```

#### Status / memo / owner update

Send `status` (`"trashed"` / `"posted"`), `memo`, `ownerScope`, or `ownerPersonProfileId`.

**Errors:**
- **400** — invalid body, category unavailable, amount is zero/non-finite, or editing amount of imported transaction.
- **404** — transaction not found.
- **401** — missing or invalid token.

---

### `GET /transactions/:id/open-review`

Returns open and in_review **`resolution_item`** rows linked to this canonical transaction, with context (file name, session id, raw preview, classification explainability).

**Response 200:**
```json
{
  "items": [
    {
      "id": "resolution-item-uuid",
      "type": "unknown_category",
      "targetId": "canonical-txn-uuid",
      "reason": "{…}",
      "reasonDetail": { "kind": "unknown_category", "message": "…" },
      "status": "open",
      "createdAt": "…",
      "context": {
        "sessionId": "…",
        "fileId": "…",
        "fileName": "stmt.csv",
        "raw": { "txnDate": "2026-02-01", "amount": -12.34, "description": "…", "referenceId": null },
        "classification": { "source": "db", "ruleId": null, "confidence": 0.9, "reason": "…" }
      }
    }
  ]
}
```

---

### `POST /transactions/pair`

Manually confirm two transactions as a transfer pair. Assigns a shared `transfer_group_id` to both rows.

**Request body:**
```json
{ "ids": ["uuid-A", "uuid-B"] }
```

- Exactly two IDs.
- Both must exist, be `posted`, in the same household.
- Must be on **different** accounts.
- Must have **opposite directions** (one debit, one credit).
- Absolute amounts must match within 0.01.
- Neither may already have a `transfer_group_id`.

**Response 200:**
```json
{ "transferGroupId": "uuid" }
```

**Errors:**
- **400** — `SAME_ID` | `SAME_ACCOUNT` | `ALREADY_PAIRED` | `AMOUNT_MISMATCH` | `DIRECTION_MISMATCH`.
- **404** — one or both IDs not found.

---

### `DELETE /transactions/pair/:groupId`

Dissolves a transfer pair by nulling `transfer_group_id` on all rows sharing `groupId`.

**Response 200:**
```json
{ "unlinked": 2 }
```

---

### `POST /transactions/bulk-category`

Set category on up to **200** transactions at once.

**Request body:**
```json
{ "ids": ["uuid", …], "categoryId": "uuid" }
```

**Response 200:**
```json
{ "updated": 5, "skipped": 0, "skippedNotOwned": 0 }
```

---

### `POST /transactions/bulk-trash`

Soft-delete (trash) up to **500** transactions. Only `posted` rows are moved to `trashed`.

**Request body:**
```json
{ "ids": ["uuid", …] }
```

**Response 200:**
```json
{ "trashed": 5, "skipped": 0, "skippedNotOwned": 0 }
```

---

### `POST /transactions/bulk-restore`

Restore up to **500** trashed transactions back to `posted`.

**Request body:**
```json
{ "ids": ["uuid", …] }
```

**Response 200:**
```json
{ "restored": 5, "skipped": 0, "skippedNotOwned": 0 }
```

---

### `POST /transactions/bulk-delete`

Hard-delete up to **500** transactions. Rows must be in `trashed` status first.

**Request body:**
```json
{ "ids": ["uuid", …] }
```

**Response 200:**
```json
{ "deleted": 5, "skipped": 0, "skippedNotOwned": 0 }
```

**Member restriction (all four bulk ops):** Members without a profile receive **403**. Members with a profile only affect owned rows; non-owned IDs are skipped and counted in `skippedNotOwned`.

---

### `POST /transactions/bulk-reassign-owner`

**Auth:** Owner or admin only.

Reassign all transactions from one person profile to another.

**Request body:**
```json
{ "fromPersonProfileId": "uuid", "toPersonProfileId": "uuid" }
```

- `from` and `to` must be different.

**Response 200:**
```json
{ "updated": 42 }
```

---

## Categories & Rules

Base path: `/categories` and `/categories/rules`

Global defaults use a **two-level** tree: top-level parents (e.g. Shopping) and leaves (parent_id set). Households may add top-level categories or subcategories under any usable parent. Nesting deeper than parent → leaf is rejected.

---

### `GET /categories`

**Response 200:**
```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "Groceries",
      "parentId": "uuid-or-null",
      "isDefault": true,
      "householdScoped": false
    }
  ]
}
```

- **`householdScoped`** — `true` for household-created rows; owners/admins may edit built-ins; members cannot.

---

### `POST /categories`

Create a household-owned category.

**Request body:**
```json
{ "name": "My subcategory", "parentId": "uuid-or-null" }
```

- **`parentId`** — omit or `null` for top-level; otherwise must reference a top-level parent.

**Response 201:** `{ "category": { ... } }`

**Errors:**
- **400** — `INVALID_NAME`, `INVALID_PARENT`, `MAX_DEPTH`.

---

### `PATCH /categories/:id`

Rename or reparent a category.

**Request body:**
```json
{ "name": "…", "parentId": "uuid-or-null" }
```

- Household-owned rows: any authenticated member may update.
- Built-in rows: owner/admin only. Changes apply to **this database**.

**Response 200:** `{ "category": { … } }`

**Errors:**
- **400** — invalid parent/depth/cycle.
- **403** — not allowed (member editing built-in, or category not visible).
- **404** — unknown id.

---

### `DELETE /categories/:id`

Delete a household-owned category with no children and no references in `transaction_canonical`.

**Response 204** — success.

**Errors:**
- **403** — built-in (`BUILTIN_READONLY`).
- **404** — unknown id.
- **409** — `HAS_CHILDREN` or `IN_USE`.

---

### Category Rules

#### `GET /categories/rules`

Returns **`builtinRules`** (global rows with `origin: "builtin"`) and **`rules`** (household rows).

**Response 200:**
```json
{
  "builtinRules": [
    {
      "origin": "builtin",
      "id": "uuid",
      "ruleKey": "groceries_7_walmart",
      "pattern": "walmart",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "debit_only",
      "confidence": 0.7,
      "priority": 240,
      "enabled": true,
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ],
  "rules": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "pattern": "whole foods",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "any",
      "confidence": 0.9,
      "priority": 10,
      "enabled": true,
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ]
}
```

---

#### `POST /categories/rules`

Create a rule.

**Request body:**
```json
{
  "pattern": "starbucks",
  "matchType": "contains",
  "categoryId": "uuid",
  "amountScope": "any",
  "confidence": 0.85,
  "priority": 100,
  "enabled": true
}
```

- **`matchType`** — `contains` | `prefix` | `regex`.
- **`amountScope`** — optional; `any` | `credit_only` | `debit_only` (defaults to `any`).
- **`pattern`** — stored lowercase with normalized spaces. Matched against fingerprint-normalized descriptions.

**Response 201:** `{ "rule": { ... } }`

**Errors:**
- **400** — `INVALID_PATTERN`, `INVALID_CATEGORY`, `INVALID_CONFIDENCE`, `INVALID_PRIORITY`, `INVALID_AMOUNT_SCOPE`.

---

#### `POST /categories/rules/bulk`

Create many household rules in one request. Best-effort; each row is validated independently.

**Request body:**
```json
{
  "rules": [
    {
      "pattern": "costco",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "debit_only",
      "confidence": 0.85,
      "priority": 100,
      "enabled": true
    },
    {
      "pattern": "whole foods",
      "matchType": "contains",
      "categoryPath": "Shopping > Groceries"
    }
  ]
}
```

- Each element needs **`pattern`**, **`matchType`**, and either **`categoryId`** or **`categoryPath`**.
- **`categoryPath`** — e.g. `Home > HOA Fees` (case-insensitive; segments separated by `>` or `|`).
- Omitted **`confidence`** / **`priority`** / **`enabled`** use defaults (0.85, 100, true).

**Response 200:**
```json
{
  "created": [ { "...": "same shape as GET rules[]" } ],
  "errors": [ { "index": 1, "message": "…", "code": "INVALID_PATTERN" } ]
}
```

---

#### `PATCH /categories/rules/:id`

Update rule fields (including enable/disable).

**Request body:** any subset of create fields.

**Response 200:** `{ "rule": { ... } }`

---

#### `DELETE /categories/rules/:id`

Delete a household rule permanently.

**Response 204** — success.

---

#### `DELETE /categories/rules/household`

Delete **all** household rules for the household. Built-in rules unchanged.

**Response 200:**
```json
{ "deleted": 42 }
```

---

#### `POST /categories/rules/from-ledger`

**Auth:** Owner/admin.

Create a household classification rule derived from an existing posted transaction. The backend reads the transaction's normalized description and constructs a pattern automatically.

**Request body:**
```json
{
  "transactionId": "uuid",
  "categoryId": "uuid",
  "matchType": "contains | prefix",
  "scope": "contains | prefix",
  "amountScope": "any",
  "confidence": 0.9,
  "priority": 100,
  "enabled": true
}
```

- `transactionId` — must be a posted canonical transaction.

**Response 201:** `{ "rule": { ... } }`

---

#### `POST /categories/rules/builtin`

**Auth:** Owner/admin.

Create a global built-in rule.

**Request body:**
```json
{
  "ruleKey": "optional",
  "pattern": "starbucks",
  "matchType": "contains",
  "categoryId": "uuid",
  "amountScope": "any",
  "confidence": 0.85,
  "priority": 100,
  "enabled": true
}
```

**Response 201:** `{ "rule": { ... } }`

---

#### `PATCH /categories/rules/builtin/:id`

**Auth:** Owner/admin.

Update a global rule.

---

#### `DELETE /categories/rules/builtin/:id`

**Auth:** Owner/admin.

**Response 204** — success.

---

## Import Sessions

Base path: `/imports`

Session rows are scoped by `household_id` from the JWT.

**Role / membership rules:**

| Role | Import session access |
|------|----------------------|
| `owner`, `admin` | Full access — create, read, manage any session. |
| `member` (with profile) | Create sessions; read and manage **only sessions they created**. File binding restricted to owned accounts. |
| `member` (no profile) | **403** on all write ops. |

---

### Session lifecycle

Valid state transitions:

| Current | May transition to |
|---------|------------------|
| `created` | `processing`, `failed` |
| `processing` | `review`, `failed` |
| `review` | `finalized`, `failed` |
| `finalized` | _(terminal)_ |
| `failed` | _(terminal)_ |

File uploads allowed when status is `created` or `processing`.

---

### `POST /imports/sessions`

Creates a new import session.

**Request body (JSON):**
```json
{ "sourceType": "upload" }
```

- `sourceType` — `"upload"` | `"watch_folder"` (default: `"upload"`).

**Response 201:**
```json
{ "session": { "id", "householdId", "sourceType", "status" } }
```

---

### `POST /imports/sessions/:sessionId/files`

Multipart form field: `files` (one or more files).

**Response 201:**
```json
{
  "files": [ { "id", "fileName", "checksum", "status": "queued" } ],
  "skipped": [ ... ]
}
```

- `files` — newly persisted rows.
- `skipped` — SHA-256 duplicates in this session (`code: "DUPLICATE_CHECKSUM_IN_SESSION"`).

**Errors:**
- **400** — No files.
- **404** — Session not found.
- **409** — `SESSION_CLOSED_FOR_UPLOAD`.

---

### `PATCH /imports/sessions/:sessionId/status`

**Request body (JSON):**
```json
{ "status": "processing" }
```

**Response 200:** `{ "sessionId", "status" }`

**Errors:**
- **404** — Not found.
- **409** — `INVALID_TRANSITION`.

---

### `GET /imports/sessions/:sessionId`

**Response 200:**
```json
{
  "session": { ... },
  "files": [
    {
      "id": "uuid",
      "file_name": "statement.csv",
      "checksum": "sha256",
      "status": "queued",
      "file_size": 1024,
      "mime_type": "text/csv",
      "uploaded_at": "…",
      "financial_account_id": "uuid",
      "parser_profile_id": "boa_checking_csv"
    }
  ]
}
```

---

### `GET /imports/sessions/:sessionId/summary`

Session processing summary: per-file counts, open review items, and derived "skipped" bucket.

**Response 200:**
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

- **`rawRowCount`** — rows in `transaction_raw`.
- **`canonicalRowCount`** — canonical rows of any status linked from raw rows.
- **`nearDuplicatesFlagged`** — count of `resolution_item` with `type: duplicate_ambiguity` for raw rows.
- **`openItemsNeedingReview`** — open or in-review items for this file.

---

### `GET /imports/accounts`

Lists financial accounts for binding uploads before parse.

**RBAC:** Members see only `household`-scoped accounts plus their own `person`-scoped accounts. Owner/admin see all household accounts.

**Query (optional):**

| Param | Description |
|-------|-------------|
| `includeClosedAccounts` | default `false`; when `true`, includes `status=closed` accounts |

**Response 200:** `{ "accounts": [ { ... } ] }`

Each account row includes:
- `id`, `type`, `institution`, `account_mask`, `currency`, `owner_scope`, `owner_person_profile_id`, `default_parser_profile_id`, `status`, `closed_at`, `last_uploaded_at`, `last_statement_end_date`

---

### `PATCH /imports/accounts/:accountId`

Updates a connected account.

**Writable fields:** `type`, `subType`, `memo`, `liquidity`, `institution`, `accountMask`, `ownerScope`, `ownerPersonProfileId`, `defaultParserProfileId`, **`status`** (`active` | `closed`).

- **`status: "closed"`** — hides from default list; sets `closed_at`.
- **`status: "active"`** — reopens and clears `closed_at`.

**Response 200:** `{ "updated": true }`

---

### `GET /imports/parser-profiles`

Lists supported parser profile IDs.

**Response 200:**
```json
{ "profiles": [ { "id", "label" } ] }
```

Known IDs: `generic_tabular`, `chase_card_csv`, `citi_card_csv`, `boa_checking_csv`, `boa_savings_csv`, `boa_credit_card_csv`, `boa_estatement_pdf`, `marcus_online_savings_pdf`, `ibm_pay_contributions_pdf`, `deloitte_payslip_pdf`.

---

### `PATCH /imports/sessions/:sessionId/files/:fileId`

Binds an uploaded file to a **financial account** and **parser profile** before parse.

**Request body (JSON):**
```json
{
  "financialAccountId": "uuid",
  "parserProfileId": "chase_card_csv"
}
```

Both fields required. Account must belong to the household.

**Response 200:** `{ "file": { ... } }`

---

### `POST /imports/sessions/:sessionId/parse`

Parses supported files in a session into `transaction_raw` records.

**Prerequisite:** each file must have `financial_account_id` and `parser_profile_id` set.

Supported adapters:
- CSV (`.csv`)
- Excel (`.xlsx`, `.xls`)
- PDF (`.pdf`) — profile-specific behavior:
  - `boa_estatement_pdf`, `marcus_online_savings_pdf` — local parse.
  - `ibm_pay_contributions_pdf`, `deloitte_payslip_pdf` — async LLM extraction (queued on `import_file`; provider per `LLM_PROVIDER`).

**Employer payslip (`ibm_pay_contributions_pdf`, `deloitte_payslip_pdf`):** queues for async LLM extraction. Returns `200` with `asyncPayslipPending`. Poll **`POST .../reconcile-payslip-async`**. On completion, creates a `payslip_snapshot` row; **no** `transaction_raw` rows.

**Profile `generic_tabular`:** user supplies column mapping.

**Request body (for `generic_tabular`):**
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

**Named profiles** (`chase_card_csv`, etc.): mapping not used; send `{}` or omit.

**Response 200:**
```json
{ "parsedFiles": 1, "parsedRows": 42, "skippedFiles": 0, "asyncPayslipPending": false }
```

**Errors:**
- **400** — invalid payload (`INVALID_MAPPING` for generic_tabular).
- **404** — session not found.
- **409** — no supported files.

---

### `POST /imports/sessions/:sessionId/reconcile-payslip-async`

Runs background LLM payslip extraction for IBM and Deloitte files (provider per `LLM_PROVIDER`) and inserts `payslip_snapshot` rows.

**Query (optional):**
- `force=true|1` — bypass per-file throttle window.

**Response 200:**
```json
{ "polledFiles": 1, "completedFiles": 1, "stillPending": 0, "errors": [ { "fileId", "message" } ] }
```

---

### `POST /imports/sessions/:sessionId/canonicalize`

Maps all `transaction_raw` rows for this session into `transaction_canonical`.

**Prerequisite:** run **`POST .../parse`** first.

**Request body:** none (`{}` is fine).

**Response 200:**
```json
{
  "inserted": 42,
  "duplicates": 2,
  "skipped": 1,
  "nearDuplicates": 1
}
```

- **inserted** — new canonical rows (`status: posted`).
- **duplicates** — fingerprint already exists (re-import/re-run canonicalize).
- **skipped** — malformed JSON or missing required fields.
- **nearDuplicates** — same account/date/amount, similar description; recorded in `resolution_item` for review.

After success, staged files for this session are removed from disk and `import_file.stored_path` is cleared.

**Errors:**
- **404** — session not found.
- **409** — no raw rows and not a completed payslip-only import (`NO_RAW_ROWS`).

---

### `POST /imports/sessions/:sessionId/undo-import`

Removes ledger impact of this import by deleting `transaction_canonical` rows whose `source_ref` points at `transaction_raw` rows in this session. Also deletes related `resolution_item` rows and clears `transfer_group_id` on paired rows. `transaction_raw` rows are **not** deleted — you can run **`POST .../canonicalize`** again.

Allowed for sessions in any status.

**Request body:** none (`{}` is fine).

**Response 200:**
```json
{
  "deletedCanonicalRows": 42,
  "deletedResolutionItems": 5
}
```

---

## Reports

### Cash Summary

Base path: `/reports/cash-summary`

Aggregates **posted** `transaction_canonical` rows for the household.

#### `GET /reports/cash-summary`

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `preset` | Yes* | `month` \| `ytd` \| `rolling_30` \| `rolling_90` (* unless `dateFrom` + `dateTo` set) |
| `month` | with `preset=month` | `YYYY-MM` |
| `asOf` | No | `YYYY-MM-DD` (defaults to today UTC) |
| `dateFrom` | with `dateTo` | `YYYY-MM-DD` — custom range start (inclusive) |
| `dateTo` | with `dateFrom` | `YYYY-MM-DD` — custom range end (inclusive) |
| `breakdown` | No | `true` \| `false` (default `false`) — include `byAccount` table |
| `categoryBreakdown` | No | `true` \| `false` (default `false`) — include `byCategory` and `monthlyOutflowsByCategory` |
| `categoryRollup` | No | `leaf` \| `parent` (default `parent`) — aggregate by leaf or parent group |
| `accountId` | No | UUID — restrict to one account |

**Date ranges:**

- **month** — full calendar month.
- **ytd** — `year(asOf)-01-01` through `asOf`.
- **rolling_30** — `asOf` minus 29 days through `asOf` (30 days inclusive).
- **rolling_90** — 90 days inclusive ending `asOf`.
- **custom** — `dateFrom` and `dateTo` define the range (max span: **1096** ≈ 3 years).

**Response 200:**
```json
{
  "range": {
    "start": "2025-03-01",
    "end": "2025-03-31",
    "preset": "month",
    "label": "March 2025"
  },
  "asOf": "2025-03-24",
  "household": {
    "inflows": 5000,
    "outflows": 3200.5,
    "net": 1799.5,
    "transactionCount": 42
  },
  "comparison": {
    "previousPeriod": {
      "label": "Previous month",
      "range": { "start": "2025-02-01", "end": "2025-02-28" },
      "household": { "inflows": 4800, "outflows": 3000, "net": 1800, "transactionCount": 40 },
      "delta": { "inflows": 200, "outflows": 200.5, "net": -0.5 }
    },
    "yearOverYear": { ... }
  },
  "spendingPower": {
    "monthlySavingsTargetUsd": 500,
    "savingsTargetApplied": 511.23,
    "safeToSpend": 1288.27,
    "savingsRate": 0.3599,
    "explanation": "Safe-to-spend = net cashflow minus your monthly savings commitment…"
  },
  "byAccount": [
    {
      "accountId": "uuid",
      "institution": "Bank of America",
      "accountType": "checking",
      "accountMask": "1001",
      "inflows": 5000,
      "outflows": 3200.5,
      "net": 1799.5,
      "transactionCount": 42
    }
  ],
  "byCategory": [
    {
      "categoryId": "uuid-or-null",
      "categoryName": "Groceries",
      "inflows": 0,
      "outflows": 400,
      "net": -400,
      "previousInflows": 0,
      "previousOutflows": 0,
      "previousNet": 0,
      "deltaInflows": 0,
      "deltaOutflows": 400,
      "deltaNet": -400,
      "transactionCount": 5
    }
  ],
  "monthlyTrend": [
    { "month": "2024-10", "inflows": 0, "outflows": 0, "net": 0 },
    { "month": "2025-03", "inflows": 5000, "outflows": 1000, "net": 4000 }
  ],
  "monthlyOutflowsByCategory": [
    {
      "month": "2025-03",
      "segments": [
        { "categoryId": "uuid-or-null", "categoryName": "Groceries", "outflows": 400 }
      ]
    }
  ]
}
```

- **`byAccount`** is `null` when `breakdown` is not `true`.
- **`byCategory`** / **`monthlyOutflowsByCategory`** are `null` when `categoryBreakdown` is not `true`.
- **`comparison.yearOverYear`** present for `month` preset only; `previousPeriod` always present.
- **`spendingPower`** always present.

**Comparison blocks:**

- `month` preset: **Previous month** + **Same month last year**.
- `ytd` preset: **YTD last year**.
- `rolling_30` / `rolling_90` / `custom`: immediately preceding same-length window.

**Errors:**
- **400** — invalid query (`preset=month` without `month`, only one of `dateFrom`/`dateTo`, etc.).
- **404** — `accountId` not found (`code: ACCOUNT_NOT_FOUND`).

---

### Balance Sheet

Base path: `/reports/balance-sheet`

#### `GET /reports/balance-sheet`

**Query (optional):**

| Param | Description |
|-------|-------------|
| `asOf` | `YYYY-MM-DD` (defaults to today UTC) |
| `ownerScope` | `household` \| `person` — when `person`, `ownerPersonProfileId` required |
| `ownerPersonProfileId` | UUID — with `ownerScope=person` |

**Response 200:**
```json
{
  "asOf": "2026-05-25",
  "assets": [
    {
      "financialAccountId": "uuid",
      "institution": "Bank of America",
      "accountMask": "1001",
      "type": "checking",
      "currency": "USD",
      "liquidity": "liquid",
      "side": "asset",
      "balance": 5000,
      "balanceAsOf": "2026-05-25",
      "balanceSource": "import",
      "importFileId": "uuid"
    }
  ],
  "liabilities": [
    {
      "financialAccountId": "uuid",
      "institution": "Chase",
      "accountMask": "4242",
      "type": "credit_card",
      "currency": "USD",
      "liquidity": null,
      "side": "liability",
      "balance": 1500,
      "balanceAsOf": "2026-05-25",
      "balanceSource": "manual",
      "importFileId": null
    }
  ],
  "properties": [
    {
      "propertyId": "uuid",
      "addressLine1": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "propertyUse": "primary",
      "marketValue": 450000,
      "marketValueAsOf": "2026-01-01",
      "linkedMortgageAccountId": "uuid",
      "linkedMortgageBalance": 350000,
      "linkedMortgageAsOf": "2026-05-25"
    }
  ],
  "totals": {
    "assets": 455000,
    "liabilities": 351500,
    "netWorth": 103500
  },
  "memberSummary": [
    {
      "personProfileId": "uuid",
      "name": "Jane Doe",
      "totalAssets": 250000,
      "totalLiabilities": 150000,
      "netWorth": 100000
    }
  ]
}
```

**Balance resolution (per account):**

1. Compare latest **manual** vs. latest **import** `account_balance_snapshot` (as_of_date ≤ asOf).
2. Pick the one with the later date; if equal, pick manual.
3. If only one source exists, use it.
4. If neither exists, fall back to the latest **parsed** import file's ending balance (legacy path).

---

#### `GET /reports/balance-sheet/history`

**Query (required/optional):**

| Param | Required | Description |
|-------|----------|-------------|
| `from` | Yes | Start date `YYYY-MM-DD` (inclusive) |
| `to` | Yes | End date `YYYY-MM-DD` (inclusive) |
| `interval` | No | `month` (default), `quarter`, `week`, `day` |
| `ownerScope` | No | Same semantics as `GET /reports/balance-sheet` |
| `ownerPersonProfileId` | with `ownerScope=person` | UUID of `person_profile` |
| `accountIds` | No | Comma-separated list of UUIDs (max **8**) — per-account overlays in response |

**Behavior:** Builds a list of sample dates (month-ends, quarter-ends, weekly, or daily). For each date, applies the same per-account resolution as **`GET /reports/balance-sheet`**. Max **120** sample points; otherwise **400** with code **`BALANCE_HISTORY_TOO_MANY_POINTS`**.

**Response 200:**
```json
{
  "from": "2026-01-01",
  "to": "2026-05-25",
  "interval": "month",
  "points": [
    {
      "asOf": "2026-01-31",
      "totals": { "assets": 100000, "liabilities": 50000, "netWorth": 50000 },
      "accounts": [
        {
          "financialAccountId": "uuid",
          "side": "asset",
          "balance": 50000,
          "balanceAsOf": "2026-01-31"
        }
      ]
    }
  ]
}
```

- **`accounts`** — present only when `accountIds` requested; one entry per requested account.

---

#### `POST /reports/balance-sheet/manual`

Creates or updates a manual balance snapshot for `(account, as_of_date)`.

**Request body (JSON):**

| Field | Type | Required |
|-------|------|----------|
| `financialAccountId` | UUID | Yes |
| `asOfDate` | `YYYY-MM-DD` | Yes |
| `amount` | number | Yes |
| `currency` | string | No (default `USD`) |

**Response 201** (same shape as `GET`).

**Errors:**
- **404** — `ACCOUNT_NOT_FOUND`.
- **400** — `INVALID_ACCOUNT` (payslip bucket).

---

#### `PATCH /reports/balance-sheet/manual/:id`

Updates an existing manual snapshot.

**Request body:** any of `amount`, `currency` (at least one required).

**Response 200** (updated row).

---

### Budget

Base path: `/budget`

Monthly per-category budgets: set targets, track actual spend, get suggestions.

---

#### `GET /budget/suggest?month=YYYY-MM`

Returns pre-populated budget suggestions derived from recent categorized debit spend.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `month` | Yes | `YYYY-MM` |

**Suggestion logic:**

- Finds the most recent calendar month within past 24 months with categorized debit activity (the "anchor").
- For each category in anchor month: `suggestedAmount = anchor month actual` (`basis: "last_month"`).
- For categories with prior activity but not in anchor: `suggestedAmount = 6-month average` (`basis: "three_month_avg"`).
- **Excluded:** Transfers, Income, Investments parent categories.
- Results sorted by anchor-month actual descending.

**Response 200:**
```json
{
  "month": "2026-04",
  "dataAsOf": "2026-01",
  "suggestions": [
    {
      "categoryId": "uuid",
      "categoryName": "Dining out",
      "parentId": "uuid",
      "parentName": "Food",
      "suggestedAmount": 320.50,
      "basis": "last_month",
      "lastMonthActual": 320.50,
      "threeMonthAvg": 298.00
    }
  ]
}
```

- **`dataAsOf`** — YYYY-MM anchor used. `null` when no categorized debit data in 24-month window.

---

#### `GET /budget/months`

Lists all months with budget entries, newest first.

**Response 200:**
```json
{
  "months": [
    { "month": "2026-04", "totalBudgeted": 3200.00 },
    { "month": "2026-03", "totalBudgeted": 3100.00 }
  ]
}
```

---

#### `GET /budget/:month`

Returns budget for the month combined with actual spend to date.

**Path param:** `month` — `YYYY-MM`.

**Response 200:**
```json
{
  "month": "2026-04",
  "exists": true,
  "summary": {
    "totalBudgeted": 3200.00,
    "totalSpent": 1850.25,
    "remaining": 1349.75,
    "unbudgetedSpend": 45.00
  },
  "categories": [
    {
      "categoryId": "uuid",
      "categoryName": "Dining out",
      "parentName": "Food",
      "budgeted": 320.00,
      "spent": 210.50,
      "remaining": 109.50,
      "percentUsed": 65.8
    }
  ]
}
```

- **`exists`** — `false` when no budget entries saved for month.
- **`summary.unbudgetedSpend`** — debit outflows not covered by budget entries.
- **`categories`** — one row per budget entry (leaf or parent level).
- **`percentUsed`** — `0` when `budgeted = 0`.

---

#### `PUT /budget/:month`

Replaces the entire budget for the month. Deletes all existing entries and inserts the provided set in one transaction. Passing empty `entries` clears the budget.

**Path param:** `month` — `YYYY-MM`.

**Request body:**
```json
{
  "entries": [
    { "categoryId": "uuid", "amount": 320.00 },
    { "categoryId": "uuid", "amount": 150.00 }
  ]
}
```

- `categoryId` — must be valid UUID (global or household category).
- `amount` — non-negative number.
- Empty `entries` valid (clears budget).

**Response 200:** Same shape as `GET /budget/:month` — returns saved budget with actuals.

**Errors:**
- **400** — invalid month or body.

---

## Recurring Payments

Base path: `/recurring-overrides`

Recurring merchant overrides for confirmed/dismissed recurring subscriptions.

---

### `GET /recurring-overrides`

List all recurring merchant overrides for the household.

**Response 200:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "merchantKey": "netflix",
      "displayName": "Netflix",
      "verdict": "confirmed",
      "amountAnchor": 18.99,
      "amountTolerancePct": 15,
      "taggedByUserId": "uuid",
      "createdAt": "2026-04-28T00:00:00.000Z",
      "updatedAt": "2026-04-28T00:00:00.000Z"
    }
  ]
}
```

---

### `POST /recurring-overrides`

Create or update override keyed by `(household_id, merchant_key)`.

**Request body:**
```json
{
  "merchantKey": "netflix",
  "displayName": "Netflix (optional)",
  "verdict": "confirmed | dismissed",
  "amountAnchor": 18.99,
  "amountTolerancePct": 15
}
```

**Response 200:**
```json
{
  "ok": true,
  "data": { ... }
}
```

**Errors:**
- **400** — invalid body (`{ errors: z.issues }`).
- **401** — unauthorized.

---

### `DELETE /recurring-overrides/:id`

Delete one override by id.

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- **401** — unauthorized.
- **404** — not found.

---

## Resolution Queue

Base path: `/resolution`

Manages `resolution_item` rows for categorization, transfer, and duplicate issues.

---

### `GET /resolution/summary`

Lightweight counts for dashboards.

**Response 200:**
```json
{
  "openByType": { "unknown_category": 2, "duplicate_ambiguity": 1 },
  "totalOpen": 3,
  "openDuplicateAmbiguityNotOnLedger": 1
}
```

- **`openDuplicateAmbiguityNotOnLedger`** — open **`duplicate_ambiguity`** items whose target is a **near-duplicate** raw row (no canonical row inserted).

---

### `GET /resolution`

Lists all `resolution_item` rows for the household (newest first).

**Query (optional):**
- `status=all|open|in_review|resolved` (default: `all`)

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "type": "duplicate_ambiguity | unknown_category | transfer_ambiguity | reconciliation_mismatch",
      "targetId": "uuid",
      "reason": "raw JSON string",
      "reasonDetail": { },
      "status": "open",
      "createdAt": "ISO-like timestamp",
      "context": {
        "sessionId": "uuid-or-null",
        "fileId": "uuid-or-null",
        "fileName": "statement.csv",
        "raw": {
          "txnDate": "2026-04-01",
          "amount": -5,
          "description": "STARBUCKS COFFEE STORE",
          "referenceId": "optional-ref"
        },
        "classification": {
          "source": "db | default | none",
          "ruleId": "rule-id-or-null",
          "confidence": 0.85,
          "reason": "why category was assigned or unknown"
        }
      }
    }
  ],
  "status": "open"
}
```

- **`reasonDetail`** — parsed JSON when `reason` is valid JSON; otherwise `null`.
- **`context`** — best-effort triage context from targetId → transaction_raw → import_file.

---

### `PATCH /resolution/:id`

Update one resolution item status.

**Request body:**
```json
{ "status": "open | in_review | resolved" }
```

**Transition rules:**
- `open` → `in_review` or `resolved`
- `in_review` → `open` or `resolved`
- `resolved` → `open` (reopen) or `resolved` (idempotent)

**Response 200:**
```json
{ "id": "uuid", "status": "resolved" }
```

**Side effect on resolve:** if item type is `duplicate_ambiguity`, any linked `transaction_canonical` with `status = 'duplicate'` is promoted to `status = 'posted'` (with fresh fingerprint).

**Errors:**
- **400** — invalid payload.
- **404** — item not found.
- **409** — invalid transition.

---

### `POST /resolution/bulk`

Apply one target status to many items. Best-effort; updates every row allowing the transition; others listed in **`errors`**.

**Request body:**
```json
{
  "ids": ["uuid", "uuid"],
  "status": "resolved"
}
```

- `ids` — max **200** (de-duplicated).

**Response 200:**
```json
{
  "updated": [{ "id": "uuid", "status": "resolved" }],
  "errors": [
    { "id": "uuid", "code": "NOT_FOUND", "message": "Resolution item not found" }
  ]
}
```

---

### `POST /resolution/bulk-apply-category`

For **`unknown_category`** items only: sets `category_id` on linked `transaction_canonical` and marks item **`resolved`**.

**Request body:**
```json
{
  "ids": ["uuid", "uuid"],
  "categoryId": "uuid"
}
```

- `ids` — max **200**.
- `categoryId` — must be usable by household.

**Response 200:**
```json
{
  "updated": [{ "id": "resolution-item-uuid" }],
  "errors": [{ "id": "uuid", "code": "WRONG_TYPE", "message": "…" }]
}
```

---

### `POST /resolution/pattern-preview`

Returns count and examples of open **`unknown_category`** items matching a description pattern.

**Request body:**
```json
{ "descriptionPattern": "WHOLEFDS" }
```

**Response 200:**
```json
{
  "matched": 12,
  "descriptions": ["WHOLEFDS MKT #0001", "WHOLEFDS MKT #0002"]
}
```

---

### `POST /resolution/bulk-apply-by-pattern`

Finds all open **`unknown_category`** items matching a pattern, applies `categoryId` to each, and marks **`resolved`**.

**Request body:**
```json
{
  "descriptionPattern": "WHOLEFDS",
  "categoryId": "uuid"
}
```

- `descriptionPattern` — 1–200 chars; LIKE `%pattern%` (case-insensitive).

**Response 200:**
```json
{ "updated": 12 }
```

---

### `POST /resolution/:id/confirm-transfer`

Confirm a **`transfer_ambiguity`** item as a real transfer by selecting the explicit credit transaction.

**Request body:**
```json
{ "creditId": "uuid" }
```

Validates: both exist, are `posted`, have matching amounts (within 1¢), not already paired. Assigns shared `transfer_group_id` and resolves all open transfer items for both legs.

**Response 200:**
```json
{ "debitId": "uuid", "creditId": "uuid", "transferGroupId": "uuid" }
```

**Effect:** Both transactions excluded from cash flow KPIs (no double-counting).

**Errors:**
- **400** — not `transfer_ambiguity`, credit not found, amounts mismatch, or one leg already paired.
- **404** — item not found.

---

### `POST /resolution/bulk-confirm-transfers`

**Deprecated.** Returns **200** with all items erroring `MISSING_PAIR_IDS` — transfer ambiguity items must be confirmed individually.

---

## Export, Backup & Restore

Base path: `/exports`

Authenticated household backup as `.hfb` file (async job), and destructive restore from `.hfb`.

---

### `POST /exports/household`

**Auth:** Bearer JWT.

Queues an **export** job. Response is immediate (**202**); `.hfb` is built in background.

**Role / membership rules:**

| Role | Export scope |
|------|-------------|
| `owner`, `admin` | Full household export — all tables, all users, all transactions. |
| `member` (with profile) | Personal export — transactions/accounts filtered to their `owner_person_profile_id`. Shared reference data included. Users/household omitted. |
| `member` (no profile) | **403**. |

**Response 202:**
```json
{
  "jobId": "uuid",
  "scope": "household | member",
  "message": "Export started. Poll GET /exports/:jobId until status is complete, then GET /exports/:jobId/download for the .hfb backup."
}
```

**Errors:**
- **429** — rolling window limit (**10 export starts per user per hour**).

---

### `GET /exports/{jobId}`

Poll export job status.

**Auth:** Bearer JWT. Members may only view jobs they created (`requested_by_user_id`); querying another user's job returns **403 FORBIDDEN**.

**Response 200:**
```json
{
  "id": "uuid",
  "status": "string",
  "scope": "household | member",
  "createdAt": "…",
  "completedAt": "…",
  "error": null
}
```

- **`error`** — when `status = failed`, a fixed safe message ("Job failed due to a system error. Check server logs for details."); never the raw exception text. Full error detail is server-side only (`log.error`).

**Errors:**
- **403** — `FORBIDDEN` — member attempted to view another user's export job.
- **404** — `EXPORT_JOB_NOT_FOUND`.

---

### `GET /exports/{jobId}/download`

Returns the backup file as binary attachment when job finished successfully.

**Auth:** Bearer JWT. Members may only download jobs they created (`requested_by_user_id`); downloading another user's job returns **403 FORBIDDEN**. Full household exports (created by owner/admin) are not accessible to members.

**Response 200** — binary file (`household-export-{jobId}.hfb`).

**Errors:**
- **403** — `FORBIDDEN` — member attempted to download another user's export job.
- **404** — Export not ready, file missing, or job not found.
- **410** — `EXPORT_EXPIRED` — file auto-deleted after 48-hour retention.

---

### `POST /exports/household/import/prepare` (SEC #186)

**Auth:** Bearer JWT. **Role:** owner only.

Step 1 of the two-phase restore flow. Validates the uploaded `.hfb` (reads and returns its
manifest, same shape as `POST /exports/preview`) and stashes the file server-side under a
short-lived confirmation token — it does **not** modify the database. A direct call to a
single "restore now" endpoint no longer exists; every restore must go through `prepare` then
`execute`.

**Content-Type:** `multipart/form-data` with field **`file`** — `.hfb` backup.

**Response 200:**
```json
{
  "token": "uuid",
  "exportVersion": 4,
  "exportedAt": "2026-04-30T00:00:00.000Z",
  "encrypted": false,
  "scope": "household | member",
  "personProfileId": "uuid-or-null",
  "format": "zip-split-v4",
  "tables": { "transaction_canonical": { "rows": 1234 } },
  "totalRows": 1234
}
```

The `token` is single-use and expires after **15 minutes** if `execute` is never called; expired
or already-consumed prepared files are swept (and deleted from disk) lazily on the next call to
either `prepare` or `execute`.

**Errors:**
- **400** — No file, not `.hfb`, or the file could not be read as a valid backup.
- **413** — Upload over **500 MB**.
- **422** — Encrypted but `BACKUP_ENCRYPTION_KEY` not configured.

---

### `POST /exports/household/import/execute` (SEC #186)

**Auth:** Bearer JWT. **Role:** owner only.

Step 2 of the two-phase restore flow. Consumes the token returned by `prepare` and queues the
actual **restore** job: wipes household-scoped data (FK-safe order), reloads from the prepared
`.hfb` bundle (remaps bundle `householdId` to current household). `import_file` rows not
restored; `import_file_id` cleared on balance snapshots/payslips.

**Content-Type:** `application/json`
```json
{ "token": "uuid" }
```

**Response 202:**
```json
{
  "jobId": "uuid",
  "message": "Restore started. Poll GET /exports/import/:jobId for status."
}
```

After success, JWTs for household users are invalidated; client should sign out.

**Errors:**
- **400** — Missing/invalid `token` field (`{ errors: z.issues }`).
- **410** — `PREPARE_TOKEN_EXPIRED` — token missing, expired, already used, or issued to a
  different household/user.

---

### `POST /exports/preview`

Unaffected by SEC #186 — still a standalone read-only preview (always deletes its upload) kept
for callers that only want a manifest without ever restoring. The device restore UI now calls
`prepare` instead, since `prepare`'s response already includes the manifest.

**Auth:** Bearer JWT. **Role:** owner only.

**Content-Type:** `multipart/form-data` with field **`file`** — `.hfb` backup.

Returns preview without modifying database.

**Response 200:**
```json
{
  "exportVersion": 4,
  "exportedAt": "2026-04-30T00:00:00.000Z",
  "encrypted": false,
  "scope": "household | member",
  "personProfileId": "uuid-or-null",
  "format": "zip-split-v4",
  "tables": { "transaction_canonical": { "rows": 1234 } },
  "totalRows": 1234
}
```

**Errors:**
- **400** — missing file, wrong extension, unsupported version.
- **422** — encrypted but `BACKUP_ENCRYPTION_KEY` not configured.

---

### `GET /exports/import/{jobId}`

Poll import (restore) job status.

**Response 200:**
```json
{
  "id": "uuid",
  "status": "string",
  "createdAt": "…",
  "completedAt": "…",
  "error": null,
  "stats": { "table_key": 1234 }
}
```

- **`stats`** — per-table row count when complete.
- **`error`** — when `status = failed`, a fixed safe message ("Job failed due to a system error. Check server logs for details."); never the raw exception text. Full error detail is server-side only (`log.error`).

**Errors:**
- **404** — `IMPORT_JOB_NOT_FOUND`.

---

### Export Format Notes

- Current version: **exportVersion 4** — `manifest.json` plus one JSON file per table.
- Accepts restore: **v4/v3** and legacy **v1/v2**.
- **Categories/rules** — household rows only (built-ins not duplicated).
- **Member-scoped exports** — `scope: "member"` in manifest; not suitable for full household restore.
- **Encryption** — when `BACKUP_ENCRYPTION_KEY` set (64 hex, 32 bytes), ZIP bytes encrypted with AES-256-GCM.
  - Format: `HFB1` magic (4 bytes) + IV (12) + auth tag (16) + ciphertext.
  - Auto-detect by `HFB1` magic prefix.

---

### Tables in exportVersion 4

| Table key | Household export | Member export |
|-----------|------------------|---------------|
| `app_user` | Yes | No |
| `household` | Yes | No |
| `household_custom_institution` | Yes | No |
| `financial_account` | Yes | Member-owned only |
| `category` | Yes | Yes |
| `person_profile` | Yes | Self only |
| `household_membership` | Yes | No |
| `category_rule` | Yes | Yes |
| `budget_category` | Yes | No |
| `transaction_canonical` | Yes | Member-owned only |
| `account_balance_snapshot` | Yes | Member-owned accounts only |
| `payslip_snapshot` | Yes | Member-owned only |
| `payslip_line_item` | Yes | For member-owned payslips only |
| `recurring_merchant_override` | Yes | No |
| `resolution_item` | Yes | No |
| `household_ai_insight` | Yes | No |

---

## Google Drive Integration

Base path: `/gdrive`

Household-level link to a single Google Drive folder using **OAuth2** with user refresh token (files owned by user, use their Drive quota). **`Authorization: Bearer <JWT>`** required on all routes except **`GET /gdrive/oauth/callback`** (browser redirect).

**Server env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, optional `FRONTEND_APP_URL` / `PUBLIC_BASE_URL`.

---

### Role Matrix

| Route | `owner` | `admin` | `member` |
|-------|---------|---------|----------|
| `GET /gdrive/oauth/callback` | Public | Public | Public |
| `GET /gdrive/oauth/url` | Yes | **403** | **403** |
| `GET /gdrive/status` | Yes | Yes | **403** |
| `POST /gdrive/connect` | Yes | **403** | **403** |
| `DELETE /gdrive/disconnect` | Yes | **403** | **403** |
| `PATCH /gdrive/settings` | Yes | **403** | **403** |
| `POST /gdrive/backup` | Yes | **403** | **403** |
| `GET /gdrive/backup/:jobId` | Yes | Yes | **403** |
| `GET /gdrive/backups` | Yes | Yes | **403** |
| `GET /gdrive/backups/history` | Yes | Yes | **403** |
| `POST /gdrive/backups/:fileId/preview` | Yes | **403** | **403** |
| `POST /gdrive/restore` | Yes | **403** | **403** |

---

### Automatic Backup Scheduler

When **`MODE` is not `TEST`**, the API runs: **30s delay** → **`checkAndQueueDueBackups`** every **30 minutes**.

For each `household_gdrive_config` with **`backup_frequency_hours > 0`**:

1. If any **`queued`** or **`running`** job exists, skip.
2. Find most recent **`complete`** job. If none, household is overdue.
3. If **`now - last_completed_at ≥ backup_frequency_hours`**, insert new job (automatic; `triggered_by_user_id = null`).

**Backup path on Drive:** Subfolder **`TEST`** or **`PROD`** under configured folder (matching server `MODE`). Created on first backup if missing.

**Retention:** After each upload, list `.hfb` files (newest first) and delete oldest excess so at most **`backup_retention_count`** remain.

---

### `GET /gdrive/status`

Returns connection metadata. Tokens never returned.

**Response 200 — not configured:**
```json
{ "connected": false }
```

**Response 200 — configured:**
```json
{
  "connected": true,
  "folderId": "…",
  "folderName": "Household backups",
  "connectedAt": "2026-05-01T12:00:00.000Z",
  "connectedByUserId": "uuid-or-null",
  "lastVerifiedAt": "2026-05-01T12:00:00.000Z",
  "lastError": null,
  "backupFrequencyHours": 24,
  "backupRetentionCount": 7,
  "lastScheduledBackupAt": "2026-05-01T03:00:00.000Z"
}
```

- **`connectedByUserId`** — Audit field; **`null`** if user was deleted.
- **`backupFrequencyHours`** — **0** disables automatic backups. Allowed: **12, 24, 48, 72, 168**.
- **`backupRetentionCount`** — **1–30**; number of files to keep.

---

### `GET /gdrive/oauth/url`

**Owner only.** Query: **`folderId`** (required).

**Response 200:**
```json
{ "url": "<https://accounts.google.com/...>" }
```

**Errors:**
- **400** — `OAUTH_NOT_CONFIGURED` when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` not set.

---

### `GET /gdrive/oauth/callback`

**Public.** Query: **`code`**, **`state`** (both required).

Verifies `state` HMAC, exchanges `code` for tokens, verifies folder access, upserts `household_gdrive_config`.

**Response 302** — Redirect to **`/#/settings?tab=data&gdrive=connected`** on success, or **`...&gdrive=error&message=<encoded>`** on failure.

---

### `POST /gdrive/connect`

**Owner only.** Exchange authorization code.

**Request body:**
```json
{
  "code": "authorization code from Google",
  "folderId": "Drive folder ID"
}
```

1. Exchanges `code` for OAuth tokens.
2. Calls Drive API (`files.get`) to verify folder access.
3. Upserts `household_gdrive_config` (preserves scheduler fields on conflict).

**Response 200** — connection metadata.

**Errors:**
- **400** — `OAUTH_NOT_CONFIGURED`.
- **422** — `DRIVE_CONNECTION_FAILED` (token exchange or Drive API fails).
- **429** — too many connects in rolling window (disabled in `MODE=TEST`).

---

### `DELETE /gdrive/disconnect`

**Owner only.** Removes stored credentials.

**Response 200:**
```json
{ "connected": false }
```

Idempotent.

---

### `PATCH /gdrive/settings`

**Owner only.** Updates scheduler fields.

**Request body:**
```json
{
  "backupFrequencyHours": 24,
  "backupRetentionCount": 7
}
```

- **`backupFrequencyHours`** — **0, 12, 24, 48, 72, or 168**.
- **`backupRetentionCount`** — **1–30**.

**Response 200** — echo saved values.

**Errors:**
- **400** — Zod validation.
- **409** — `GDRIVE_NOT_CONFIGURED` (not connected).

---

### `POST /gdrive/backup`

**Owner only.** Queues async full-household `.hfb` upload to Drive.

**Response 202:**
```json
{ "jobId": "…", "message": "Backup started. Poll GET /gdrive/backup/:jobId for status." }
```

**Errors:**
- **409** — `GDRIVE_NOT_CONFIGURED`.
- **429** — too many backups per user in rolling window.

---

### `GET /gdrive/backup/:jobId`

**Owner or admin.** Poll until `status` is `complete` or `failed`.

**Response 200:**
```json
{
  "id": "uuid",
  "status": "queued | running | complete | failed",
  "driveFileId": "…",
  "driveFileName": "…",
  "sizeBytes": 1024,
  "errorText": null,
  "createdAt": "…",
  "completedAt": "…"
}
```

**Errors:**
- **404** — `BACKUP_JOB_NOT_FOUND`.

---

### `GET /gdrive/backups`

**Owner or admin.** Lists up to **20** most recent `.hfb` files in Drive **`TEST`/`PROD`** subfolder.

**Response 200:**
```json
{
  "files": [
    {
      "fileId": "…",
      "fileName": "…",
      "sizeBytes": 1024,
      "createdAt": "2026-05-01T12:00:00Z"
    }
  ]
}
```

- **`sizeBytes`** may be `null`.

**Errors:**
- **409** — `GDRIVE_NOT_CONFIGURED`.
- **502** — `DRIVE_LIST_FAILED`.

---

### `GET /gdrive/backups/history`

**Owner or admin.** Returns up to **20** local **`backup_job`** rows (newest first). Includes automatic jobs (`triggeredByUserId = null`).

**Response 200:**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "status": "string",
      "driveFileId": "…",
      "driveFileName": "…",
      "sizeBytes": 1024,
      "errorText": null,
      "triggeredByUserId": "uuid-or-null",
      "createdAt": "…",
      "completedAt": "…"
    }
  ]
}
```

**Errors:**
- **409** — `GDRIVE_NOT_CONFIGURED`.

---

### `POST /gdrive/backups/:fileId/preview`

**Owner only.** Downloads Drive file, reads `.hfb` manifest, returns preview without importing. Temp file always deleted.

**Response 200:** Same shape as `POST /exports/preview`.

**Errors:**
- **404** — `DRIVE_FILE_NOT_FOUND`.
- **403** — `DRIVE_PERMISSION_DENIED`.
- **409** — `GDRIVE_NOT_CONFIGURED`.
- **422** — encrypted, no `BACKUP_ENCRYPTION_KEY`.
- **502** — `DRIVE_DOWNLOAD_FAILED`.
- **400** — not a valid `.hfb`.

---

### `POST /gdrive/restore`

**Owner only.** Downloads file from Drive, queues restore pipeline.

**Request body:**
```json
{ "fileId": "<Drive file id>" }
```

**Response 202:**
```json
{ "jobId": "…", "message": "Restore started. Poll GET /exports/import/:jobId for status." }
```

Poll **`GET /exports/import/:jobId`** until complete or failed. After success, JWTs invalidated; client should sign out.

**Errors:**
- **409** — `GDRIVE_NOT_CONFIGURED`.
- **502** — `DRIVE_DOWNLOAD_FAILED`.

---

## Notifications

Base path: `/notifications`

All routes require `Authorization: Bearer <JWT>`. All household members can read and manage their own notifications.

---

### `GET /notifications`

Returns authenticated user's notification list: up to **40** unread (newest first) + last **10** read.

**Response 200:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "userId": "uuid",
      "type": "backup_failed",
      "title": "Google Drive backup failed",
      "body": "Backup failed: Permission denied.",
      "actionUrl": "/settings?tab=data",
      "readAt": null,
      "createdAt": "2026-05-25T12:00:00Z"
    }
  ]
}
```

**Notification types:**

| type | trigger |
|------|---------|
| `import_complete` | Bank statement import finishes (inserted > 0) |
| `export_ready` | Export job completes |
| `restore_complete` | Household restore finishes |
| `backup_complete` | Google Drive backup succeeds |
| `backup_failed` | Google Drive backup fails |
| `property_valuation_updated` | Monthly auto-valuation scheduler fires |
| `budget_threshold_80` | Category spend reaches 80% of monthly budget |
| `budget_threshold_100` | Category spend reaches or exceeds 100% of budget |
| `large_transaction` | Transaction exceeds `large_txn_threshold_usd` |

---

### `GET /notifications/unread-count`

Lightweight poll endpoint. The frontend calls this on a background interval (not direct user
action), so it sends `x-background-poll: 1` — this lets the server distinguish it from a
real/user-initiated request (see FIX #221).

**Headers:** `x-background-poll: 1` (frontend background poll only; any authenticated caller
without this header is treated as a real request and always allowed).

**Response 200:**
```json
{ "count": 3 }
```

**Response 401** (only when `x-background-poll: 1` is set and the session has had no
non-background request in 15+ minutes):
```json
{ "message": "Session idle", "code": "token_stale" }
```
The JWT itself is still valid — this is a server-side idle backstop independent of the JWT's own
expiry, so a background poll from an unattended/zombie tab stops generating DB traffic even if
the client-side idle-logout guard never runs. A real request (no `x-background-poll` header)
from the same token always succeeds and refreshes the activity window.

---

### `PATCH /notifications/:id/read`

Mark a single notification as read.

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- **404** — not found or belongs to another user.

---

### `POST /notifications/read-all`

Mark all unread notifications as read.

**Response 200:**
```json
{ "ok": true }
```

---

### `GET /notifications/preferences`

Return full preference matrix — one entry per notification type. Missing rows return system defaults.

**Response 200:**
```json
{
  "preferences": [
    {
      "userId": "uuid",
      "notificationType": "backup_failed",
      "enabledEmail": true,
      "enabledInapp": true
    }
  ]
}
```

**System defaults:**

| type | email | in-app |
|------|-------|--------|
| `export_ready` | Yes | Yes |
| `restore_complete` | Yes | Yes |
| `backup_complete` | No | Yes |
| `backup_failed` | Yes | Yes |
| `property_valuation_updated` | No | Yes |
| `budget_threshold_80` | No | Yes |
| `budget_threshold_100` | Yes | Yes |
| `large_transaction` | No | Yes |

---

### `PUT /notifications/preferences`

Bulk upsert preferences. Partial updates supported — send only types to change.

**Request body:**
```json
{
  "preferences": [
    { "notificationType": "backup_failed", "enabledEmail": false, "enabledInapp": true }
  ]
}
```

**Response 200** — updated full preference matrix.

**Errors:**
- **400** — invalid payload.

---

### Behavior Notes

- Notifications auto-deleted after **90 days** on server startup.
- Budget threshold notifications **deduped**: at most one `budget_threshold_80` and one `budget_threshold_100` per category per calendar month.
- **`large_transaction`** threshold configured per-household via `PATCH /household/settings` (`largeTxnThresholdUsd`; **null** = disabled).
- Broadcast notifications (e.g. `backup_failed`, `restore_complete`) insert one row per household member.

---

## AI Insights

Base path: `/insights`

All routes require `Authorization: Bearer <JWT>`.

---

### `GET /insights/financial`

Returns latest generated insight for caller scope (`household` for owner/admin, `personal` for member), or `null` when absent.

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "householdId": "uuid",
    "userId": "uuid",
    "scope": "household | personal",
    "healthRating": "strong | on_track | needs_attention | at_risk",
    "healthRationale": "concise explanation",
    "localBenchmark": "local comparison narrative",
    "nationalBenchmark": "national comparison narrative",
    "whatsWorking": ["strength 1", "strength 2"],
    "concerns": ["risk 1", "attention area 2"],
    "spendingAnalysis": "spending-pattern observations",
    "investmentGaps": "investing or savings gap observations",
    "nextSteps": "concrete next-step recommendations",
    "createdAt": "…"
  }
}
```

---

### `POST /insights/financial/refresh`

Enqueue asynchronous insight generation.

**Response 202:**
```json
{ "ok": true, "jobId": "uuid" }
```

**Errors:**
- **429** — `RATE_LIMITED` (one refresh per household every 5 minutes).

---

### `GET /insights/financial/status/:jobId`

Poll async job state.

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "jobId": "uuid",
    "status": "queued | running | complete | failed",
    "insightId": "uuid-or-null",
    "errorText": "error message when failed"
  }
}
```

**Errors:**
- **400** — invalid jobId.

---

### `GET /insights/financial/history?limit=10&offset=0`

Paginated history for caller scope.

**Query (optional):**
- `limit` — default 10
- `offset` — default 0

**Response 200:**
```json
{
  "ok": true,
  "data": [
    { "id": "uuid", "scope": "household", "createdAt": "…", ... }
  ]
}
```

---

### `GET /insights/financial/:id`

Fetch one historical insight by id.

**Response 200:**
```json
{
  "ok": true,
  "data": { ... }
}
```

**Errors:**
- **404** — `NOT_FOUND`.

---

### Polling Contract

1. Call `POST /insights/financial/refresh`.
2. Read `jobId` from **202** response.
3. Poll `GET /insights/financial/status/:jobId` until:
   - `status = complete` → use `insightId` or call `GET /insights/financial`.
   - `status = failed` → display `errorText` and allow retry.
4. Optional: show history with `GET /insights/financial/history`.

---

### Scope Logic

- **Owner/admin** callers: always read/generate `scope = household` insights.
- **Member** callers: always read/generate `scope = personal` insights for their `userId`.
- Scope enforced server-side; cannot be overridden by client.

---

### Privacy

LLM prompt includes only anonymized aggregates and profile/demographic fields. No names, emails, account numbers, or raw transaction descriptions.

---

## ESPP Equity Tracker

IBM ESPP purchase batch and sale history management. All endpoints require authentication.

---

### GET /espp/stock-quote

Returns the latest IBM stock quote from a 1-hour in-memory cache. Populated on server startup and refreshed automatically at ~4:15 PM ET on weekdays via `yahoo-finance2`.

**Response 200**
```json
{
  "symbol": "IBM",
  "price": 297.80,
  "previousClose": 264.22,
  "asOf": "2026-05-30"
}
```

**Response 503** — cache empty (server just started and initial fetch failed):
```json
{ "message": "Stock quote unavailable" }
```

---

### GET /espp/batches

Returns all purchase batches with their sale history for the specified year.

**Query params:** `year` (integer, required)

**Response `200`:**
```json
{
  "batches": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "purchaseDate": "2026-04-25",
      "sharesGranted": 6.0,
      "fmvPerShare": 190.00,
      "costBasisPerShare": 160.00,
      "discountPerShare": 30.00,
      "sharesTransferred": 4.0,
      "payslipId": "uuid | null",
      "esppDiscountPayslip": 60.00,
      "esppSalaryDeduction": 340.00,
      "esppOtherDeduction": 2.50,
      "sharesSold": 2.0,
      "held": 2.0,
      "status": "Partially Sold",
      "sales": [
        {
          "id": "uuid",
          "batchId": "uuid",
          "saleDate": "2026-06-01",
          "sharesSold": 2.0,
          "salePricePerShare": 200.00,
          "proceeds": 400.00,
          "ordinaryIncome": 60.00,
          "capGainLoss": 20.00,
          "createdAt": "2026-06-01T12:00:00Z"
        }
      ],
      "createdAt": "2026-04-25T00:00:00Z",
      "updatedAt": "2026-04-25T00:00:00Z"
    }
  ]
}
```

**Errors:** `400` — missing or invalid `year`

---

### GET /espp/summary

Returns aggregated year-level statistics for the specified year.

**Query params:** `year` (integer, required)

**Response `200`:**
```json
{
  "year": 2026,
  "sharesPurchased": 6.0,
  "sharesTransferred": 4.0,
  "sharesSold": 2.0,
  "totalInvested": 960.00,
  "discountReceivedYtd": 60.00,
  "saleProceeds": 400.00,
  "realizedGainLoss": 80.00,
  "ordinaryIncomeYtd": 60.00,
  "capGainLossYtd": 20.00
}
```

Returns zero values for all numeric fields if no data exists for the year. **Errors:** `400` — missing or invalid `year`

---

### POST /espp/import

Parses and upserts an ESPP purchase batch from EquatePlus files. At least one file is required.

**Content-Type:** `multipart/form-data`

**Fields:**
- `pdf` (file, optional) — EquatePlus purchase confirmation PDF. Provides FMV, cost basis, allocated shares, purchase date.
- `csv` (file, optional) — EquatePlus allocation export CSV. Provides transferred shares and cost basis.

At least one of `pdf` or `csv` must be present.

On success, automatically links the batch to a matching payslip (by `pay_date` or `pay_period_end` = `purchaseDate`) and stores IBM-authoritative ESPP deduction amounts from the payslip line items.

Re-importing the same purchase date upserts (updates) the existing row rather than creating a duplicate.

**Response `201`:**
```json
{ "batch": { /* EsppBatchRow — same shape as in /espp/batches */ } }
```

**Errors:**
- `400` — no file provided
- `422 NO_DATE` — purchase date could not be determined from the uploaded files
- `422 NO_COST_BASIS` — cost basis not found (CSV-only upload with no PDF)
- `422 PDF_PARSE_ERROR` — PDF could not be parsed

---

### POST /espp/sales

Records one or more lot disposals in a single transaction.

**Request body:**
```json
{
  "saleDate": "2026-05-01",
  "rows": [
    {
      "batchId": "uuid",
      "sharesSold": 1.5,
      "salePricePerShare": 250.00
    }
  ]
}
```

Computed and stored server-side:
- `proceeds` = `sharesSold × salePricePerShare`
- `ordinaryIncome` = `discountPerShare × sharesSold`
- `capGainLoss` = `(salePricePerShare − fmvPerShare) × sharesSold`

**Response `201`:**
```json
{ "sales": [ /* EsppSaleRow[] */ ] }
```

**Errors:**
- `400` — invalid payload (missing fields, wrong types)
- `404 BATCH_NOT_FOUND` — batchId not found or not owned by this household
- `422 OVERSOLD` — sharesSold exceeds available held shares
- `422 INCOMPLETE_BATCH` — batch is missing FMV data (no PDF imported yet)

---

### DELETE /espp/sales/:saleId

Removes a sale record. The parent batch's held/status will reflect the change on the next `GET /espp/batches` call.

**Response:** `204 No Content`

**Errors:** `404` — sale not found or not owned by this household

---

## Error Response Format

Validation errors use `400` with shape:

```json
{ "errors": [{ "code": "string", "message": "string", "path": "array" }] }
```

Resource not found: `404` with shape:

```json
{ "code": "NOT_FOUND", "message": "…" }
```

Server errors: `5xx` with shape:

```json
{ "code": "SERVER_ERROR", "message": "…" }
```

---

## Google Calendar Integration

Base path: `/gcal`

Per-user link to a Google Calendar via **OAuth2** (`calendar.readonly` scope). Each parent connects their own account independently — tokens stored per `user_id` in `oauth_integrations`. **`Authorization: Bearer <JWT>`** required on all routes except **`GET /gcal/oauth/callback`** (browser redirect from Google).

Same Google Cloud project as Drive (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Separate redirect URI: `GOOGLE_CALENDAR_REDIRECT_URI`.

### Role Access

| Endpoint | Owner | Admin | Member |
|----------|-------|-------|--------|
| `GET /gcal/oauth/callback` | Public | Public | Public |
| `GET /gcal/oauth/url` | Yes | Yes | **403** |
| `POST /gcal/connect` | Yes | Yes | **403** |
| `GET /gcal/status` | Yes | Yes | **403** |
| `DELETE /gcal/disconnect` | Yes | Yes | **403** |
| `GET /gcal/calendars` | Yes | Yes | **403** |
| `PATCH /gcal/calendars` | Yes | Yes | **403** |
| `PATCH /gcal/calendar-roles` | Yes | Yes | **403** |
| `GET /gcal/events` | Yes | Yes | **403** |

### `GET /gcal/oauth/url`

Returns the Google OAuth consent URL for Calendar.

**Response `200`:**
```json
{ "url": "https://accounts.google.com/o/oauth2/auth?..." }
```

**Error `400 OAUTH_NOT_CONFIGURED`** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_CALENDAR_REDIRECT_URI` not set on server.

---

### `GET /gcal/oauth/callback`

Google redirects here after user grants consent. Exchanges code, stores tokens, performs JS redirect back to the SPA (`/settings?tab=family&gcal=connected`). On failure, redirects with `gcal=error&message=…`.

Not called directly by clients.

---

### `POST /gcal/connect`

Direct code exchange (SPA flow). Accepts an OAuth authorization code and stores tokens.

**Request body:**
```json
{ "code": "4/0Adeu5BV…" }
```

**Response `200`:**
```json
{ "connected": true }
```

**Error `422 GCAL_CONNECTION_FAILED`** — token exchange failed (code expired, already used, etc.).

---

### `GET /gcal/status`

Returns the requesting user's Calendar connection state.

**Response `200`:**
```json
{
  "connected": true,
  "connectedAt": "2026-06-22T18:00:00.000Z",
  "needsReauth": false,
  "lastError": null
}
```

`connected: false` when no token stored. `needsReauth: true` when Google returned 401/403 on the last API call — user must reconnect.

---

### `DELETE /gcal/disconnect`

Removes the requesting user's Calendar tokens. Does not affect other users in the household.

**Response `200`:**
```json
{ "connected": false }
```

---

### `GET /gcal/calendars`

Lists every calendar the connected Google account can read, the user's saved selection (which
calendars feed the family agent), and a **role** per calendar: `work` | `school` | `activities` | `other`.
Role defaults to a name-based heuristic (`heuristicCalendarRole`) when no explicit role has been
saved — e.g. a calendar named "Example ISD" defaults to `school`. The family agent uses `school`
to treat those events as informational only (a school closure is not parent unavailability),
never as a parent commitment (FIX #212).

**Response `200`:**
```json
{
  "calendars": [
    { "id": "primary", "summary": "Jane Doe", "primary": true, "backgroundColor": "#039BE5" },
    { "id": "abc123@group.calendar.google.com", "summary": "Example ISD", "primary": false, "backgroundColor": null }
  ],
  "selectedIds": ["primary", "abc123@group.calendar.google.com"],
  "roles": {
    "primary": "work",
    "abc123@group.calendar.google.com": "school"
  }
}
```

**Errors:** `409 GCAL_NOT_CONNECTED`, `401 GCAL_NEEDS_REAUTH`, `502` (Google API error).

---

### `PATCH /gcal/calendars`

Saves the requesting user's calendar selection (which calendars feed events into the app).

**Request body:**
```json
{ "selectedIds": ["primary", "abc123@group.calendar.google.com"] }
```

**Response `200`:** `{ "ok": true }`. **`400`** if `selectedIds` is missing or empty.

---

### `PATCH /gcal/calendar-roles`

Saves a per-calendar role so the family agent can distinguish a school calendar's events from
an actual parent commitment, or tag a calendar as kid activities (FIX #212).

**Request body:**
```json
{ "roles": { "abc123@group.calendar.google.com": "school" } }
```

Each value must be one of `work` | `school` | `activities` | `other`.

**Response `200`:** `{ "ok": true }`. **`400`** if `roles` is missing or contains an invalid role value.

---

### `GET /gcal/events?days=N`

Lists upcoming calendar events across all calendars the user has access to. `days` defaults to 14; max 90.

**Response `200`:**
```json
{
  "events": [
    {
      "id": "abc123",
      "summary": "School pickup",
      "start": "2026-06-25T15:00:00-05:00",
      "end": "2026-06-25T15:30:00-05:00",
      "allDay": false,
      "location": null,
      "description": null,
      "calendarId": "primary"
    },
    {
      "id": "def456",
      "summary": "Kid's field trip",
      "start": "2026-06-26",
      "end": "2026-06-27",
      "allDay": true,
      "location": null,
      "description": null,
      "calendarId": "primary"
    }
  ],
  "count": 2
}
```

`allDay: true` — event has only a date (`start.date`), no time component.

**Error `409 GCAL_NOT_CONNECTED`** — user has not connected Calendar.
**Error `401 GCAL_NEEDS_REAUTH`** — Google returned 401/403; user must reconnect. `needs_reauth` flag set in DB.
**Error `502 GCAL_API_ERROR`** — other Google API failure.

## Family Planner — Member Profiles & Help Availability

All endpoints require `Authorization: Bearer <token>`. All paths are prefixed `/api/family`.

---

### `GET /api/family/members`

Returns all household members with their profile data. Requires `owner | admin | member`.

**Response `200`**
```json
{
  "members": [
    {
      "profileId": "70000000-0000-0000-0000-000000000001",
      "fullName": "Alex Owner",
      "relationship": "self",
      "age": 35,
      "linkedUserId": "20000000-0000-0000-0000-000000000001",
      "interestsJson": ["cycling", "cooking"],
      "notes": null
    }
  ]
}
```

`relationship` — one of `self | spouse | child | dependent | other`.
`interestsJson` — parsed JSON array of interest tags.
`linkedUserId` — present if the member has an app login; `null` for external helpers (nanny, cleaner, etc.).

---

### `PATCH /api/family/members/:profileId`

Updates `interestsJson`, `notes`, and/or `age` on a person profile. Requires `owner | admin`.

**Body** (all fields optional)
```json
{
  "interestsJson": ["piano", "swimming"],
  "notes": "Lincoln Elementary, 1st grade",
  "age": 7
}
```

**Response `200`** — `{ "member": HouseholdMember }`
**Error `404`** — profile not in caller's household.

---

### `GET /api/family/availability`

Lists household help availability slots. Requires `owner | admin | member`.

**Query params**
- `includeInactive=true` — include deactivated slots (default: active only).

**Response `200`**
```json
{
  "slots": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "personProfileId": "uuid",
      "personName": "Example Nanny",
      "slotType": "regular",
      "serviceType": "nanny",
      "dayOfWeek": 1,
      "specificDate": null,
      "startTime": "08:00",
      "endTime": "18:00",
      "label": "Monday regular hours",
      "notes": null,
      "isActive": true,
      "createdAt": "2026-06-24T00:00:00.000Z"
    }
  ]
}
```

`slotType` — `regular` (recurring weekly, use `dayOfWeek`), `one_off` (single date, use `specificDate`), `unavailable` (override, use `specificDate`).
`serviceType` — `nanny | babysitter | cleaner | activity_teacher | tutor | other`.
`dayOfWeek` — 0 = Sunday … 6 = Saturday. `null` for `one_off` / `unavailable` slots.

---

### `POST /api/family/availability`

Creates a new availability slot. Requires `owner | admin`.

**Body**
```json
{
  "personProfileId": "uuid",
  "slotType": "one_off",
  "serviceType": "babysitter",
  "specificDate": "2026-07-04",
  "startTime": "09:00",
  "endTime": "20:00",
  "label": "Holiday coverage"
}
```

**Response `201`** — `{ "slot": HelpAvailabilitySlot }`

---

### `PATCH /api/family/availability/:id`

Updates any field on an existing slot. Use `isActive: false` to deactivate without deleting. Requires `owner | admin`.

**Body** (all fields optional)
```json
{ "endTime": "17:00", "isActive": false }
```

**Response `200`** — `{ "slot": HelpAvailabilitySlot }`
**Error `404`** — slot not in caller's household.

---

### `DELETE /api/family/availability/:id`

Permanently removes an availability slot. Requires `owner | admin`.

**Response `204`** — no body.
**Error `404`** — slot not in caller's household.

---

### `GET /api/family/pa-preferences`

Lists PA agent memory-store rows (standing facts/constraints for the planning assistant). Requires `owner | admin | member`.

**Query params**
- `category=preference|discovered_fact|decision_history` — filter to one category (default: all).

**Response `200`**
```json
{
  "preferences": [
    {
      "id": 1,
      "householdId": "uuid",
      "category": "preference",
      "factText": "No Schengen transit — visa risk for H1B holders",
      "source": "manual",
      "createdAt": "2026-07-14T00:00:00.000Z",
      "updatedAt": "2026-07-14T00:00:00.000Z"
    }
  ]
}
```

`category` — `preference` rows are injected in full into every PA loop prompt (no similarity filtering); `discovered_fact` / `decision_history` are stored but not yet consumed by the loop (see GH #238).
`source` — `manual` (added via this API) or `feedback` (reserved for a future agent-write path, GH #238).

---

### `POST /api/family/pa-preferences`

Creates a preference row. Text-based dedup: if a near-exact match (trimmed/lowercased/whitespace-collapsed) already exists in the same household + category, the existing row is updated in place instead of inserting a duplicate. Requires `owner | admin`.

**Body**
```json
{
  "category": "preference",
  "factText": "No Schengen transit — visa risk for H1B holders",
  "source": "manual"
}
```
`source` is optional, defaults to `manual`.

**Response `201`** — `{ "preference": PaPreference }`
**Error `400`** — validation failure, `{ "errors": ZodIssue[] }`.

---

### `DELETE /api/family/pa-preferences/:id`

Permanently removes a preference row. `:id` is an integer. Requires `owner | admin`.

**Response `204`** — no body.
**Error `400`** — `:id` is not an integer.
**Error `404`** — row not in caller's household.

---

### `POST /api/family/alerts/:alertId/approve`

Execute the action associated with a family agent alert. Currently only supports `action_type = 'create_gcal_event'` — creates a Google Calendar event from the alert's structured payload, writes a `family_events` row, and marks the alert resolved. Requires `owner | admin`.

**Request body:** none.

**Response `200`:**
```json
{
  "ok": true,
  "gcalEventId": "google-calendar-event-id",
  "gcalEventLink": "https://calendar.google.com/event?eid=...",
  "familyEventId": "uuid"
}
```
`gcalEventLink` may be `null` if Google does not return a link.

**Response `400`:**
```json
{ "error": "Alert already resolved" }
{ "error": "No action defined for alert" }
```

**Response `404`:**
```json
{ "error": "Alert not found" }
```

**Response `422`:**
```json
{ "code": "GCAL_NOT_CONNECTED", "message": "Google Calendar is not connected for this user." }
{ "code": "GCAL_NEEDS_REAUTH", "message": "Reconnect Google Calendar in Settings." }
{ "code": "UNSUPPORTED_ACTION_TYPE", "message": "..." }
```

**Response `500`:**
```json
{ "code": "GCAL_WRITE_ERROR", "message": "..." }
```

> **Note:** `GET /api/family/alerts` responses include `actionType` and `actionPayload` fields on each alert. The UI shows an **Add to Calendar** button only when `actionType === 'create_gcal_event'` and `isResolved === false`.

---

### `PATCH /api/family/alerts/:id/resolve`

Marks an alert resolved. Requires `owner | admin`.

**Request body** (all optional):
```json
{ "kind": "useful" | "not_relevant" | "already_knew" | null }
```
`kind` (FIX #208) records why the household dismissed the alert. Omitting it or sending `null` resolves with a neutral (no-feedback) disposition. Dispositions accumulate over a rolling 60-day window into a compact calibration summary that is injected into the proactive-research (Domain 3) and digest-synthesis (Domain 5) prompts on subsequent runs — categories repeatedly marked `not_relevant` (3+ times) are instructed out of future suggestion generation. This is an observations-only mechanism: it changes which alert categories the agent produces, never a lifestyle or spending recommendation.

**Response `200`:** `{ "ok": true }`
**Response `400`:** `{ "errors": [...] }` — invalid `kind` value.
**Response `404`:** `{ "message": "Alert not found or already resolved." }`

> **Note:** `GET /api/family/alerts` responses also include `resolutionKind` (`"useful" | "not_relevant" | "already_knew" | null`) on each alert.

---

### Household inbox email ingestion (FIX #215, broadened CR-224)

No new endpoints. A daily background poll (not an HTTP route) reads the dedicated household Gmail account over IMAP, identifies each email's genre (school/activity, order/delivery, financial notice, appointment/medical, invitation/social, utility/service/government, or promotional/newsletter) and extracts actionable items via a tool-less LLM call, then writes `alert_type = 'suggestion'` rows into `family_agent_alerts` — reusing the existing `POST /api/family/alerts/:alertId/approve` and `PATCH /api/family/alerts/:id/resolve` endpoints documented above for the approve/dismiss review flow. No suggestion is ever auto-written to `family_events` or Google Calendar without explicit approval.

> **Note:** `GET /api/family/alerts` responses also include `sourceQuote` (`string | null`) — for email-derived suggestions, a verbatim excerpt (≤200 chars) from the source email supporting the extracted item, rendered in the UI so the user can sanity-check the suggestion before approving it. `null` for non-email-derived alerts.

Each extracted item has a `kind` of `deadline | event | info | payment_due | delivery | appointment | rsvp`. Items of any kind other than `info` populate `actionType: 'create_gcal_event'` and `actionPayload` once a date resolves, so they go through the same approve flow as other calendar-writing suggestions. `info` items (e.g. a fraud/low-balance alert, which never carries a full account number — last 4 digits only) always have `actionType: null` — the user can only resolve/dismiss them, no calendar action is offered. An optional `urgency: "high" | "normal"` extracted per item surfaces as an `[URGENT]` tag alongside the existing `[EMAIL]` tag in the alert's `reason` text.

See `docs/ADMIN_GUIDE.md` for `FAMILY_INBOX_IMAP_*` env vars and IMAP App Password setup, and `docs/USER_GUIDE.md` for household-side Gmail label/filter setup.

---

### Occasion awareness — birthday/holiday lead-time nudges (#223)

A new agent domain, `detectOccasions`, runs alongside coverage/coordination, proactive research, and deadline sweeping on every agent run. It produces `alert_type = 'suggestion'` rows in `family_agent_alerts` (same table, same approve/resolve endpoints documented above) from three fully deterministic sources — no LLM, no Tavily:

1. **Household member birthdays** — `person_profile.date_of_birth_encrypted` (decrypted in-memory, never returned over the API in plaintext).
2. **Calendar-derived birthdays/anniversaries** — event titles on the household's connected Google Calendars matched against `/\b(birthday|bday)\b/i` and `/\banniversary\b/i`.
3. **Seasonal/cultural holidays** — read directly from any Google Calendar the household has subscribed to whose calendar ID ends `#holiday@group.v.calendar.google.com` (e.g. "Holidays in United States", "Holidays in India"). No hardcoded holiday list.

Each occasion is tiered by days-until: gift-able occasions (member birthdays, holidays) fire a `[GIFT-IDEAS]` alert at 21 days out and a `[LAST-CALL]` alert at 5 days out — both can be open simultaneously. Calendar-derived birthdays/anniversaries fire a single `[SEND-WISHES]` alert at 3 days out. Reason strings are stable (no day-count) so the existing mechanical alert dedup naturally suppresses re-firing after the first day a tier opens; `detectOccasions` also pre-filters candidates against already-open alerts before returning, so a multi-week gift-tier window doesn't retrigger the digest email every day it stays open.

#### `GET /api/family/occasion-settings`

Returns the caller's household occasion-nudge toggle. Requires `owner | admin`.

**Response `200`:**
```json
{ "ok": true, "settings": { "householdId": "uuid", "enabled": true } }
```
No row present defaults to `enabled: true`.

#### `PATCH /api/family/occasion-settings`

Enables or disables occasion nudges for the caller's household. Requires `owner | admin`.

**Request body:**
```json
{ "enabled": false }
```

**Response `200`:** `{ "ok": true, "settings": { "householdId": "uuid", "enabled": false } }`
**Response `400`:** `{ "errors": [...] }` — invalid body.

When disabled, `detectOccasions` returns no alerts on subsequent runs. Existing open occasion alerts are left as-is — they're only cleared by the normal approve/resolve flow.

> **Scope note:** this ships the detection + nudge slice only. The Phase 2 auto-enqueue gift-research bridge (opening a Tavily research task from a `[GIFT-IDEAS]` alert) is deferred, gated on issue #164.

---

### PA task endpoint — Quick Capture (#167)

Backs the Family page's Quick Capture box. A classifier decides whether the note is answerable immediately (`one_shot`, existing lightweight tool loop) or needs web research first (`research_loop`, the bounded BabyAGI-style loop — see `docs/ADMIN_GUIDE.md` §10.6). Replaces the old `POST /api/family/agent/capture` (removed — that route had no classifier and only ever called the one-shot path).

#### `POST /api/family/agent/task`

Requires `owner | admin`.

**Request body:**
```json
{ "note": "find swim camps with summer openings under $200", "mode": "research_loop" }
```
- `note` — 1-2000 chars, required.
- `mode` — optional, `"one_shot" | "research_loop"`. Skips the classifier LLM call and forces the given path.
- A note starting with `research:` (case-insensitive) also forces `research_loop` and skips the classifier — the prefix is stripped before the note is processed. `mode` and the prefix are independent; either alone is sufficient.

**Response `200` (one-shot):**
```json
{
  "type": "one_shot",
  "result": {
    "responseText": "Got it — I'll remind you Friday.",
    "actions": [
      { "type": "set_reminder", "title": "Call the vet", "summary": "Friday", "details": { "dueDate": "2026-07-17" } }
    ]
  }
}
```

**Response `200` (research loop):**
```json
{
  "type": "research_loop",
  "runId": "uuid",
  "result": {
    "goal": "find swim camps with summer openings under $200",
    "summary": "2-5 sentence synthesis, findings cited with observation dates.",
    "actions": [],
    "iterationsUsed": 4,
    "hitIterationCap": false,
    "promptTokens": 3500,
    "completionTokens": 600,
    "tavilyCalls": 3
  }
}
```
A `research_loop` result is also persisted as an `alert_type = 'suggestion'` row in `family_agent_alerts` (reason = `result.summary`), so it's visible again later in the Alerts panel.

**Response `400`:** `{ "errors": [...] }` — invalid body (empty/oversized note, bad `mode`).

**Response `409` (research loop only):** a normalized-equal goal is already `status = 'running'` for this household (#167 D5 concurrency dedup):
```json
{ "error": "PA_TASK_ALREADY_RUNNING", "message": "A similar research task is already running for this household — check back shortly.", "runId": "uuid" }
```

**Response `429` (research loop only):** monthly or daily run budget exhausted (see `PA_TASK_MAX_RUNS_PER_MONTH` / `PA_TASK_MAX_RUNS_PER_DAY` in `docs/ADMIN_GUIDE.md` §10.6):
```json
{ "error": "PA_BUDGET_EXCEEDED", "message": "This household has reached its PA task limit for today (20 runs). Resets at midnight (America/Chicago)." }
```

**Response `502`:** `{ "error": "CAPTURE_FAILED" | "PA_TASK_FAILED", "message": "..." }` — LLM/tool failure on either path.

#### `GET /api/family/agent/task/:runId`

Polls a `research_loop` run's status by id, scoped to the caller's household. Added as a fallback for a slow/timed-out synchronous `POST /agent/task` request. Requires `owner | admin`.

**Response `200`:**
```json
{
  "runId": "uuid",
  "status": "running" | "succeeded" | "failed" | "refused_budget",
  "summary": "string | null",
  "iterationsUsed": 4,
  "hitIterationCap": false,
  "createdAt": "2026-07-13T00:00:00.000Z",
  "finishedAt": "2026-07-13T00:00:20.000Z"
}
```
`summary`/`iterationsUsed`/`hitIterationCap`/`finishedAt` are `null` while `status = 'running'`.

**Response `404`:** `{ "error": "NOT_FOUND", "message": "No task run found with that id." }` — unknown id, or belongs to a different household.
