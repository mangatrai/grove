#!/usr/bin/env bash
# Remove SQLite files for the test DB path (same resolution as backend when MODE=TEST and DB_PATH unset).
# Each `npm run test -w backend` starts from a clean DB (avoids dedupe collisions from prior runs).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MODE=TEST
unset DB_PATH
TARGET_DB="$(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r\n')"
rm -f "$TARGET_DB" "${TARGET_DB}-wal" "${TARGET_DB}-shm"
node "$ROOT_DIR/scripts/clean-import-session-dirs.mjs"
