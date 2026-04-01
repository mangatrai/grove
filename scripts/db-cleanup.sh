#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--yes" ]]; then
  echo "Refusing cleanup without --yes flag."
  echo "Resolved DB path (same as backend): $(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r')"
  exit 1
fi

TARGET_DB="$(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r\n')"
echo "Removing SQLite files for the same path the API uses: $TARGET_DB"

rm -f "$TARGET_DB" "${TARGET_DB}-wal" "${TARGET_DB}-shm"
echo "Cleaned database files at $TARGET_DB"
