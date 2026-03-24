#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"
LOG_DIR="$ROOT_DIR/.runtime/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# Dev ports (match .env.example). Do not `source` the whole .env (secrets may break bash).
read_env_port() {
  local key="$1" default="$2"
  local f="$ROOT_DIR/.env"
  [[ -f "$f" ]] || {
    echo "$default"
    return
  }
  local line
  line=$(grep -E "^${key}=" "$f" 2>/dev/null | tail -1) || {
    echo "$default"
    return
  }
  local val="${line#*=}"
  val="${val%$'\r'}"
  val="${val//\"/}"
  [[ -n "$val" ]] && echo "$val" || echo "$default"
}
_env_fe="$(read_env_port FRONTEND_PORT 3000)"
_env_be="$(read_env_port PORT 4000)"
FRONTEND_PORT="${FRONTEND_PORT:-$_env_fe}"
BACKEND_PORT="${PORT:-$_env_be}"

usage() {
  echo "Usage: scripts/services.sh --start|--stop|--status"
  exit 1
}

is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

# Kill descendants first, then PID (best-effort graceful shutdown).
kill_process_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  local child
  # shellcheck disable=SC2046
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_process_tree "$child"
  done
  if is_running "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# Stray Vite/node often reparents to launchd and is NOT under our bash PID — still holds :3000 / :4000.
# Kill whatever is in LISTEN state on this TCP port (dev defaults for this repo only).
kill_tcp_listener_pids() {
  local port="$1"
  local p
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  for p in $pids; do
    kill -TERM "$p" 2>/dev/null || true
  done
  sleep 0.25
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  for p in $pids; do
    kill -KILL "$p" 2>/dev/null || true
  done
}

warn_if_port_busy() {
  local port="$1"
  local role="$2"
  if [[ -n "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)" ]]; then
    echo "Warning: $role port $port is already in use — $role may fail to start until you stop the other listener (try: npm run services:stop)."
  fi
}

start_service() {
  local name="$1"
  local command="$2"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if is_running "$existing_pid"; then
      echo "$name already running (pid $existing_pid)"
      return
    fi
    rm -f "$pid_file"
  fi

  nohup bash -lc "cd \"$ROOT_DIR\" && $command" >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"
  echo "Started $name (pid $pid)"
}

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name not running"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  if is_running "$pid"; then
    kill_process_tree "$pid"
    echo "Stopped $name (root pid $pid)"
  else
    echo "$name pid file found but process already stopped"
  fi
  rm -f "$pid_file"
}

status_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo "$name: stopped"
    return
  fi
  local pid
  pid="$(cat "$pid_file")"
  if is_running "$pid"; then
    echo "$name: running (pid $pid)"
  else
    echo "$name: stale pid file (pid $pid)"
  fi
}

ACTION="${1:-}"
case "$ACTION" in
  --start)
    warn_if_port_busy "$BACKEND_PORT" "Backend"
    warn_if_port_busy "$FRONTEND_PORT" "Frontend"
    start_service "backend" "npm run dev -w backend"
    start_service "frontend" "npm run dev -w frontend"
    ;;
  --stop)
    stop_service "frontend"
    stop_service "backend"
    echo "Freeing dev ports (clears stray node/vite not parented under the wrapper PID)…"
    kill_tcp_listener_pids "$FRONTEND_PORT"
    kill_tcp_listener_pids "$BACKEND_PORT"
    ;;
  --status)
    status_service "backend"
    status_service "frontend"
    ;;
  *)
    usage
    ;;
esac
