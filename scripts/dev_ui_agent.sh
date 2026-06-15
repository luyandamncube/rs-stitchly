#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${STITCHLY_STATE_DIR:-$ROOT_DIR/.stitchly}"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
DOLT_HOME_DIR="$STATE_DIR/tooling/dolt-home"
CARGO_BUILD_LOCK_FILE="$ROOT_DIR/target/debug/.cargo-lock"

BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.log"

BACKEND_HTTP_URL="${STITCHLY_BACKEND_HTTP_URL:-http://127.0.0.1:3000}"
UI_HTTP_URL="${STITCHLY_UI_HTTP_URL:-http://127.0.0.1:5173}"
BACKEND_BIND_ADDR="${STITCHLY_SERVER_ADDR:-127.0.0.1:3000}"
UI_BIND_HOST="${STITCHLY_UI_HOST:-127.0.0.1}"
UI_PORT="${STITCHLY_UI_PORT:-5173}"
BACKEND_ENV_FILE="$ROOT_DIR/.env.server"
AUTO_INSTALL_PREREQS="${STITCHLY_AUTO_INSTALL_PREREQS:-1}"
DOLT_LINUX_INSTALL_URL="${STITCHLY_DOLT_LINUX_INSTALL_URL:-https://github.com/dolthub/dolt/releases/latest/download/install.sh}"
NVM_INSTALL_URL="${STITCHLY_NVM_INSTALL_URL:-https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh}"

# Rust build defaults.
# These mirror the WSL-safe command that successfully compiled the backend:
#   CARGO_BUILD_JOBS=1 cargo +nightly -Znext-lockfile-bump build -j 1 -p runtime_server --bin stitchly-server
CARGO_BUILD_JOBS="${STITCHLY_CARGO_BUILD_JOBS:-1}"
CARGO_TOOLCHAIN="${STITCHLY_CARGO_TOOLCHAIN:-nightly}"
CARGO_USE_NEXT_LOCKFILE_BUMP="${STITCHLY_CARGO_USE_NEXT_LOCKFILE_BUMP:-1}"
MIN_NODE_MAJOR="${STITCHLY_MIN_NODE_MAJOR:-18}"

if [[ -f "$BACKEND_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_ENV_FILE"
  set +a
fi

VERBOSE="${STITCHLY_VERBOSE:-0}"
TRACE="${STITCHLY_TRACE:-0}"
VERBOSE_HEARTBEAT_SECONDS="${STITCHLY_VERBOSE_HEARTBEAT_SECONDS:-60}"

for raw_arg in "$@"; do
  case "$raw_arg" in
    --verbose)
      VERBOSE=1
      ;;
    --trace)
      TRACE=1
      VERBOSE=1
      ;;
  esac
done

if [[ "$TRACE" != "0" ]]; then
  set -x
fi

mkdir -p "$PID_DIR" "$LOG_DIR" "$DOLT_HOME_DIR"

