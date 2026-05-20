#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${STITCHLY_STATE_DIR:-$ROOT_DIR/.stitchly}"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"

BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.log"

BACKEND_HTTP_URL="${STITCHLY_BACKEND_HTTP_URL:-http://127.0.0.1:3000}"
UI_HTTP_URL="${STITCHLY_UI_HTTP_URL:-http://127.0.0.1:5173}"
BACKEND_BIND_ADDR="${STITCHLY_SERVER_ADDR:-127.0.0.1:3000}"
UI_BIND_HOST="${STITCHLY_UI_HOST:-127.0.0.1}"
UI_PORT="${STITCHLY_UI_PORT:-5173}"

mkdir -p "$PID_DIR" "$LOG_DIR"

usage() {
  cat <<'EOF'
Usage:
  scripts/dev_ui_agent.sh up [--no-open]
  scripts/dev_ui_agent.sh down
  scripts/dev_ui_agent.sh status
  scripts/dev_ui_agent.sh open

Environment overrides:
  STITCHLY_SERVER_ADDR       Backend bind address. Default: 127.0.0.1:3000
  STITCHLY_BACKEND_HTTP_URL  Backend HTTP URL for health checks. Default: http://127.0.0.1:3000
  STITCHLY_UI_HOST           Frontend bind host. Default: 127.0.0.1
  STITCHLY_UI_PORT           Frontend port. Default: 5173
  STITCHLY_UI_HTTP_URL       Frontend URL for health checks and browser open. Default: http://127.0.0.1:5173
EOF
}

read_pid() {
  local pid_file="$1"

  if [[ -f "$pid_file" ]]; then
    tr -d '[:space:]' < "$pid_file"
  fi
}

