#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${MODE:-TEST}"
DB_PATH_TEST="${DB_PATH_TEST:-$ROOT_DIR/data/household-finance-test.sqlite}"
DB_PATH_PROD="${DB_PATH_PROD:-$ROOT_DIR/data/household-finance-prod.sqlite}"

if [[ -n "${DB_PATH:-}" ]]; then
  TARGET_DB="$DB_PATH"
elif [[ "$MODE" == "TEST" ]]; then
  TARGET_DB="$DB_PATH_TEST"
elif [[ "$MODE" == "PROD" ]]; then
  TARGET_DB="$DB_PATH_PROD"
else
  echo "Invalid MODE: $MODE (expected TEST or PROD)"
  exit 1
fi

if [[ "${1:-}" != "--yes" ]]; then
  echo "Refusing cleanup without --yes flag."
  echo "Target DB: $TARGET_DB (MODE=$MODE)"
  exit 1
fi

rm -f "$TARGET_DB" "${TARGET_DB}-wal" "${TARGET_DB}-shm"
echo "Cleaned database files for MODE=$MODE at $TARGET_DB"
