#!/usr/bin/env bash
# Reset Postgres test schema and re-apply migrations + seeds (matches backend npm test).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MODE=TEST
node "$ROOT_DIR/scripts/preset-pg-test.mjs"
node "$ROOT_DIR/scripts/clean-import-session-dirs.mjs"
