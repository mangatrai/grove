# GitHub tracking issues (maintainers)

Use this checklist when updating open tracking issues (Postgres/Koyeb, OpenAPI, parser, AI categorization).

## Done in repo

- **Environment:** See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) for `OPENAI_*` (payslip LLM), transfer thresholds, and DB path behavior.
- **BoA `stmt.csv` / parser loss:** BoA checking/savings CSV uses a **tail-based line parser** (`parseBoaLineFromTail` in `backend/src/modules/imports/profiles/boa-checking-savings-csv.ts`) so quoted amounts and Zelle/IBM lines are not dropped after the first strict `csv-parse` failure. Regression: `backend/tests/boa-parser.test.ts` (full `data/imports/custom/stmt.csv` when present). Per-file diagnostics remain in import `confidence_summary` → `parserDiagnostics.boaCsv` (see `session-summary.service.ts`).
- **Logging:** API logs go to **stdout/stderr** only; no rotating log files (see `ENVIRONMENT_VARIABLES.md` and `RUNBOOK.md`).

## Paste into an issue (template)

```
Done in repo (update commit range after merge):
- Env reference: docs/ENVIRONMENT_VARIABLES.md
- Parser: boa-checking-savings-csv.ts + session-summary parserDiagnostics; stmt.csv covered by backend/tests/boa-parser.test.ts
- OpenAI: payslip LLM import uses OPENAI_API_KEY when configured
```

Close or mark **Verified** only after you confirm behavior in your environment (import + canonicalize for parser; `.env` for AI).
