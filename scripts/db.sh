#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/backend/db/migrations"
SEEDS_DIR="$ROOT_DIR/backend/db/seeds"

DB_PATH="$(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r\n')"

usage() {
  echo "Usage: scripts/db.sh --init [--seed] [--dev-seeds]"
  echo "  --seed        Apply backend/db/seeds/*.sql (household, owner user, global categories)."
  echo "  --dev-seeds   Also apply backend/db/seeds/dev/*.sql (sample financial_account rows)."
  exit 1
}

INIT=false
SEED=false
DEV_SEEDS=false

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
    --dev-seeds)
      DEV_SEEDS=true
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

mkdir -p "$(dirname "$DB_PATH")"

SEED_FLAG=""
if [[ "$SEED" == "true" ]]; then
  SEED_FLAG="--seed"
fi
DEV_SEEDS_FLAG=""
if [[ "$DEV_SEEDS" == "true" ]]; then
  DEV_SEEDS_FLAG="--dev-seeds"
fi

echo "Using DB path (matches backend): $DB_PATH"

node "$ROOT_DIR/scripts/db.mjs" \
  --db-path "$DB_PATH" \
  --migrations-dir "$MIGRATIONS_DIR" \
  --seeds-dir "$SEEDS_DIR" \
  $SEED_FLAG \
  $DEV_SEEDS_FLAG

echo "Database ready at: $DB_PATH"
