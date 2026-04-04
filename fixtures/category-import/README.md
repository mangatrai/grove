# Category and household-rule CSV samples

These files are **templates** for bootstrapping a new instance or editing rules in bulk. They are safe to commit (no secrets).

| File | Purpose |
|------|---------|
| `categories.csv` | Two columns: `Parent group`, `Category` — household category rows the UI/API accept for bulk category creation (match your install’s taxonomy names). |
| `category-rules-house.csv` | Household classification rules: `pattern`, `match_type`, `amount_scope`, `category_path` (or `category_id`), `priority`, `confidence`, `enabled`, etc. Align headers with the Category Rules page CSV export. |

**Where to use them:** Import from **Category rules** (household CSV) or category management flows in the app as documented in [`docs/USER_GUIDE.md`](../../docs/USER_GUIDE.md).

**Note:** Runtime import **staging** still lives under `data/imports/<sessionId>/` (gitignored). Only this `fixtures/` copy is tracked in git.
