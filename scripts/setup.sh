#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created .env from .env.example — set JWT_SECRET and DATABASE_* before production use."
  echo "Local Docker Postgres: docker compose up -d  (see docs/RUNBOOK.md)."
fi

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install)

echo "Preparing local directories..."
mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/.runtime/logs" "$ROOT_DIR/.runtime/pids"

if [[ -f "$ROOT_DIR/docker-compose.yml" ]]; then
  echo "Ensure Postgres is running if you use Compose (e.g. docker compose up -d)."
fi

echo "Initializing database schema and seed data (migrations + bootstrap + dev sample accounts)..."
"$ROOT_DIR/scripts/db.sh" --init --seed --dev-seeds

echo "Setup complete. Start the app: npm run start:dev   (or npm run services:start)"