usage() {
  cat <<'EOF'
Usage:
  scripts/dev_ui_agent.sh up [--no-open] [--verbose] [--trace]
  scripts/dev_ui_agent.sh restart [--no-open] [--verbose] [--trace]
  scripts/dev_ui_agent.sh down
  scripts/dev_ui_agent.sh status
  scripts/dev_ui_agent.sh open

Environment overrides:
  STITCHLY_SERVER_ADDR       Backend bind address. Default: 127.0.0.1:3000
  STITCHLY_BACKEND_HTTP_URL  Backend HTTP URL for health checks. Default: http://127.0.0.1:3000
  STITCHLY_UI_HOST           Frontend bind host. Default: 127.0.0.1
  STITCHLY_UI_PORT           Frontend port. Default: 5173
  STITCHLY_UI_HTTP_URL       Frontend URL for health checks and browser open. Default: http://127.0.0.1:5173
  STITCHLY_AUTO_INSTALL_PREREQS
                             Best-effort install missing Unix prerequisites before startup.
                             Installs curl, lsof, Node/npm via nvm, corepack, Rust/Cargo, and dolt where supported.
                             Default: 1
  STITCHLY_VERBOSE           Stream startup progress and backend build output to the terminal.
                             Default: 0
  STITCHLY_TRACE             Enable shell tracing (set -x). Implies STITCHLY_VERBOSE=1.
                             Default: 0
  STITCHLY_VERBOSE_HEARTBEAT_SECONDS
                             Verbose heartbeat interval, in seconds, for long-running steps.
                             Default: 60
  STITCHLY_DOLT_LINUX_INSTALL_URL
                             Override the official Dolt Linux install script URL.
  STITCHLY_NVM_INSTALL_URL
                             Override the official nvm install script URL.
  STITCHLY_CARGO_BUILD_JOBS
                             Cargo parallel build jobs. Default: 1
  STITCHLY_CARGO_TOOLCHAIN
                             Rust toolchain used for backend build. Default: nightly
  STITCHLY_CARGO_USE_NEXT_LOCKFILE_BUMP
                             Use -Znext-lockfile-bump for Cargo.lock v4. Default: 1
  STITCHLY_MIN_NODE_MAJOR
                             Minimum Node.js major version for frontend tooling. Default: 18
EOF
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

auto_install_enabled() {
  [[ "$AUTO_INSTALL_PREREQS" != "0" ]]
}

verbose_enabled() {
  [[ "$VERBOSE" != "0" ]]
}

log_verbose() {
  if verbose_enabled; then
    echo "[verbose] $*"
  fi
}

node_major_version() {
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null
}

source_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    return 0
  fi

  return 1
}

install_node_lts_with_nvm() {
  if ! command_exists curl; then
    install_unix_package curl
  fi

  if ! source_nvm; then
    echo "Installing nvm..."
    curl -o- "$NVM_INSTALL_URL" | bash
    if ! source_nvm; then
      echo "nvm was installed but could not be loaded in this shell."
      echo "Open a new shell or source ~/.nvm/nvm.sh, then rerun this script."
      return 1
    fi
  fi

  if ! declare -F nvm >/dev/null 2>&1; then
    echo "nvm was installed but could not be loaded in this shell."
    echo "Open a new shell or source ~/.nvm/nvm.sh, then rerun this script."
    return 1
  fi

  echo "Installing Node.js LTS with nvm..."
  nvm install --lts
  nvm use --lts
  nvm alias default 'lts/*' >/dev/null 2>&1 || true
  hash -r 2>/dev/null || true

  command_exists node && command_exists npm
}

ensure_node_version() {
  local node_version
  local node_major

  node_version="$(node --version 2>/dev/null || true)"
  node_major="$(node_major_version || true)"

  if [[ -z "$node_major" || ! "$node_major" =~ ^[0-9]+$ ]]; then
    echo "Could not determine Node.js version."
    if auto_install_enabled; then
      echo "Attempting to install Node.js LTS with nvm..."
      install_node_lts_with_nvm
      node_major="$(node_major_version || true)"
      node_version="$(node --version 2>/dev/null || true)"
    fi

    if [[ -z "$node_major" || ! "$node_major" =~ ^[0-9]+$ ]]; then
      echo "Install Node.js $MIN_NODE_MAJOR or newer, then rerun this script."
      return 1
    fi
  fi

  if (( node_major < MIN_NODE_MAJOR )); then
    echo "Node.js $node_version is too old for this frontend toolchain."
    echo "Corepack and Vite require Node.js $MIN_NODE_MAJOR or newer."
    echo
    if auto_install_enabled; then
      echo "Attempting to install Node.js LTS with nvm..."
      install_node_lts_with_nvm
      node_major="$(node_major_version || true)"
      node_version="$(node --version 2>/dev/null || true)"
    fi

    if [[ -z "$node_major" || ! "$node_major" =~ ^[0-9]+$ || "$node_major" -lt "$MIN_NODE_MAJOR" ]]; then
      echo "Install a newer Node.js in this environment, then rerun this script."
      echo "Recommended options:"
      echo "  nvm install --lts && nvm use --lts"
      echo "  or install Node.js from https://nodejs.org/"
      return 1
    fi
  fi

  if verbose_enabled; then
    echo "[verbose] Node: $node_version"
  fi
}

