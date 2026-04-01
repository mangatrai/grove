# Categorization roadmap (beyond keyword rules)

This complements [`IMPORT_CLASSIFICATION.md`](IMPORT_CLASSIFICATION.md), which describes **what the code does today**. Here we summarize **limits of that approach** and a **practical improvement path** that stays compatible with **self-hosted / air-gapped** deployments (no cloud dependency as a default).

## Current behavior (short)

- **Default bucket:** `classifyDefaultCategory()` in `backend/src/modules/category/category-rules.ts` uses **conservative substring / keyword lists** on **fingerprint-normalized** text (`includesAny`), not a general regex engine for the default path.
- **DB rules** (`/categories/rules`): match modes include `contains`, `prefix`, and `regex` — only those rows are “regex-capable.”
- **“Needs review”** is **not** only “unknown category.” It aggregates uncategorized rows, non-posted items, **near-duplicate**, **transfer ambiguity**, **reconciliation mismatch**, and similar (`NEEDS_REVIEW_PREDICATE` in `backend/src/modules/ledger/ledger.service.ts`). When many rows sit in review, **break down by resolution type** before attributing the mix to classification alone.

## Limits of keyword-only defaults

- New merchants and wording variants miss until a rule exists.
- Typos and bank-specific suffix noise are brittle without fuzzy matching.
- Regex in DB rules is powerful but **manual** and easy to overfit without tests.

## Suggested tiers (air-gap friendly)

| Tier | Idea | Notes |
|------|------|--------|
| **A — User / household memory** | After a user assigns a category to a **normalized merchant** (or fingerprint), persist and reuse on future imports (e.g. SQLite keyed by household + normalized key). | High ROI, no ML, strong privacy. |
| **B — Fuzzy string similarity** | Match normalized description to known labels or past assignments (e.g. RapidFuzz in Python pipelines, or a TS equivalent for in-app logic). | Helps typos and noisy suffixes; complements keywords. |
| **C — Lightweight ML (optional)** | Offline training: TF–IDF + simple classifier on user-labeled rows, or a small local model. | Heavier: data volume, maintenance, reproducibility. |
| **D — External / cloud LLM** | Only where policy allows. | Conflicts with strict air-gap unless **local** inference (e.g. Ollama). Not a default. |

## Non-goals (for this product direction)

- **No requirement** for cloud APIs or third-party categorization services.
- **No** mandatory ML stack for core import flows; tiers B–D are optional phases.

## Related docs

- [`IMPORT_CLASSIFICATION.md`](IMPORT_CLASSIFICATION.md) — ingest order, dedupe, transfers, rules
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — broader system context
