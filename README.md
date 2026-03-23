# Household Finance App

Private, self-hosted household finance platform with a strict correctness-first
ingestion pipeline.

## Monorepo Layout

- `docs/`: product and architecture documents.
- `backend/`: API, domain model, migrations, auth/RBAC baseline.
- `frontend/`: web app scaffold placeholder.

## Quick Start

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
2. Install dependencies:
   - `npm install`
3. Run development backend:
   - `npm run dev`

## Current Implementation Scope

Initial implementation covers Epic 1 scaffolding:

- Workspace bootstrap with backend/frontend packages.
- Baseline lint/test scripts.
- SQL migration + seed files for core domain schema.
- Local auth + RBAC baseline in backend API.