ensure_corepack_available() {
  local corepack_version

  set +e
  corepack_version="$(corepack --version 2>&1)"
  local status=$?
  set -e

  if (( status != 0 )); then
    echo "Corepack is installed but cannot run with the current Node.js runtime."
    echo
    echo "$corepack_version"
    echo
    echo "Install Node.js $MIN_NODE_MAJOR or newer, then rerun this script."
    return "$status"
  fi

  if verbose_enabled; then
    echo "[verbose] Corepack: $corepack_version"
  fi
}

ensure_writable_dir() {
  local dir="$1"

  mkdir -p "$dir"

  if [[ ! -w "$dir" ]]; then
    echo "Directory is not writable: $dir"
    echo
    echo "Fix ownership from the repo root with:"
    echo "  sudo chown -R \"\$(id -u):\$(id -g)\" \"$STATE_DIR\""
    return 1
  fi
}

prepare_log_file() {
  local log_file="$1"
  local log_dir

  log_dir="$(dirname "$log_file")"
  ensure_writable_dir "$log_dir"

  if [[ -e "$log_file" && ! -w "$log_file" ]]; then
    echo "Log file is not writable: $log_file"
    echo
    echo "Fix ownership from the repo root with:"
    echo "  sudo chown -R \"\$(id -u):\$(id -g)\" \"$STATE_DIR\""
    return 1
  fi

  : >"$log_file"
}

ensure_state_paths_writable() {
  ensure_writable_dir "$PID_DIR"
  ensure_writable_dir "$LOG_DIR"
  ensure_writable_dir "$DOLT_HOME_DIR"

  prepare_log_file "$BACKEND_LOG_FILE"
  prepare_log_file "$FRONTEND_LOG_FILE"
}

start_verbose_heartbeat() {
  local label="$1"
  local log_file="$2"
  local interval="$3"

  (
    local elapsed=0
    while true; do
      sleep "$interval"
      elapsed=$((elapsed + interval))

      local last_line=""
      if [[ -f "$log_file" ]]; then
        last_line="$(tail -n 1 "$log_file" 2>/dev/null || true)"
      fi

      if [[ -n "$last_line" ]]; then
        echo "[verbose] $label is still running after ${elapsed}s. Last output: $last_line"
      else
        echo "[verbose] $label is still running after ${elapsed}s."
      fi
    done
  ) >&2 &
  echo $!
}

stop_verbose_heartbeat() {
  local heartbeat_pid="$1"

  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi
}

run_with_log_capture() {
  local label="$1"
  local log_file="$2"
  shift 2
  local heartbeat_pid=""

  prepare_log_file "$log_file"

  if verbose_enabled; then
    heartbeat_pid="$(start_verbose_heartbeat "$label" "$log_file" "$VERBOSE_HEARTBEAT_SECONDS")"

    set +e
    "$@" 2>&1 | tee "$log_file"
    local pipe_status=("${PIPESTATUS[@]}")
    set -e

    stop_verbose_heartbeat "$heartbeat_pid"
    heartbeat_pid=""

    if (( pipe_status[1] != 0 )); then
      echo "$label logging failed while writing to: $log_file"
      return "${pipe_status[1]}"
    fi

    return "${pipe_status[0]}"
  else
    "$@" >"$log_file" 2>&1
  fi
}

run_with_privilege() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
    return
  fi

  if command_exists sudo; then
    sudo "$@"
    return
  fi

  echo "Need elevated privileges to run: $*"
  return 1
}

install_with_apt() {
  local packages=("$@")
  run_with_privilege apt-get update
  run_with_privilege apt-get install -y "${packages[@]}"
}

