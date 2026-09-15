#!/bin/sh
# startup.sh — start the Mini Minecraft browser game on a fresh runner.
# - Changes to its own directory (project root)
# - Installs dependencies when required (idempotent; safe to re-run)
# - Builds when required (npm run build, only if a build script exists)
# - Serves the playable entrypoint (./index.html or ./dist/index.html)
#   on ${PORT:-3000} in the foreground.
# Tunnel setup stays in the workflow, not here.
set -eu

# Per-command timing helper: step "label" cmd args...
step() {
  label="$1"; shift
  start=$(date +%s)
  echo "==> [startup] start: ${label}"
  "$@"
  rc=$?
  end=$(date +%s)
  echo "==> [startup] done: ${label} (exit=${rc}, elapsed=$((end - start))s)"
  return $rc
}

timed_sh() {
  # Run an inline sh fragment as one timed step.
  label="$1"; shift
  start=$(date +%s)
  echo "==> [startup] start: ${label}"
  sh -c "$*"
  rc=$?
  end=$(date +%s)
  echo "==> [startup] done: ${label} (exit=${rc}, elapsed=$((end - start))s)"
  return $rc
}

TOTAL_START=$(date +%s)

# 1) Run from the project root (directory containing this script).
step "cd to script directory" cd "$(dirname "$0")"
echo "==> [startup] project root: $(pwd)"

# 2) Resolve configuration.
PORT="${PORT:-3000}"
echo "==> [startup] PORT=${PORT}"

# 3) Confirm a playable HTML entrypoint exists; pick the docroot the server serves.
if [ -f "./index.html" ]; then
  DOCROOT="."
  ENTRY="./index.html"
elif [ -f "./dist/index.html" ]; then
  DOCROOT="./dist"
  ENTRY="./dist/index.html"
else
  echo "==> [startup] ERROR: no playable entrypoint at ./index.html or ./dist/index.html" >&2
  exit 1
fi
echo "==> [startup] entrypoint: ${ENTRY} (serving ${DOCROOT})"

# 4) Install required dependencies (idempotent; skipped when there is nothing to install).
if [ -f "./package.json" ]; then
  if command -v npm >/dev/null 2>&1; then
    if [ ! -d "./node_modules" ]; then
      step "npm ci (first install)" npm ci --no-audit --no-fund
    else
      echo "==> [startup] node_modules present — reusing dependencies"
      # Keep the tree in sync cheaply; never fail startup if already usable.
      step "npm ci --prefer-offline (reuse/sync)" npm ci --prefer-offline --no-audit --no-fund || \
        echo "==> [startup] WARN: dependency sync failed, continuing with existing node_modules"
    fi
  else
    echo "==> [startup] ERROR: package.json exists but npm is not installed" >&2
    exit 1
  fi
else
  timed_sh "check runtime (no package.json, static site)" \
    'command -v python3 >/dev/null 2>&1 || { echo "python3 is required but not installed" >&2; exit 1; }'
  echo "==> [startup] no package.json — nothing to install (static site)"
fi

# 5) Build when required (only if package.json defines a build script).
if [ -f "./package.json" ] && command -v npm >/dev/null 2>&1 && npm run | grep -q " build"; then
  step "npm run build" npm run build
  # Re-resolve the entrypoint after a build (build may emit dist/index.html).
  if [ -f "./dist/index.html" ]; then DOCROOT="./dist"; ENTRY="./dist/index.html"; fi
  echo "==> [startup] post-build entrypoint: ${ENTRY}"
else
  echo "==> [startup] no build step required"
fi

# 6) Final entrypoint re-check: verify the file the server will actually serve.
timed_sh "verify served entrypoint" \
  "test -f '${ENTRY}' && echo '==> [startup] verified: ${ENTRY} exists'"
if [ ! -f "${DOCROOT}/index.html" ]; then
  echo "==> [startup] ERROR: ${DOCROOT}/index.html missing after setup" >&2
  exit 1
fi

TOTAL_END=$(date +%s)
echo "==> [startup] setup complete (elapsed=$((TOTAL_END - TOTAL_START))s); serving ${DOCROOT} on port ${PORT} (foreground)"

# 7) Start the app in the foreground (exec: signals propagate, logs stream).
exec python3 -m http.server "${PORT}" --directory "${DOCROOT}"
