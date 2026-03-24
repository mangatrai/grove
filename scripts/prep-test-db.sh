#!/usr/bin/env bash
# Remove test SQLite files so each `npm run test -w backend` starts from a clean DB
# (avoids fingerprint dedupe seeing rows from previous runs).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH_TEST="${DB_PATH_TEST:-$ROOT_DIR/data/household-finance-test.sqlite}"
rm -f "$DB_PATH_TEST" "${DB_PATH_TEST}-wal" "${DB_PATH_TEST}-shm"
# Drop session staging dirs from prior test runs (UUID folders only; keeps data/imports/custom).
node "$ROOT_DIR/scripts/clean-import-session-dirs.mjs"