install_with_brew() {
  local packages=("$@")
  brew install "${packages[@]}"
}

install_unix_package() {
  local package_name="$1"

  if command_exists brew; then
    install_with_brew "$package_name"
    return
  fi

  if command_exists apt-get; then
    install_with_apt "$package_name"
    return
  fi

  echo "No supported package manager found for installing $package_name automatically."
  return 1
}

install_dolt_official_linux() {
  local install_url="$DOLT_LINUX_INSTALL_URL"

  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "The official Dolt Linux installer is only used on Linux hosts."
    return 1
  fi

  run_with_privilege bash -lc "curl -L \"$install_url\" | bash"
}

ensure_tool() {
  local tool="$1"
  local install_hint="$2"
  local role_label="${3:-$1}"

  if command_exists "$tool"; then
    return 0
  fi

  echo "Missing prerequisite: $role_label"
  if auto_install_enabled; then
    echo "Attempting to install $tool..."
    if try_install_tool "$tool"; then
      if command_exists "$tool"; then
        echo "Installed $tool"
        return 0
      fi
    fi
    echo "Automatic installation for $tool did not complete."
  fi

  echo "$install_hint"
  return 1
}

install_rustup_stable() {
  if ! command_exists curl; then
    install_unix_package curl
  fi

  if [[ -d "$HOME/.cargo/bin" ]]; then
    export PATH="$HOME/.cargo/bin:$PATH"
    hash -r 2>/dev/null || true
  fi

  if command_exists rustup; then
    rustup toolchain install stable
    rustup default stable
    return 0
  fi

  echo "Installing Rust toolchain with rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --profile minimal --default-toolchain stable

  # Make cargo/rustup available inside this running script.
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  fi

  export PATH="$HOME/.cargo/bin:$PATH"
  hash -r 2>/dev/null || true

  command_exists cargo
}

prefer_rustup_cargo_path() {
  if [[ -d "$HOME/.cargo/bin" ]]; then
    export PATH="$HOME/.cargo/bin:$PATH"
    hash -r 2>/dev/null || true
  fi
}

cargo_output_is_lockfile_v4_error() {
  local output="$1"

  grep -Eiq \
    'lock file version[[:space:]]+`?4`?|lock file version 4 requires|next-lockfile-bump' \
    <<<"$output"
}

try_install_tool() {
  local tool="$1"

  case "$tool" in
    curl|lsof|npm)
      install_unix_package "$tool"
      ;;
    cargo|rustup)
      install_rustup_stable
      ;;
    node)
      install_node_lts_with_nvm
      ;;
    dolt)
      install_dolt_official_linux
      ;;
    corepack)
      if command_exists npm; then
        npm install -g corepack
        corepack enable >/dev/null 2>&1 || true
      else
        echo "npm is not available, so corepack could not be installed automatically."
        return 1
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_rust_toolchain() {
  prefer_rustup_cargo_path

  ensure_tool "cargo" \
    "Install the Rust toolchain with rustup and rerun this script." \
    "cargo (Rust backend build)"

  prefer_rustup_cargo_path

  if verbose_enabled; then
    echo "[verbose] Cargo: $(cargo --version 2>/dev/null || echo 'not available')"
    if command_exists rustup; then
      local rustup_version
      rustup_version="$(rustup --version 2>/dev/null || true)"
      rustup_version="${rustup_version%%$'\n'*}"
      echo "[verbose] Rustup: ${rustup_version:-not available}"
      echo "[verbose] Active Rust toolchain: $(rustup show active-toolchain 2>/dev/null || echo 'not available')"
    fi
    echo "[verbose] Backend cargo toolchain: $CARGO_TOOLCHAIN"
    echo "[verbose] Backend cargo build jobs: $CARGO_BUILD_JOBS"
    echo "[verbose] Backend cargo next-lockfile-bump: $CARGO_USE_NEXT_LOCKFILE_BUMP"
  fi
}

