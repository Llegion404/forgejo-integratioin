#!/usr/bin/env bash
# Run Playwright e2e tests locally against a Forgejo container.
#
# Usage:
#   bash scripts/run-e2e-local.sh [--clean] [--headed]
#
# Flags:
#   --clean   Remove the Docker volume and start fresh
#   --headed  Run Playwright with a visible browser/VS Code window

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.e2e.yml"

CLEAN=false
HEADED=false

for arg in "$@"; do
  case "$arg" in
    --clean)  CLEAN=true ;;
    --headed) HEADED=true ;;
    *)        echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Clean if requested ──────────────────────────────────────────────
if $CLEAN; then
  echo "Removing Forgejo volume and containers..."
  docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
fi

# ── Start Forgejo ───────────────────────────────────────────────────
echo "Starting Forgejo..."
docker compose -f "$COMPOSE_FILE" up -d --wait

# ── Setup test data ─────────────────────────────────────────────────
echo "Setting up test data..."
SETUP_OUTPUT=$(FORGEJO_TEST_URL=http://localhost:3000 bash "$SCRIPT_DIR/setup-forgejo-test.sh")
echo "$SETUP_OUTPUT"

# Extract token from setup script output
TOKEN=$(echo "$SETUP_OUTPUT" | grep '^FORGEJO_TEST_TOKEN=' | cut -d= -f2)
if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not extract FORGEJO_TEST_TOKEN from setup script output"
  exit 1
fi

# ── Create test workspace ──────────────────────────────────────────
WORKSPACE="/tmp/forgejo-test-workspace"
mkdir -p "$WORKSPACE"
if [ ! -d "$WORKSPACE/.git" ]; then
  git init "$WORKSPACE"
  git -C "$WORKSPACE" remote add origin http://localhost:3000/testuser/test-repo.git
else
  # Ensure remote points at localhost
  git -C "$WORKSPACE" remote set-url origin http://localhost:3000/testuser/test-repo.git 2>/dev/null || true
fi

# ── Compile extension ──────────────────────────────────────────────
echo "Compiling extension..."
(cd "$PROJECT_DIR" && npm run compile)

# ── Run Playwright ─────────────────────────────────────────────────
echo "Running Playwright live e2e tests..."
export FORGEJO_TEST_TOKEN="$TOKEN"
export FORGEJO_TEST_URL="http://localhost:3000"
export FORGEJO_LIVE_WORKSPACE="$WORKSPACE"

PLAYWRIGHT_ARGS=(test --config playwright.live.config.ts)
if $HEADED; then
  PLAYWRIGHT_ARGS+=(--headed)
fi

cd "$PROJECT_DIR"

# On Linux without a display, use xvfb (unless --headed and DISPLAY is set)
if [[ "$(uname)" == "Linux" ]] && [[ -z "${DISPLAY:-}" ]] && ! $HEADED; then
  if command -v xvfb-run &>/dev/null; then
    echo "No DISPLAY detected, using xvfb-run..."
    xvfb-run -a npx playwright "${PLAYWRIGHT_ARGS[@]}"
  else
    echo "WARNING: No DISPLAY and xvfb-run not found. Install xvfb: sudo apt install xvfb"
    exit 1
  fi
else
  npx playwright "${PLAYWRIGHT_ARGS[@]}"
fi
