#!/usr/bin/env bash
set -euo pipefail

# deploy.sh - Build the frontend and launch the Hono backend for visor-orchestrator.
# Idempotent: safe to re-run. Does not use nodemon or PM2.

# Resolve repo root (parent of the directory containing this script).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Defaults.
: "${PORT:=5176}"
: "${ORCHESTRATOR_DB_PATH:=/home/angel/projects/autonomous-orchestrator/state/orchestrator.db}"
export PORT ORCHESTRATOR_DB_PATH

PID_FILE="${REPO_ROOT}/.deploy.pid"
LOG_FILE="${REPO_ROOT}/.deploy.log"

log_info() {
  printf '[deploy] %s\n' "$*"
}

log_err() {
  printf '[deploy][error] %s\n' "$*" >&2
}

# 1. Check tooling.
if ! command -v node >/dev/null 2>&1; then
  log_err "node not found in PATH. Install Node.js >= 20.x and retry."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  log_err "npm not found in PATH. Install npm and retry."
  exit 1
fi

log_info "node $(node --version)"
log_info "npm  $(npm --version)"
log_info "PORT=${PORT}"
log_info "ORCHESTRATOR_DB_PATH=${ORCHESTRATOR_DB_PATH}"

# 2. Validate repo root.
if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
  log_err "package.json not found in ${REPO_ROOT}. Aborting."
  exit 1
fi

# 3. Install dependencies if missing or stale. Idempotent.
if [[ ! -d "${REPO_ROOT}/node_modules" ]]; then
  log_info "node_modules missing; installing dependencies."
  if [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi
else
  log_info "node_modules present; skipping install."
fi

# 4. Build frontend with Vite. Produces dist/public/.
log_info "Building frontend (npx vite build)."
npx vite build

if [[ ! -f "${REPO_ROOT}/dist/public/index.html" ]]; then
  log_err "Build did not produce dist/public/index.html. Aborting."
  exit 1
fi

# 5. Stop any prior backend instance bound to PORT (idempotent restart).
stop_pid() {
  local pid="$1"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    log_info "Stopping previous backend pid=${pid}."
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if kill -0 "${pid}" >/dev/null 2>&1; then
        sleep 0.3
      else
        return 0
      fi
    done
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
}

if [[ -f "${PID_FILE}" ]]; then
  PREV_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  stop_pid "${PREV_PID}"
  rm -f "${PID_FILE}"
fi

if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS="$(lsof -ti tcp:"${PORT}" 2>/dev/null || true)"
  if [[ -n "${PORT_PIDS}" ]]; then
    log_info "Port ${PORT} busy; freeing it."
    for p in ${PORT_PIDS}; do
      stop_pid "${p}"
    done
  fi
fi

# 6. Launch backend Hono via tsx in background.
log_info "Starting backend: npx tsx server/index.ts"
: > "${LOG_FILE}"
nohup npx tsx server/index.ts >>"${LOG_FILE}" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${PID_FILE}"

# Give the server a brief moment to bind or fail.
sleep 1

if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
  log_err "Backend failed to start. See ${LOG_FILE}."
  exit 1
fi

URL="http://localhost:${PORT}"
log_info "Backend running."
log_info "URL: ${URL}"
log_info "PID: ${BACKEND_PID}"
log_info "PID file: ${PID_FILE}"
log_info "Logs:     ${LOG_FILE}"
log_info "Stop with: kill \$(cat ${PID_FILE})"