ensure_backend_prerequisites() {
  ensure_tool "curl" \
    "Install curl and rerun this script." \
    "curl (backend/frontend health checks)"
  ensure_tool "lsof" \
    "Install lsof and rerun this script." \
    "lsof (backend port tracking)"
  ensure_rust_toolchain
}

ensure_frontend_prerequisites() {
  if ! command_exists node; then
    ensure_tool "node" \
      "Install Node.js $MIN_NODE_MAJOR or newer and rerun this script." \
      "node (frontend runtime)"
  else
    source_nvm >/dev/null 2>&1 || true
  fi
  ensure_node_version
  ensure_tool "npm" \
    "Install Node.js/npm and rerun this script." \
    "npm (frontend package tooling)"
  ensure_tool "corepack" \
    "Install Node.js with corepack support, or make corepack available on PATH, then rerun this script." \
    "corepack (frontend package runner)"
  ensure_corepack_available
  corepack enable >/dev/null 2>&1 || true
}

ensure_prerequisites() {
  ensure_backend_prerequisites
  ensure_frontend_prerequisites
}

frontend_dependencies_installed() {
  [[ -x "$ROOT_DIR/apps/web/node_modules/.bin/vite" ]] || [[ -x "$ROOT_DIR/node_modules/.bin/vite" ]]
}

ensure_frontend_dependencies() {
  if frontend_dependencies_installed; then
    return 0
  fi

  echo "Installing frontend dependencies with pnpm..."
  (
    cd "$ROOT_DIR"
    run_with_log_capture "Frontend dependency install" "$FRONTEND_LOG_FILE" corepack pnpm install --frozen-lockfile
  )
}

CARGO_LAST_OUTPUT=""

run_cargo_command_capture() {
  local tmp_file
  tmp_file="$(mktemp)"

  set +e
  "$@" 2>&1 | tee "$tmp_file"
  local pipe_status=("${PIPESTATUS[@]}")
  set -e

  CARGO_LAST_OUTPUT="$(cat "$tmp_file")"
  rm -f "$tmp_file"

  return "${pipe_status[0]}"
}

active_rust_toolchain() {
  if command_exists rustup; then
    rustup show active-toolchain 2>/dev/null | awk '{print $1}' || true
  fi
}

cargo_build_backend_binary() {
  local status
  local cargo_args=()

  prefer_rustup_cargo_path

  if ! command_exists rustup; then
    echo "rustup is required because this project currently needs cargo +nightly -Znext-lockfile-bump."
    echo "Install Rust with rustup, then rerun:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "  source ~/.cargo/env"
    return 1
  fi

  echo "Ensuring Rust toolchain is installed: $CARGO_TOOLCHAIN"
  rustup toolchain install "$CARGO_TOOLCHAIN"

  cargo_args=("+$CARGO_TOOLCHAIN")

  if [[ "$CARGO_USE_NEXT_LOCKFILE_BUMP" != "0" ]]; then
    if [[ "$CARGO_TOOLCHAIN" != nightly* ]]; then
      echo "STITCHLY_CARGO_USE_NEXT_LOCKFILE_BUMP=1 requires a nightly toolchain."
      echo "Current STITCHLY_CARGO_TOOLCHAIN: $CARGO_TOOLCHAIN"
      return 1
    fi

    cargo_args+=("-Znext-lockfile-bump")
  fi

  cargo_args+=(
    build
    -j "$CARGO_BUILD_JOBS"
    -p runtime_server
    --bin stitchly-server
  )

  echo "Building backend with:"
  echo "  CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS cargo ${cargo_args[*]}"

  run_cargo_command_capture env CARGO_BUILD_JOBS="$CARGO_BUILD_JOBS" cargo "${cargo_args[@]}"
  status=$?

  return "$status"
}

dolt_diagnostics_endpoint() {
  echo "$BACKEND_HTTP_URL/api/testing/dolt"
}

