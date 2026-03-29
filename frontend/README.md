# Household Finance — Web UI

Vite + React + TypeScript app for **Epic 2.3 Import UI**: sign-in on **`/`** (guest landing), create import
sessions, upload files, bind each file to an account + parser profile, parse,
and canonicalize.

## Dev

Requires the API on **port 4000** (default backend). The Vite dev server proxies:

- `/auth`, `/categories`, `/imports`, `/transactions`, `/resolution`, `/reports`, `/health` → `http://127.0.0.1:4000`

If you add a new API top-level path, add it here or the browser will get HTML instead of JSON.

**Layout:** Signed-in users get **`ShellLayout`** — **collapsible left sidebar** (`src/layout/AppSidebar.tsx`) with **Home**, **Transactions**, **Categories**, **Review queue**; **top bar** (`src/layout/AppTopBar.tsx`) with **New import** and **Account** menu (**Settings** → `/settings`, **Sign out**). Mobile: hamburger opens the sidebar drawer with backdrop. Guests at **`/`** see a **landing + sign-in** hero (no chrome; same route as dashboard after JWT). **`/login`** redirects to **`/`**. **`RequireAuth`** wraps categories, transactions, resolution, import workspace, and **settings** (home dashboard uses JWT in `HomeRoute`).

Override the proxy target:

```bash
VITE_PROXY_API=http://127.0.0.1:4000 npm run dev
```

Default dev server port **3000** (override with `FRONTEND_PORT`).

From repo root:

```bash
npm run dev:frontend
```

Run the backend in another terminal (`npm run dev` or `npm run dev:backend`), or use
`npm run services:start` to start backend + frontend in the background (see root README).

## Build

```bash
npm run build -w frontend
```

Output: `frontend/dist/`.

## Routes

- `/` — **Home:** cash dashboard when signed in (`GET /reports/cash-summary` + category UI); sign-in prompt when logged out. **`/dashboard`** redirects here.
- `/categories` — Manage household categories (POST/PATCH/DELETE) and browse the global + household taxonomy. **`/categories/rules`** — household classification rules (`GET/POST/PATCH /categories/rules`); link from Categories.
- `/transactions` — Ledger hub; query `sessionId`, `needsReview`, `search`, `accountId`, `categoryId`, `uncategorizedOnly`, `dateFrom`, `dateTo`, `amountMin`, `amountMax` (see `docs/API_LEDGER.md`).
- `/imports/:sessionId` — Import workspace + **Session processing summary** (raw vs ledger per file); start via **New import** in the header (no Import nav item).
- `/resolution` — **Review queue** (`GET /resolution`, `PATCH /resolution/:id`, `POST /resolution/bulk` for bulk status, **`POST /resolution/bulk-apply-category`** for bulk category on `unknown_category` rows)

## Import UX

- Files **upload as soon as you pick them** (no separate Upload click).
- Parser profile is **inferred from account + file extension** (e.g. Bank of America checking/savings CSV share one format — the UI uses a single profile id; legacy `boa_savings_csv` is treated as equivalent).
- **Parser override** is under a disclosure for edge cases (e.g. generic tabular).
- **Run import** runs parse + canonicalize in one action; separate steps stay under “Separate steps”.
- After the session moves to **review** (parsed), **new file uploads are not offered**; user is steered to **Start another import session** (same account/date/amount review inside one session is future work).
- Duplicate uploads in the same session are **skipped** (not a hard error); other files in the batch still upload.
- Manual parser/format selection: add **`?advanced=1`** to the import URL (intended for support & debugging).
- Account labels use **`account_mask`** from the API; store **last four digits** there for `****1234`-style display.

## Auth token

JWT is stored in `localStorage` under key `hf_jwt` after login.
