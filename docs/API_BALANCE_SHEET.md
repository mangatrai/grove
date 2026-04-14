# Balance sheet / net worth API

**Auth:** Bearer JWT (same as other household APIs).

## `GET /reports/balance-sheet`

**Query**

| Param | Required | Description |
|--------|----------|-------------|
| `asOf` | No | ISO date `YYYY-MM-DD` (defaults to **today** UTC). |
| `ownerScope` | No | When set to `household`, only accounts with **`owner_scope = household`**. When set to `person`, **`ownerPersonProfileId`** is required; only accounts for that member. When omitted, **all** non-payslip accounts in the household. |

**Response:** JSON with:

- **`asOf`** — date used for the view.
- **`assets`** / **`liabilities`** — arrays of account rows (excludes `payslip` bucket accounts). Each row includes **`financialAccountId`**, **`institution`**, **`accountMask`**, **`type`**, **`currency`**, **`side`** (`asset` \| `liability`), **`balance`**, **`balanceAsOf`**, **`balanceSource`** (`manual` \| `import` \| null), **`importFileId`** (when import-derived). Account type classification: **assets** = `checking`, `savings`, `investment`, `retirement`; **liabilities** = `credit_card`, `loan`, `mortgage`. Accounts with other types (e.g. `payslip`) are excluded. **Liability balances** are stored and displayed as **positive magnitudes** (what you owe); net worth = assets − liabilities.
- **`totals`** — **`assets`**, **`liabilities`**, **`netWorth`** (sums where balances exist; `null` when nothing to sum).

**Resolution (per account):**

Both manual and import snapshots are fetched; the one with the **more recent `as_of_date`** is used. Tie-break (same date) favours **manual** (explicit user entry).

1. Compare latest **manual** `account_balance_snapshot` (`source = 'manual'`, `as_of_date <= asOf`) vs. latest **import** `account_balance_snapshot` (`source = 'import'`, `as_of_date <= asOf`). Pick the one with the later `as_of_date`; if equal, pick manual.
2. If only one source has a row, use it.
3. If neither exists, fall back to the latest **parsed** `import_file` for that account whose `confidence_summary.statementBalances` includes a usable **ending** balance, with `asOfEnd` (when present) not after `asOf` (legacy read path for files not yet snapshotted).

## `GET /reports/balance-sheet/history`

**Query**

| Param | Required | Description |
|--------|----------|-------------|
| `from` | Yes | Start date `YYYY-MM-DD` (inclusive). |
| `to` | Yes | End date `YYYY-MM-DD` (inclusive). |
| `interval` | No | `month` (default), `quarter`, `week`, or `day`. Controls sample dates between `from` and `to`. |
| `ownerScope` | No | Same semantics as **`GET /reports/balance-sheet`**. |
| `ownerPersonProfileId` | When `ownerScope=person` | UUID of **`person_profile`**. |
| `accountIds` | No | Comma-separated list of **`financial_account` UUIDs** (at most **8**). When present, each point includes an **`accounts`** array with per-account **`balance`** / **`balanceAsOf`** for those ids (for chart overlays). |

**Behavior:** Builds a list of sample `asOf` dates (month-end dates per calendar month for `interval=month`; quarter-end dates (Mar 31, Jun 30, Sep 30, Dec 31) for `quarter`; every 7 days from `from` for `week`; every day for `day`). For each date, applies the same per-account resolution as **`GET /reports/balance-sheet`** (including **`ownerScope`** when set). At most **120** sample points; otherwise **`400`** with code **`BALANCE_HISTORY_TOO_MANY_POINTS`**.

**Response:** JSON with **`from`**, **`to`**, **`interval`**, and **`points`**: array of `{ asOf, totals: { assets, liabilities, netWorth }, accounts?: [...] }`. The **`accounts`** field is present only when **`accountIds`** was requested; each entry has **`financialAccountId`**, **`side`**, **`balance`**, **`balanceAsOf`**.

## `POST /reports/balance-sheet/manual`

**Body (JSON)**

| Field | Type | Required |
|--------|------|----------|
| `financialAccountId` | UUID | Yes |
| `asOfDate` | `YYYY-MM-DD` | Yes |
| `amount` | number | Yes |
| `currency` | string | No (default `USD`) |

Creates or updates the **manual** snapshot for `(account, as_of_date)`.

**Errors:** `404 ACCOUNT_NOT_FOUND`, `400 INVALID_ACCOUNT` (payslip bucket).

## `PATCH /reports/balance-sheet/manual/:id`

**Body:** any of `amount`, `currency` (at least one required).

Updates an existing **manual** snapshot owned by the household.