fetch_dolt_diagnostics_json() {
  curl -fsS "$(dolt_diagnostics_endpoint)"
}

extract_dolt_installed_flag() {
  local diagnostics_json="$1"

  if command_exists python3; then
    printf '%s' "$diagnostics_json" | python3 -c 'import json, sys; payload = json.load(sys.stdin); print("true" if payload.get("installed") else "false")'
    return
  fi

  if printf '%s' "$diagnostics_json" | grep -q '"installed"[[:space:]]*:[[:space:]]*true'; then
    echo "true"
  else
    echo "false"
  fi
}

print_dolt_diagnostics() {
  local diagnostics_json="$1"
  local header="${2:-Dolt diagnostics}"

  echo "$header:"

  if command_exists python3; then
    printf '%s' "$diagnostics_json" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)

def value(name):
    raw = payload.get(name)
    if raw is None or raw == "":
        return "(not reported)"
    return str(raw)

installed_text = "yes" if payload.get("installed") else "no"
executable_path = value("executable_path")
version = value("version")
stitchly_dolt_home = value("stitchly_dolt_home")
print(f"  installed: {installed_text}")
print(f"  executable_path: {executable_path}")
print(f"  version: {version}")
print(f"  stitchly_dolt_home: {stitchly_dolt_home}")

for check in payload.get("diagnostics", []):
    key = check.get("key") or ""
    if key in {"dolt_dump_help", "dolt_clone_help"}:
        continue
    status = str(check.get("status", "unknown")).upper()
    label = check.get("label") or key or "diagnostic"
    detail = check.get("detail") or "(no detail)"
    print(f"  [{status}] {label}: {detail}")
'
    return
  fi

  echo "  installed: $(extract_dolt_installed_flag "$diagnostics_json")"
  echo "  full diagnostics available at: $(dolt_diagnostics_endpoint)"
}

ensure_dolt_via_api() {
  local diagnostics_json installed

  if ! diagnostics_json="$(fetch_dolt_diagnostics_json)"; then
    echo "Could not fetch Dolt diagnostics from $(dolt_diagnostics_endpoint)."
    return 1
  fi

  print_dolt_diagnostics "$diagnostics_json"
  installed="$(extract_dolt_installed_flag "$diagnostics_json")"
  if [[ "$installed" == "true" ]]; then
    return 0
  fi

  echo "Dolt diagnostics reported that Dolt is not available to the backend."

  if auto_install_enabled; then
    echo "Attempting to install dolt..."
    if try_install_tool "dolt"; then
      if diagnostics_json="$(fetch_dolt_diagnostics_json)"; then
        print_dolt_diagnostics "$diagnostics_json" "Dolt diagnostics after installation attempt"
        installed="$(extract_dolt_installed_flag "$diagnostics_json")"
        if [[ "$installed" == "true" ]]; then
          echo "Dolt diagnostics are now passing."
          return 0
        fi
      fi
    fi
    echo "Automatic installation for dolt did not complete."
  fi

  echo "Install dolt in this Unix environment and rerun this script. API endpoint: $(dolt_diagnostics_endpoint)"
  return 1
}

read_pid() {
  local pid_file="$1"

  if [[ -f "$pid_file" ]]; then
    tr -d '[:space:]' < "$pid_file"
  fi
}

backend_port() {
  echo "${BACKEND_BIND_ADDR##*:}"
}

backend_listener_pid() {
  lsof -nP -iTCP:"$(backend_port)" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
}

backend_pid_matches_stitchly() {
  local pid="$1"
  local exe_path

  [[ -n "$pid" ]] || return 1
  exe_path="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  [[ "$exe_path" == "$ROOT_DIR/target/debug/stitchly-server"* ]]
}

backend_pid_uses_deleted_binary() {
  local pid="$1"
  local exe_path

  [[ -n "$pid" ]] || return 1
  exe_path="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  [[ "$exe_path" == *" (deleted)" ]]
}

