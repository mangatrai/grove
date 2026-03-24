#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${MODE:-TEST}"
DB_PATH_TEST="${DB_PATH_TEST:-$ROOT_DIR/data/household-finance-test.sqlite}"
DB_PATH_PROD="${DB_PATH_PROD:-$ROOT_DIR/data/household-finance-prod.sqlite}"
MIGRATIONS_DIR="$ROOT_DIR/backend/db/migrations"
SEEDS_DIR="$ROOT_DIR/backend/db/seeds"

if [[ -n "${DB_PATH:-}" ]]; then
  DB_PATH="${DB_PATH}"
elif [[ "$MODE" == "TEST" ]]; then
  DB_PATH="$DB_PATH_TEST"
elif [[ "$MODE" == "PROD" ]]; then
  DB_PATH="$DB_PATH_PROD"
else
  echo "Invalid MODE: $MODE (expected TEST or PROD)"
  exit 1
fi

usage() {
  echo "Usage: scripts/db.sh --init [--seed]"
  exit 1
}

INIT=false
SEED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --init)
      INIT=true
      shift
      ;;
    --seed)
      SEED=true
      shift
      ;;
    *)
      usage
      ;;
  esac
done

if [[ "$INIT" != "true" ]]; then
  usage
fi

mkdir -p "$ROOT_DIR/data"

SEED_FLAG=""
if [[ "$SEED" == "true" ]]; then
  SEED_FLAG="--seed"
fi

node "$ROOT_DIR/scripts/db.mjs" \
  --db-path "$DB_PATH" \
  --migrations-dir "$MIGRATIONS_DIR" \
  --seeds-dir "$SEEDS_DIR" \
  $SEED_FLAG

echo "Database ready at: $DB_PATH"
