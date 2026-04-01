#!/usr/bin/env bash
# Deletes the same SQLite file the backend uses (see scripts/print-db-path.mjs).
# If the API still has the DB open, Unix/macOS will keep serving the OLD data from the
# unlinked inode until the process exits — so we refuse cleanup unless nothing holds the file.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--yes" ]]; then
  echo "Refusing cleanup without --yes flag."
  echo "Resolved DB path (same as backend): $(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r')"
  exit 1
fi

TARGET_DB="$(node "$ROOT_DIR/scripts/print-db-path.mjs" | tr -d '\r\n')"
echo "Target database: $TARGET_DB"

if [[ -f "$TARGET_DB" ]] && [[ -z "${DB_CLEANUP_ALLOW_OPEN:-}" ]]; then
  if command -v lsof >/dev/null 2>&1; then
    if lsof "$TARGET_DB" 2>/dev/null | grep -q .; then
      echo ""
      echo "ERROR: A process still has this database open (usually the API)."
      echo "The file cannot be fully removed while it is open — you would still see old data until the server stops."
      echo ""
      lsof "$TARGET_DB" 2>/dev/null || true
      echo ""
      echo "Fix: stop the backend first, then run cleanup again:"
      echo "  npm run services:stop"
      echo "  npm run db:cleanup"
      echo ""
      echo "Then recreate schema + seeds if needed:"
      echo "  npm run db:seed          # household + user + categories only"
      echo "  npm run db:seed:dev      # also sample bank accounts (local dev)"
      echo "  npm run services:start"
      echo ""
      echo "Dangerous override (you must restart the API afterward): DB_CLEANUP_ALLOW_OPEN=1 npm run db:cleanup"
      exit 1
    fi
  else
    echo "Warning: lsof not available — cannot detect open handles. Stop the API before cleanup if rows still appear afterward."
  fi
fi

echo "Removing SQLite files..."
rm -f "$TARGET_DB" "${TARGET_DB}-wal" "${TARGET_DB}-shm"
echo "Cleaned database files at $TARGET_DB"
echo "Start the API again. Run npm run db:seed (or db:seed:dev for sample accounts) after a fresh file."
