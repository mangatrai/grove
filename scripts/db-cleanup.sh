#!/usr/bin/env bash
# Resets Postgres `public` schema, reapplies migrations, then seeds.
# Default: bootstrap + dev sample accounts (same as historical "full dev reset").
# Pass --no-dev-seeds for bootstrap-only (no BOA/Chase/Markus sample accounts).
# Stop the backend first so it does not keep stale connections to dropped objects.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

YES=false
DEV_SEEDS=true
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --no-dev-seeds) DEV_SEEDS=false ;;
  esac
done

if [[ "$YES" != "true" ]]; then
  echo "Refusing cleanup without --yes flag."
  echo "Usage: bash scripts/db-cleanup.sh --yes [--no-dev-seeds]"
  echo "  Drops/recreates public schema on DATABASE_* from .env, then runs migrations + seed."
  echo "  Default reapplies dev seeds (sample financial accounts). Use --no-dev-seeds for bootstrap only."
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
