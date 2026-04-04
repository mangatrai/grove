# Base Platform Decision: Actual Budget vs Firefly III

**Note:** This document records the **strategic choice**. Current product build status lives in **`docs/CHECKPOINT.md`**.

## Recommendation
Choose `Actual Budget` as the base platform, with a custom ingestion/review layer built around PDF/CSV normalization and strict dedupe.

## Why Actual fits this product direction
- Better day-to-day budgeting and modern reporting UX for household use.
- Strong import support for non-PDF formats (OFX/QFX/CSV/QIF/CAMT).
- Open source (MIT), enabling extension/forking.
- Good match for "spending power" style budgeting insights.

## Why custom ingestion is still required
- Native PDF statement/payslip import is not reliable/native in mainstream tools.
- Your workflow is explicitly PDF-heavy and requires air-gapped processing.
- You need strict duplicate controls and bulk review UX tailored to your process.

## Firefly III Trade-off
- Strong ledger discipline and import rules ecosystem.
- But still lacks native PDF path and can be more ops-heavy/complex for your intended household UX.
- Better fit if strict accounting workflows are primary over ease-of-use.

## Decision Matrix

| Criterion | Weight | Actual Budget | Firefly III | Notes |
|---|---:|---:|---:|---|
| Household-friendly UX | High | 9 | 7 | Actual generally simpler for regular usage |
| Budgeting/spending-power fit | High | 9 | 7 | Actual closer to budgeting mental model |
| Ledger/accounting rigor | Medium | 7 | 9 | Firefly stronger accounting-first posture |
| Native PDF ingestion | Critical | 2 | 1 | Both require custom ingestion layer |
| Open-source extensibility | High | 9 | 9 | Both strong |
| Self-host private operation | High | 9 | 9 | Both support |
| Learning curve (family use) | Medium | 8 | 6 | Actual easier for non-accountant users |

## Final Call
Actual Budget is the better base for your priorities:
- monthly decision-making,
- safe-to-spend clarity,
- lower maintenance burden for household usage.

Firefly III remains a fallback option if future requirements shift toward strict accountant-style workflows.

