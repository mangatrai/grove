# Decisions Log (ADR-lite)

## D-001: Base Platform Choice
- Date: 2026-03-23
- Decision: Use `Actual Budget` as the base platform.
- Context: Need modern household UX and budgeting-centric reporting with open-source flexibility.
- Consequence: Avoid rebuilding ledger/reporting core from scratch.

## D-002: Ingestion Strategy
- Date: 2026-03-23
- Decision: Build a custom ingestion pipeline for PDF/CSV/Excel normalization.
- Context: PDF is a primary input, native PDF support in base products is insufficient.
- Consequence: Extra implementation complexity, but critical workflow fit.

## D-003: Privacy and Deployment
- Date: 2026-03-23
- Decision: Self-hosted, LAN-first, air-gapped capable design.
- Context: Financial data sensitivity and user preference.
- Consequence: No dependency on external OCR/AI APIs for core path.

## D-004: Deduplication Policy
- Date: 2026-03-23
- Decision: Strict dedupe by deterministic fingerprint + unresolved queue for ambiguities.
- Context: Duplicate transactions are high-risk and unacceptable.
- Consequence: Conservative posting behavior; possible manual review for edge cases.

## D-005: Review Workflow
- Date: 2026-03-23
- Decision: Single import inbox with bulk actions and resolution queue.
- Context: User rejects per-transaction approval toil.
- Consequence: Requires grid/bulk UX and batched operation support.

## D-006: Transfer Semantics
- Date: 2026-03-23
- Decision: Separate expense recognition from settlement transfer.
- Context: Avoid double-counting credit card and loan payment flows.
- Consequence: Transfer matcher and confidence-based resolution logic required.

## D-007: Data Retention
- Date: 2026-03-23
- Decision: Purge raw PDFs after successful extraction + validation checkpoint.
- Context: Privacy requirements and storage minimization.
- Consequence: Need explicit retention worker and failure-safe behavior.

## D-008: Phase 1 Scope
- Date: 2026-03-23
- Decision: USD-only reporting; India/FX deferred.
- Context: Reduce MVP complexity and time-to-value.
- Consequence: Multi-currency model designed now, enabled later.

## D-009: Build Quality
- Date: 2026-03-23
- Decision: Robustness-first execution (not quick throwaway MVP hacks).
- Context: Financial correctness is critical.
- Consequence: Strong testing and reconciliation gates required before release.

## D-010: Database and Search Strategy
- Date: 2026-03-23
- Decision: Use SQLite (WAL mode) as the system-of-record DB for MVP, with SQLite FTS5 + BM25 for text search.
- Context: Local-first deployment, low user concurrency (2-4 users), air-gapped operation, and portability are higher priority than distributed scale.
- Consequence: Keep repository/search abstractions clean so Postgres or OpenSearch can be added later as optional backends without rewriting domain logic.

## D-011: MVP Defaults for Open Questions
- Date: 2026-03-23
- Decision:
  - Reconciliation mismatches are warn-only in MVP (not finalization-blocking).
  - Category taxonomy starts compact, with modular extension support.
  - First parser profiles prioritized: Bank of America checking, Citi credit cards, Chase credit cards.
  - Low-confidence ownership defaults to household head assignment.
  - Auth remains JWT-only for local deployment.
- Context: Reduce MVP friction while preserving finance correctness and clear operator control.
- Consequence: Faster implementation path with explicit defaults, while keeping extension hooks for stricter policy and richer taxonomy later.

## D-012: Per-Institution Adapters + Single Canonical Ingest Path
- Date: 2026-03-24
- Decision: Split ingestion into (a) **per bank/format adapters** that produce normalized candidate rows, and (b) a **single canonical ingest service** that persists and dedupes. Do not attempt one parser for all institutions. CSV and PDF both use the adapter pattern; differences are isolated in adapter modules with fixture tests.
- Context: Real-world exports (e.g. BoA summary sections, Citi Debit/Credit columns, Chase activity CSV) cannot be mapped reliably by one generic mapping UI alone without high error risk.
- Consequence: Higher upfront adapter count for top institutions, but lower systemic risk and stable core logic. UX includes per-file **financial account** assignment and profile selection/confirmation before parse.

