#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: scripts/db.sh --init [--seed] [--dev-seeds]"
  echo "  Applies backend/db/migrations and optional backend/db/seeds (Postgres)."
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

ARGS=(--init)
if [[ "$SEED" == "true" ]]; then
  ARGS+=(--seed)
fi
if [[ "$DEV_SEEDS" == "true" ]]; then
  ARGS+=(--dev-seeds)
fi

node "$ROOT_DIR/scripts/db-pg.mjs" "${ARGS[@]}"