track_backend_listener_pid() {
  local listener_pid="$1"

  if [[ -n "$listener_pid" ]] && backend_pid_matches_stitchly "$listener_pid"; then
    echo "$listener_pid" >"$BACKEND_PID_FILE"
  fi
}

clear_cargo_build_lock() {
  if [[ ! -e "$CARGO_BUILD_LOCK_FILE" ]]; then
    return 0
  fi

  local lock_holders
  lock_holders="$(lsof -t "$CARGO_BUILD_LOCK_FILE" 2>/dev/null | sort -u || true)"
  if [[ -z "$lock_holders" ]]; then
    return 0
  fi

  echo "Detected Cargo build lock at $CARGO_BUILD_LOCK_FILE."

  local pid
  for pid in $lock_holders; do
    local command_line=""
    command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ -n "$command_line" ]]; then
      echo "Stopping lock holder $pid: $command_line"
    else
      echo "Stopping lock holder $pid"
    fi
    kill "$pid" 2>/dev/null || true
  done

  local count=0
  while lsof -t "$CARGO_BUILD_LOCK_FILE" >/dev/null 2>&1; do
    count=$((count + 1))
    if (( count >= 10 )); then
      local stubborn_holders
      stubborn_holders="$(lsof -t "$CARGO_BUILD_LOCK_FILE" 2>/dev/null | sort -u || true)"
      for pid in $stubborn_holders; do
        echo "Force stopping lock holder $pid"
        kill -9 "$pid" 2>/dev/null || true
      done
      break
    fi
    sleep 1
  done

  if lsof -t "$CARGO_BUILD_LOCK_FILE" >/dev/null 2>&1; then
    echo "Cargo build lock is still held after cleanup: $CARGO_BUILD_LOCK_FILE"
    return 1
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
  curl -fsS "$BACKEND_HTTP_URL/api/node-definitions" 2>/dev/null | grep -q '"node_definitions"' \
    && curl -fsS "$BACKEND_HTTP_URL/api/auth/session" 2>/dev/null | grep -q '"authenticated"'
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
    if verbose_enabled && (( count == 0 || count % 5 == 0 )); then
      echo "[verbose] Waiting for $label to become ready (${count}/${attempts})."
    fi

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

  local existing_pid
  existing_pid="$(read_pid "$BACKEND_PID_FILE")"
  local listener_pid
  listener_pid="$(backend_listener_pid)"

  if backend_ready; then
    if backend_pid_uses_deleted_binary "$listener_pid"; then
      echo "Tracked backend listener $listener_pid is using a deleted binary."
      echo "Restarting backend so the live server matches the current code."
      kill "$listener_pid" 2>/dev/null || true
      sleep 1
      listener_pid="$(backend_listener_pid)"
    else
      if [[ -z "$existing_pid" ]]; then
        track_backend_listener_pid "$listener_pid"
      fi
      echo "Backend already available at $BACKEND_HTTP_URL"
      return 0
    fi
  fi

  if pid_is_running "$existing_pid"; then
    echo "Tracked backend process $existing_pid is running but missing current platform routes."
    echo "Restarting backend so auth/session and workspace endpoints are available."
    stop_process "Backend" "$BACKEND_PID_FILE"
  fi

  echo "Starting backend on $BACKEND_BIND_ADDR"
  log_verbose "Backend build log: $BACKEND_LOG_FILE"
  clear_cargo_build_lock
  (
    cd "$ROOT_DIR"
    run_with_log_capture "Backend build" "$BACKEND_LOG_FILE" cargo_build_backend_binary
  )
  (
    cd "$ROOT_DIR"
    nohup setsid env STITCHLY_SERVER_ADDR="$BACKEND_BIND_ADDR" STITCHLY_STATE_DIR="$STATE_DIR" STITCHLY_DOLT_HOME="$DOLT_HOME_DIR" "$ROOT_DIR/target/debug/stitchly-server" \
      >>"$BACKEND_LOG_FILE" 2>&1 < /dev/null &
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

  ensure_frontend_dependencies

  echo "Starting frontend on $UI_BIND_HOST:$UI_PORT"
  log_verbose "Frontend log: $FRONTEND_LOG_FILE"
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
  local normalized_label="${label,,}"

  clear_stale_pid_file "$pid_file"
  pid="$(read_pid "$pid_file")"

  if [[ "$normalized_label" == "backend" ]] && ! pid_is_running "$pid"; then
    local listener_pid
    listener_pid="$(backend_listener_pid)"
    if backend_pid_matches_stitchly "$listener_pid"; then
      pid="$listener_pid"
    fi
  fi

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

stop_agent() {
  stop_process "frontend" "$FRONTEND_PID_FILE"
  stop_process "backend" "$BACKEND_PID_FILE"
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
    case "$arg" in
      --no-open)
        should_open=0
        ;;
      --verbose|--trace)
        ;;
      *)
        echo "Unknown startup option: $arg"
        usage
        return 1
        ;;
    esac
  done

  if verbose_enabled; then
    echo "[verbose] Startup flags: verbose=$VERBOSE trace=$TRACE no_open=$((1 - should_open))"
    echo "[verbose] State directory: $STATE_DIR"
  fi

  ensure_state_paths_writable
  ensure_prerequisites
  start_backend
  ensure_dolt_via_api
  start_frontend

  echo
  echo "Stitchly UI is ready at $UI_HTTP_URL"
  echo "Backend API is ready at $BACKEND_HTTP_URL"
  echo "Swagger UI is ready at $BACKEND_HTTP_URL/swagger-ui/"
  echo "Logs:"
  echo "  backend:  $BACKEND_LOG_FILE"
  echo "  frontend: $FRONTEND_LOG_FILE"

  if (( should_open == 1 )); then
    echo
    open_ui || true
  fi
}