pid_is_running() {
  local pid="$1"

  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

clear_stale_pid_file() {
  local pid_file="$1"
  local pid

  pid="$(read_pid "$pid_file")"
  if [[ -n "$pid" ]] && ! pid_is_running "$pid"; then
    rm -f "$pid_file"
  fi
}

backend_ready() {
  curl -fsS "$BACKEND_HTTP_URL/api/node-definitions" 2>/dev/null | grep -q '"node_definitions"'
}

frontend_ready() {
  curl -fsS "$UI_HTTP_URL" 2>/dev/null | grep -qi '<title>Stitchly</title>'
}

wait_for_ready() {
  local label="$1"
  local check_fn="$2"
  local log_file="$3"
  local pid_file="${4:-}"
  local attempts="${5:-60}"
  local count=0

  until "$check_fn"; do
    if [[ -n "$pid_file" ]]; then
      local tracked_pid
      tracked_pid="$(read_pid "$pid_file")"
      if [[ -n "$tracked_pid" ]] && ! pid_is_running "$tracked_pid"; then
        echo "$label process exited before it became ready."
        if [[ -f "$log_file" ]]; then
          echo
          echo "Last lines from $log_file:"
          tail -n 40 "$log_file" || true
        fi
        return 1
      fi
    fi

    count=$((count + 1))
    if (( count >= attempts )); then
      echo "$label did not become ready in time."
      if [[ -f "$log_file" ]]; then
        echo
        echo "Last lines from $log_file:"
        tail -n 40 "$log_file" || true
      fi
      return 1
    fi
    sleep 1
  done
}

start_backend() {
  clear_stale_pid_file "$BACKEND_PID_FILE"

  if backend_ready; then
    echo "Backend already available at $BACKEND_HTTP_URL"
    return 0
  fi

  local existing_pid
  existing_pid="$(read_pid "$BACKEND_PID_FILE")"
  if pid_is_running "$existing_pid"; then
    echo "Waiting for existing backend process $existing_pid to become ready..."
    wait_for_ready "Backend" backend_ready "$BACKEND_LOG_FILE" "$BACKEND_PID_FILE"
    return 0
  fi

  echo "Starting backend on $BACKEND_BIND_ADDR"
  (
    cd "$ROOT_DIR"
    nohup env STITCHLY_SERVER_ADDR="$BACKEND_BIND_ADDR" cargo run -p runtime_server --bin stitchly-server \
      >"$BACKEND_LOG_FILE" 2>&1 < /dev/null &
    echo $! >"$BACKEND_PID_FILE"
  )

  wait_for_ready "Backend" backend_ready "$BACKEND_LOG_FILE" "$BACKEND_PID_FILE"
}

start_frontend() {
  clear_stale_pid_file "$FRONTEND_PID_FILE"

  if frontend_ready; then
    echo "Frontend already available at $UI_HTTP_URL"
    return 0
  fi

  local existing_pid
  existing_pid="$(read_pid "$FRONTEND_PID_FILE")"
  if pid_is_running "$existing_pid"; then
    echo "Waiting for existing frontend process $existing_pid to become ready..."
    wait_for_ready "Frontend" frontend_ready "$FRONTEND_LOG_FILE" "$FRONTEND_PID_FILE"
    return 0
  fi

  echo "Starting frontend on $UI_BIND_HOST:$UI_PORT"
  (
    cd "$ROOT_DIR"
    nohup env STITCHLY_API_PROXY="$BACKEND_HTTP_URL" corepack pnpm --dir apps/web dev --host "$UI_BIND_HOST" --port "$UI_PORT" --strictPort \
      >"$FRONTEND_LOG_FILE" 2>&1 < /dev/null &
    echo $! >"$FRONTEND_PID_FILE"
  )

  wait_for_ready "Frontend" frontend_ready "$FRONTEND_LOG_FILE" "$FRONTEND_PID_FILE"
}

open_ui() {
  if ! frontend_ready; then
    echo "Frontend is not reachable at $UI_HTTP_URL yet."
    return 1
  fi

  if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    nohup xdg-open "$UI_HTTP_URL" >/dev/null 2>&1 &
    echo "Opened $UI_HTTP_URL via xdg-open"
    return 0
  fi

  if command -v open >/dev/null 2>&1 && [[ "$(uname)" == "Darwin" ]]; then
    nohup open "$UI_HTTP_URL" >/dev/null 2>&1 &
    echo "Opened $UI_HTTP_URL via open"
    return 0
  fi

  if command -v wslview >/dev/null 2>&1; then
    nohup wslview "$UI_HTTP_URL" >/dev/null 2>&1 &
    echo "Opened $UI_HTTP_URL via wslview"
    return 0
  fi

  echo "Could not auto-open the UI from this environment."
  echo "Open this URL manually: $UI_HTTP_URL"
}

stop_process() {
  local label="$1"
  local pid_file="$2"
  local pid

  clear_stale_pid_file "$pid_file"
  pid="$(read_pid "$pid_file")"

  if ! pid_is_running "$pid"; then
    rm -f "$pid_file"
    echo "$label is not running."
    return 0
  fi

  echo "Stopping $label process $pid"
  kill "$pid" 2>/dev/null || true

  local count=0
  while pid_is_running "$pid"; do
    count=$((count + 1))
    if (( count >= 10 )); then
      echo "Force stopping $label process $pid"
      kill -9 "$pid" 2>/dev/null || true
      break
    fi
    sleep 1
  done

  rm -f "$pid_file"
}

show_status() {
  clear_stale_pid_file "$BACKEND_PID_FILE"
  clear_stale_pid_file "$FRONTEND_PID_FILE"

  local backend_pid frontend_pid
  backend_pid="$(read_pid "$BACKEND_PID_FILE")"
  frontend_pid="$(read_pid "$FRONTEND_PID_FILE")"

  echo "Backend:"
  if backend_ready; then
    echo "  status: ready"
    echo "  url:    $BACKEND_HTTP_URL"
  elif pid_is_running "$backend_pid"; then
    echo "  status: starting"
    echo "  pid:    $backend_pid"
  else
    echo "  status: stopped"
  fi
  echo "  log:    $BACKEND_LOG_FILE"

  echo
  echo "Frontend:"
  if frontend_ready; then
    echo "  status: ready"
    echo "  url:    $UI_HTTP_URL"
  elif pid_is_running "$frontend_pid"; then
    echo "  status: starting"
    echo "  pid:    $frontend_pid"
  else
    echo "  status: stopped"
  fi
  echo "  log:    $FRONTEND_LOG_FILE"
}

start_agent() {
  local should_open=1

  for arg in "$@"; do
    if [[ "$arg" == "--no-open" ]]; then
      should_open=0
    fi
  done

  start_backend
  start_frontend

  echo
  echo "Stitchly UI is ready at $UI_HTTP_URL"
  echo "Backend API is ready at $BACKEND_HTTP_URL"
  echo "Logs:"
  echo "  backend:  $BACKEND_LOG_FILE"
  echo "  frontend: $FRONTEND_LOG_FILE"

  if (( should_open == 1 )); then
    echo
    open_ui || true
  fi
}

main() {
  local command="${1:-up}"

  case "$command" in
    up)
      shift || true
      start_agent "$@"
      ;;
    down)
      stop_process "frontend" "$FRONTEND_PID_FILE"
      stop_process "backend" "$BACKEND_PID_FILE"
      ;;
    status)
      show_status
      ;;
    open)
      open_ui
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
