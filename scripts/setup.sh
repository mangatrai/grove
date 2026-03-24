#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install)

echo "Preparing local directories..."
mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/.runtime/logs" "$ROOT_DIR/.runtime/pids"

echo "Initializing database schema and seed data..."
"$ROOT_DIR/scripts/db.sh" --init --seed

echo "Setup complete."