main() {
  local command=""
  local args=()
  local arg
  local invalid_args=()

  for arg in "$@"; do
    case "$arg" in
      -h|--help|help)
        usage
        return 0
        ;;
    esac
  done

  for arg in "$@"; do
    case "$arg" in
      up|restart|down|status|open)
        if [[ -z "$command" ]]; then
          command="$arg"
        else
          args+=("$arg")
        fi
        ;;
      --no-open|--verbose|--trace)
        args+=("$arg")
        ;;
      *)
        if [[ -z "$command" ]]; then
          echo "Unknown command: $arg"
          usage
          exit 1
        fi
        args+=("$arg")
        ;;
    esac
  done

  command="${command:-up}"

  case "$command" in
    up)
      start_agent "${args[@]}"
      ;;
    restart)
      stop_agent
      start_agent "${args[@]}"
      ;;
    down)
      invalid_args=()
      for arg in "${args[@]}"; do
        case "$arg" in
          --verbose|--trace)
            ;;
          *)
            invalid_args+=("$arg")
            ;;
        esac
      done
      if (( ${#invalid_args[@]} > 0 )); then
        echo "Unknown option(s) for down: ${invalid_args[*]}"
        usage
        exit 1
      fi
      stop_agent
      ;;
    status)
      invalid_args=()
      for arg in "${args[@]}"; do
        case "$arg" in
          --verbose|--trace)
            ;;
          *)
            invalid_args+=("$arg")
            ;;
        esac
      done
      if (( ${#invalid_args[@]} > 0 )); then
        echo "Unknown option(s) for status: ${invalid_args[*]}"
        usage
        exit 1
      fi
      show_status
      ;;
    open)
      invalid_args=()
      for arg in "${args[@]}"; do
        case "$arg" in
          --verbose|--trace)
            ;;
          *)
            invalid_args+=("$arg")
            ;;
        esac
      done
      if (( ${#invalid_args[@]} > 0 )); then
        echo "Unknown option(s) for open: ${invalid_args[*]}"
        usage
        exit 1
      fi
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
