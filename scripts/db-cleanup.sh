#!/usr/bin/env bash
# Resets Postgres `public` schema, reapplies migrations, then bootstrap seed only.
# Default: wipe + minimal app data (no sample bank accounts).
# Pass --with-dev-seeds to also load dev_0002/dev_0003 (BoA/Citi/Chase/Marcus fixtures).
# Stop the backend first so it does not keep stale connections to dropped objects.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

YES=false
DEV_SEEDS=false
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --with-dev-seeds) DEV_SEEDS=true ;;
    --no-dev-seeds) DEV_SEEDS=false ;;
  esac
done

if [[ "$YES" != "true" ]]; then
  echo "Refusing cleanup without --yes flag."
  echo "Usage: bash scripts/db-cleanup.sh --yes [--with-dev-seeds]"
  echo "  Drops/recreates public schema on DATABASE_* from .env, then migrations + bootstrap seed."
  echo "  Default: bootstrap only. Add --with-dev-seeds for sample financial_account rows."
  exit 1
fi

echo "Resetting Postgres schema (stop the API first if it is running)..."
node "$ROOT_DIR/scripts/preset-pg-test.mjs"
if [[ "$DEV_SEEDS" == "true" ]]; then
  bash "$ROOT_DIR/scripts/db.sh" --init --seed --dev-seeds
else
  bash "$ROOT_DIR/scripts/db.sh" --init --seed
fi
echo "Database reset complete. Restart the API if needed."
