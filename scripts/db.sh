#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/backend/db/migrations"
SEEDS_DIR="$ROOT_DIR/backend/db/seeds"

DB_PATH="$(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r\n')"

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

mkdir -p "$(dirname "$DB_PATH")"

SEED_FLAG=""
if [[ "$SEED" == "true" ]]; then
  SEED_FLAG="--seed"
fi

echo "Using DB path (matches backend): $DB_PATH"

node "$ROOT_DIR/scripts/db.mjs" \
  --db-path "$DB_PATH" \
  --migrations-dir "$MIGRATIONS_DIR" \
  --seeds-dir "$SEEDS_DIR" \
  $SEED_FLAG

echo "Database ready at: $DB_PATH"
