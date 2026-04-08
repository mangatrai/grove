# AI transaction categorization (removed)

The optional **OpenAI batch categorization** pass that ran after deterministic rules (`AI_CATEGORY_ENABLED`, `category-ai.service.ts`) has been **removed**. It duplicated cost and complexity relative to rules-first classification.

**Current behavior:** [`canonical-ingest.service.ts`](../backend/src/modules/canonical/canonical-ingest.service.ts) applies **household `category_rule` rows and built-in keyword rules** only. Rows that still have no category are inserted with `category_id` null and an `unknown_category` resolution item—no model suggestions.

See [`IMPORT_CLASSIFICATION.md`](IMPORT_CLASSIFICATION.md) for how rules are applied.
